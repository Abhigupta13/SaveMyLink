/**
 * One-off: copy vault data from the local Docker MongoDB into Atlas.
 * Users are matched by email (Atlas is the authority); every ownership/reference
 * id is remapped to the Atlas user. Re-runnable: existing docs are skipped by _id.
 * Usage: node scripts/migrate-to-atlas.mjs [--commit]
 */
import mongoose from 'mongoose';
process.loadEnvFile('.env.local');

const LOCAL = process.env.LOCAL_MONGODB_URI || 'mongodb://localhost:27017/savemylink';
const ATLAS = process.env.MONGODB_URI;
const COMMIT = process.argv.includes('--commit');

const local = await mongoose.createConnection(LOCAL).asPromise();
const atlas = await mongoose.createConnection(ATLAS, { serverSelectionTimeoutMS: 15000 }).asPromise();

// email -> atlas user id
const atlasUsers = await atlas.db.collection('users').find({}, { projection: { email: 1 } }).toArray();
const byEmail = new Map(atlasUsers.map(u => [String(u.email).toLowerCase(), u._id]));
const localUsers = await local.db.collection('users').find({}, { projection: { email: 1 } }).toArray();

const userMap = new Map();          // localId -> atlasId
const unmapped = [];
for (const u of localUsers) {
  const target = byEmail.get(String(u.email).toLowerCase());
  if (target) userMap.set(String(u._id), target);
  else unmapped.push(u.email);
}
console.log('user mapping:', [...userMap.keys()].length, 'matched;', unmapped.length, 'local-only:', unmapped.join(', ') || '—');

const remap = (id) => (id && userMap.get(String(id))) || id;

// collection -> fields holding a user id
const PLAN = {
  projects: ['ownerId'],
  tasks: ['userId', 'assigneeId'],
  moms: ['userId'],
  links: ['userId'],
  notes: ['userId'],
  categories: ['userId'],
  contacts: ['userId'],
  documents: ['user'],
  socialapps: ['user'],
};

let total = 0;
for (const [coll, userFields] of Object.entries(PLAN)) {
  const docs = await local.db.collection(coll).find({}).toArray();
  if (!docs.length) { console.log(`${coll}: nothing to copy`); continue; }

  const existing = new Set((await atlas.db.collection(coll)
    .find({ _id: { $in: docs.map(d => d._id) } }, { projection: { _id: 1 } }).toArray()).map(d => String(d._id)));

  // Only migrate data belonging to users that exist in Atlas — anything owned by
  // local-only accounts is test data and must not pollute production.
  const owned = docs.filter(d => {
    const owner = userFields.map(f => d[f]).find(Boolean);
    return owner ? userMap.has(String(owner)) : false;
  });
  const skipped = docs.length - owned.length;

  const fresh = owned.filter(d => !existing.has(String(d._id)))
    .map(d => { for (const f of userFields) if (d[f]) d[f] = remap(d[f]); return d; });

  console.log(`${coll}: ${docs.length} local → ${fresh.length} to insert (${skipped} test-account docs skipped, ${existing.size} already there)`);
  if (COMMIT && fresh.length) { await atlas.db.collection(coll).insertMany(fresh, { ordered: false }); total += fresh.length; }
}

console.log(COMMIT ? `\nDONE — inserted ${total} documents into Atlas.` : '\nDRY RUN — nothing written. Re-run with --commit to apply.');
await local.close(); await atlas.close();
