const { MongoClient } = require('mongodb');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const TARGET_EMAIL = 'lokeshraj22110@gmail.com';
const CSV_PATH = 'all_links_export.csv';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCsvLine(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  cols.push(current.trim());
  return cols.map((c) => c.replace(/^["']|["']$/g, ''));
}

function isHeaderRow(cols) {
  const lowered = cols.map((c) => c.trim().toLowerCase());
  return (
    lowered.includes('url') ||
    (lowered.includes('title') && lowered.includes('useremail'))
  );
}

function extractRowData(cols, defaultPrivate = false) {
  const urlColIndex = cols.findIndex((value) => /^https?:\/\//i.test((value || '').trim()));
  if (urlColIndex === -1) return null;

  const url = cols[urlColIndex].trim();
  const category = (cols[urlColIndex + 1] || '').trim();
  const rawPrivate = (cols[urlColIndex + 2] || '').trim().toLowerCase();
  const tagsRaw = cols[urlColIndex + 3] || '';

  const isPrivate = ['true', '1', 'yes', 'y'].includes(rawPrivate)
    ? true
    : ['false', '0', 'no', 'n'].includes(rawPrivate)
      ? false
      : defaultPrivate;

  const tags = tagsRaw
    ? tagsRaw.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean)
    : [];

  return { url, category, isPrivate, tags };
}

async function run() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing in .env.local');
  }

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found: ${CSV_PATH}`);
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV has no data rows');
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  try {
    const db = client.db();
    const user = await db.collection('users').findOne({ email: TARGET_EMAIL.toLowerCase() });
    if (!user) {
      throw new Error(`Target user not found: ${TARGET_EMAIL}`);
    }

    const categoryCache = new Map();
    let inserted = 0;
    let failed = 0;
    let skippedInvalidUrl = 0;

    let recoveredPreviouslySkipped = 0;

    for (let i = 0; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length === 0 || isHeaderRow(cols)) {
        continue;
      }

      const parsed = extractRowData(cols, false);
      if (!parsed) {
        skippedInvalidUrl++;
        continue;
      }

      // This identifies rows from old export format where URL was not in first column.
      if (cols[0] && !/^https?:\/\//i.test(cols[0].trim())) {
        recoveredPreviouslySkipped++;
      }

      const { url, category: categoryName, isPrivate, tags } = parsed;
      if (!/^https?:\/\//i.test(url)) {
        skippedInvalidUrl++;
        continue;
      }

      try {
        let categoryId;
        if (categoryName) {
          const cacheKey = `${isPrivate}:${categoryName.toLowerCase()}`;
          if (categoryCache.has(cacheKey)) {
            categoryId = categoryCache.get(cacheKey);
          } else {
            const existing = await db.collection('categories').findOne({
              userId: user._id,
              isPrivate,
              name: { $regex: new RegExp(`^${escapeRegExp(categoryName)}$`, 'i') },
            });

            if (existing) {
              categoryId = existing._id;
            } else {
              const created = await db.collection('categories').insertOne({
                name: categoryName,
                color: '#4ade80',
                userId: user._id,
                isPrivate,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
              categoryId = created.insertedId;
            }
            categoryCache.set(cacheKey, categoryId);
          }
        }

        await db.collection('links').insertOne({
          url,
          category: categoryId,
          title: url,
          previewImageUrl: '',
          duration: '',
          quality: '',
          tags,
          isFavorite: false,
          isPrivate,
          userId: user._id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        inserted++;
      } catch (error) {
        failed++;
      }
    }

    console.log(
      JSON.stringify(
        {
          targetEmail: TARGET_EMAIL,
          totalRows: lines.length - 1,
          recoveredPreviouslySkipped,
          inserted,
          failed,
          skippedInvalidUrl,
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error('Import failed:', err.message || err);
  process.exit(1);
});
