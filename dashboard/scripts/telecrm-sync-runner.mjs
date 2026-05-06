// One-shot driver for the TeleCRM full backfill against production.
// Calls /api/maintenance/telecrm-sync repeatedly with increasing start_skip
// until done. Each call processes up to 30 pages × 100 leads, fits in the
// Vercel function timeout, and returns next_skip for the next call.
//
// Usage: node scripts/telecrm-sync-runner.mjs [--dry-run] [--target=prod|local]

import fs from "node:fs";
import path from "node:path";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv(path.resolve(process.cwd(), ".env.local"));

const TOK = process.env.ADMIN_BOOTSTRAP_TOKEN;
const TC_TOKEN = process.env.TELECRM_SYNC_TOKEN;
const TC_EID = process.env.TELECRM_ENTERPRISE_ID;
if (!TOK || !TC_TOKEN || !TC_EID) {
  console.error("Need ADMIN_BOOTSTRAP_TOKEN, TELECRM_SYNC_TOKEN, TELECRM_ENTERPRISE_ID in .env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = (args.find(a => a.startsWith("--target=")) || "--target=prod").split("=")[1];
const BASE = target === "local" ? "http://localhost:3000" : "https://forge-marketing-sync.vercel.app";

console.log(`→ Target  : ${BASE}`);
console.log(`→ Dry run : ${dryRun}`);

const url = `${BASE}/api/maintenance/telecrm-sync?token=${encodeURIComponent(TOK)}`;
const cum = { pages: 0, fetched: 0, normalized: 0, skipped_noidentity: 0, inserted: 0, updated: 0, merged: 0, errors: 0 };
let skip = 0, total = 0, calls = 0;
const t0 = Date.now();

while (true) {
  calls++;
  const tCall = Date.now();
  let res, j;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_skip: skip,
        max_pages: 30,
        dry_run: dryRun,
        telecrm_token: TC_TOKEN,
        telecrm_enterprise_id: TC_EID,
      }),
    });
    j = await res.json();
  } catch (e) {
    console.error(`call ${calls} failed: ${e.message}`);
    if (calls > 50) break;
    await new Promise(r => setTimeout(r, 5000));
    continue;
  }

  if (!res.ok) {
    console.error(`call ${calls} HTTP ${res.status}:`, JSON.stringify(j).slice(0, 400));
    break;
  }

  const s = j.stats;
  total = s.total_in_telecrm || total;
  for (const k of Object.keys(cum)) cum[k] += s[k] || 0;

  const dt = ((Date.now() - tCall) / 1000).toFixed(1);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(
    `call ${String(calls).padStart(3)} ` +
    `skip=${String(skip).padStart(5)}→${String(s.next_skip ?? "done").padStart(5)} ` +
    `pages=${s.pages} fetched=${s.fetched} ins=${s.inserted} upd=${s.updated} merged=${s.merged} errs=${s.errors} ` +
    `(${dt}s, total elapsed ${elapsed}s)`
  );
  if (s.sample_errors?.length && cum.errors < 12) {
    for (const e of s.sample_errors.slice(0, 3)) console.log(`    err: ${e}`);
  }

  if (s.done || s.next_skip == null || s.next_skip === skip) break;
  skip = s.next_skip;
  if (calls >= 50) { console.log("safety cap (50 calls) — stopping"); break; }
}

const dur = ((Date.now() - t0) / 1000).toFixed(0);
console.log("");
console.log(`✔ Done in ${dur}s · ${calls} HTTP calls`);
console.log(`  total in TeleCRM     : ${total.toLocaleString()}`);
console.log(`  fetched              : ${cum.fetched.toLocaleString()}`);
console.log(`  normalized           : ${cum.normalized.toLocaleString()}`);
console.log(`  skipped (no ident.)  : ${cum.skipped_noidentity.toLocaleString()}`);
console.log(`  inserted             : ${cum.inserted.toLocaleString()}`);
console.log(`  updated              : ${cum.updated.toLocaleString()}`);
console.log(`  merged               : ${cum.merged.toLocaleString()}`);
console.log(`  errors               : ${cum.errors.toLocaleString()}`);
