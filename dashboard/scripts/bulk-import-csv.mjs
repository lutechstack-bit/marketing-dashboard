// Bulk-import a CSV by streaming 250-row batches to /api/maintenance/import-telecrm.
// Usage: node scripts/bulk-import-csv.mjs <csv-path> [--target=prod|local]
//
// Auth: uses ADMIN_BOOTSTRAP_TOKEN from .env.local (loaded automatically).
// The API never downgrades a lead's funnel_stage and preserves first_seen,
// score (max), and existing email/phone — so re-running is safe.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Papa = require("papaparse");

// --------- env -----------
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv(path.resolve(process.cwd(), ".env.local"));

const TOKEN = process.env.ADMIN_BOOTSTRAP_TOKEN;
if (!TOKEN) { console.error("Missing ADMIN_BOOTSTRAP_TOKEN"); process.exit(1); }

// --------- args ----------
const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith("--"));
const targetArg = (args.find(a => a.startsWith("--target=")) || "--target=prod").split("=")[1];
if (!csvPath) { console.error("Usage: node bulk-import-csv.mjs <path> [--target=prod|local]"); process.exit(1); }
if (!fs.existsSync(csvPath)) { console.error("CSV not found:", csvPath); process.exit(1); }

const BASE = targetArg === "local"
  ? "http://localhost:3000"
  : "https://forge-marketing-sync.vercel.app";

console.log(`→ Source : ${csvPath}`);
console.log(`→ Target : ${BASE}`);

// --------- parse ---------
const csvText = fs.readFileSync(csvPath, "utf8");
const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
const rows = (parsed.data || []).filter(r => r && Object.values(r).some(v => v != null && String(v).trim() !== ""));
const columns = parsed.meta?.fields || [];

console.log(`→ Rows   : ${rows.length.toLocaleString()}`);
console.log(`→ Cols   : ${columns.length}`);
if (parsed.errors?.length) {
  console.log(`→ Parse warnings: ${parsed.errors.length} (first: ${parsed.errors[0].message})`);
}

// --------- auto-map (mirrors components/admin/ImportClient.tsx) ---------
const FIELDS = [
  { key: "email",          hints: ["email", "e-mail", "mail"] },
  { key: "phone",          hints: ["phone", "mobile", "whatsapp", "contact"] },
  { key: "first_name",     hints: ["first name", "firstname", "given"] },
  { key: "last_name",      hints: ["last name", "lastname", "surname", "family"] },
  { key: "full_name",      hints: ["full name", "name"] },
  { key: "program",        hints: ["program", "product", "course"] },
  { key: "status",         hints: ["status", "stage", "funnel"] },
  { key: "lost_reason",    hints: ["lost reason", "lost"] },
  { key: "reason",         hints: ["reason", "why", "essay", "story", "tell us"] },
  { key: "scholarship",    hints: ["scholarship", "grant", "financial", "fwif", "select one"] },
  { key: "age",            hints: ["age"] },
  { key: "job_role",       hints: ["job role", "job", "occupation", "profession"] },
  { key: "designation",    hints: ["designation", "title"] },
  { key: "city",           hints: ["city", "location", "town"] },
  { key: "form_source",    hints: ["form source", "source", "form"] },
  { key: "interview",      hints: ["interview"] },
  { key: "interview_date", hints: ["interview date"] },
  { key: "interviewer",    hints: ["interviewer"] },
  { key: "grant",          hints: ["grant"] },
  { key: "grant_amount",   hints: ["grant amount"] },
  { key: "created_at",     hints: ["created", "first seen", "date created", "added"] },
  { key: "last_activity",  hints: ["last activity", "updated", "modified", "last contacted"] },
];

function autoMap(cols) {
  const m = {};
  const used = new Set();
  const lc = cols.map(c => ({ raw: c, lc: c.toLowerCase().trim() }));
  for (const f of FIELDS) {
    for (const h of f.hints) {
      const hit = lc.find(c => !used.has(c.raw) && c.lc === h);
      if (hit) { m[f.key] = hit.raw; used.add(hit.raw); break; }
    }
    if (m[f.key]) continue;
    for (const h of f.hints) {
      const hit = lc.find(c => !used.has(c.raw) && c.lc.includes(h));
      if (hit) { m[f.key] = hit.raw; used.add(hit.raw); break; }
    }
  }
  m.passthrough = lc.filter(c => !used.has(c.raw)).map(c => c.raw);
  return m;
}

