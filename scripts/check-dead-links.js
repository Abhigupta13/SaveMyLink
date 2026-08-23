#!/usr/bin/env node
/**
 * Weekly dead-link checker. Flags links that definitively 404/410 (and YouTube
 * videos whose oEmbed lookup 404s — deleted/private videos still return 200 HTML).
 * VPS cron: 0 3 * * 0 cd /path/to/app && node scripts/check-dead-links.js
 */
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env.local')); } catch {}
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch {}

const mongoose = require('mongoose');

const YT = /(^|\.)((youtube\.com)|(youtu\.be))$/;

async function isDead(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (YT.test(host)) {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
        signal: AbortSignal.timeout(10000),
      });
      return res.status === 404 || res.status === 401 || res.status === 403; // 401/403 = private/removed
    }
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (res.status === 405) res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10000) });
    return res.status === 404 || res.status === 410;
  } catch {
    return false; // network error / bot-blocked → not proof of death
  }
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  await mongoose.connect(process.env.MONGODB_URI);
  const Link = mongoose.model('Link', new mongoose.Schema({}, { strict: false }), 'links');

  const links = await Link.find({ url: { $regex: '^http' } }).select('_id url isDead').lean();
  let flagged = 0, revived = 0;

  for (let i = 0; i < links.length; i += 5) {
    await Promise.all(links.slice(i, i + 5).map(async (link) => {
      const dead = await isDead(link.url);
      if (dead !== !!link.isDead) {
        await Link.updateOne({ _id: link._id }, { $set: { isDead: dead } });
        dead ? flagged++ : revived++;
      }
    }));
  }

  console.log(`Checked ${links.length} links: ${flagged} newly dead, ${revived} revived.`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
