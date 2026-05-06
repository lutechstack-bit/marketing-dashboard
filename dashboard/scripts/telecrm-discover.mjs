// Telecrm discovery script — confirms auth and dumps metadata so we can
// design the sync mapping (TeleCRM stages → our funnel_stage, custom fields
// → leads/responses, etc.).
//
// Usage: node scripts/telecrm-discover.mjs
// Reads TELECRM_SYNC_TOKEN + TELECRM_ENTERPRISE_ID from .env.local.

import fs from "node:fs";
import path from "node:path";

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

const TOKEN = process.env.TELECRM_SYNC_TOKEN;
const EID   = process.env.TELECRM_ENTERPRISE_ID;
if (!TOKEN || !EID) {
  console.error("Missing TELECRM_SYNC_TOKEN or TELECRM_ENTERPRISE_ID");
  process.exit(1);
}

const BASE = `https://next.telecrm.in/autoupdate/v2/enterprise/${EID}`;

async function call(method, path, body = null) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function showBoth(label, methods) {
  console.log(`\n=== ${label} ===`);
  for (const [m, p, body] of methods) {
    const r = await call(m, p, body);
    if (r.status >= 200 && r.status < 300) {
      console.log(`  ${m} ${p} → ${r.status}`);
      console.log(JSON.stringify(r.json, null, 2).split("\n").slice(0, 30).join("\n"));
      return;
    }
  }
  // none worked — show all
  for (const [m, p, body] of methods) {
    const r = await call(m, p, body);
    console.log(`  ✗ ${m} ${p} → ${r.status}: ${r.text.slice(0, 200)}`);
  }
}

console.log(`Enterprise ID: ${EID}`);
console.log(`Sync API:      ${BASE}\n`);

await showBoth("Enterprise metadata", [
  ["GET",  "/enterprise/metadata"],
  ["POST", "/enterprise/metadata", {}],
]);

await showBoth("Lead stage pipeline (funnel definition)", [
  ["GET",  "/enterprise/lead-stage-pipeline"],
  ["POST", "/enterprise/lead-stage-pipeline", {}],
]);

await showBoth("Custom fields list (Product, Form Source, etc.)", [
  ["GET",  "/enterprise/custom-fields-list"],
  ["POST", "/enterprise/custom-fields-list", {}],
]);

await showBoth("Custom actions list (call types, stage changes, etc.)", [
  ["GET",  "/enterprise/custom-actions-list"],
  ["POST", "/enterprise/custom-actions-list", {}],
]);

await showBoth("Team members list", [
  ["GET",  "/team-members/list"],
  ["POST", "/team-members/list", {}],
]);

await showBoth("Sample lead (1 record)", [
  ["POST", "/lead/search?limit=1", {}],
  ["POST", "/leads/search?limit=1", {}],
]);

await showBoth("Sample action (1 record)", [
  ["POST", "/action/search?limit=1", {}],
  ["POST", "/actions/search?limit=1", {}],
]);

console.log("\nDone.");