const mapping = autoMap(columns);

// Hard override: never let `full_name` bind. The CSV has explicit First Name +
// Last Name columns and a confusing "AD NAME" column whose hint partial-matches
// "name". If full_name is set, the API uses it as the lead's display name —
// which means Meta ad IDs end up as lead names. Drop it so buildName falls
// through to first+last cleanly.
if (mapping.full_name) {
  if (!mapping.passthrough) mapping.passthrough = [];
  if (!mapping.passthrough.includes(mapping.full_name)) {
    mapping.passthrough.push(mapping.full_name);
  }
  delete mapping.full_name;
}

console.log("\n→ Column mapping:");
for (const [k, v] of Object.entries(mapping)) {
  if (k === "passthrough") {
    console.log(`    passthrough  ← ${(v || []).join(", ") || "(none)"}`);
  } else {
    console.log(`    ${k.padEnd(15)} ← ${v}`);
  }
}

const defaults = { source: "TeleCRM CSV (full backfill)" };

// --------- batch loop ---------
const BATCH = 250;
const total = rows.length;
const t0 = Date.now();
let cum = { processed: 0, inserted: 0, updated: 0, merged: 0, skipped: 0, errors: 0 };
const sampleErrors = [];

console.log(`\n→ Posting in batches of ${BATCH}…\n`);

const url = `${BASE}/api/maintenance/import-telecrm?token=${encodeURIComponent(TOKEN)}`;

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), ss = s % 60;
  if (m < 60) return `${m}m ${ss}s`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h ${mm}m`;
}

for (let i = 0; i < total; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const batchNo = Math.floor(i / BATCH) + 1;
  const totalBatches = Math.ceil(total / BATCH);

  let attempt = 0, lastErr = null, j = null;
  while (attempt < 3) {
    attempt++;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: chunk, mapping, defaults }),
      });
      const text = await res.text();
      try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; }
      if (!res.ok) {
        lastErr = `HTTP ${res.status}: ${j.error || text.slice(0, 120)}`;
        // 5xx → retry with backoff. 4xx → don't bother.
        if (res.status >= 500 && attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        break;
      }
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e.message || String(e);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  cum.processed += chunk.length;
  if (lastErr) {
    cum.errors += chunk.length;
    sampleErrors.push({ batch: batchNo, reason: lastErr });
  } else if (j) {
    cum.inserted += j.inserted || 0;
    cum.updated  += j.updated  || 0;
    cum.merged   += j.merged   || 0;
    cum.skipped  += j.skipped  || 0;
    cum.errors   += (j.errors?.length || 0);
    if (j.errors?.length) sampleErrors.push(...j.errors.map(e => ({ batch: batchNo, ...e })));
  }

  const elapsed = Date.now() - t0;
  const rate = cum.processed / (elapsed / 1000);
  const eta = rate > 0 ? (total - cum.processed) / rate : 0;
  const pct = (100 * cum.processed / total).toFixed(1);
  process.stdout.write(
    `\r  batch ${String(batchNo).padStart(3)}/${totalBatches}  ` +
    `${pct.padStart(5)}%  ` +
    `inserted=${String(cum.inserted).padStart(5)}  ` +
    `updated=${String(cum.updated).padStart(5)}  ` +
    `merged=${String(cum.merged).padStart(4)}  ` +
    `skipped=${String(cum.skipped).padStart(5)}  ` +
    `errors=${String(cum.errors).padStart(4)}  ` +
    `${rate.toFixed(0)} r/s  eta ${fmtDuration(eta * 1000)}      `
  );
}

const totalMs = Date.now() - t0;
process.stdout.write("\n\n");
console.log(`✔ Done in ${fmtDuration(totalMs)}`);
console.log(`  inserted : ${cum.inserted.toLocaleString()}`);
console.log(`  updated  : ${cum.updated.toLocaleString()}`);
console.log(`  merged   : ${cum.merged.toLocaleString()}  (rows that joined an existing record by email/phone)`);
console.log(`  skipped  : ${cum.skipped.toLocaleString()}  (no email/phone or unrecognized program)`);
console.log(`  errors   : ${cum.errors.toLocaleString()}`);
if (sampleErrors.length) {
  console.log(`\n  sample errors (first 8):`);
  for (const e of sampleErrors.slice(0, 8)) {
    console.log(`    · batch ${e.batch}: ${e.reason || JSON.stringify(e)}`);
  }
}
