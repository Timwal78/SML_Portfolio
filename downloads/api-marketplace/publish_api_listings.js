#!/usr/bin/env node
/**
 * Real marketplace pack validator — fails if files missing or SAM stamps missing.
 * Generated 2026-07-29
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname);
const UEI = "G24VZA4RLMK3";
const CAGE = "21U51";
const required = [
  "openapi.json",
  "postman_collection.json",
  "rapidapi-manifest.json",
  "aws-marketplace-api-listing.json",
  "gcp-api-hub-listing.json",
  "public-apis-manifest.json",
  "client-sdk.ts",
  "client_sdk.py",
  "index.html",
];

let pass = 0, fail = 0;
function ok(msg) { console.log("✅ " + msg); pass++; }
function bad(msg) { console.error("❌ " + msg); fail++; }

console.log("🚀 SML marketplace pack validation (REAL files on disk)...");
for (const f of required) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) { bad("missing " + f); continue; }
  const sz = fs.statSync(p).size;
  if (sz < 50) { bad(f + " too small (" + sz + "b)"); continue; }
  ok(f + " (" + sz + " bytes)");
}

const oa = JSON.parse(fs.readFileSync(path.join(DIR, "openapi.json"), "utf8"));
const paths = Object.keys(oa.paths || {}).length;
if (paths >= 20) ok("OpenAPI paths=" + paths); else bad("OpenAPI paths too few: " + paths);
const blob = JSON.stringify(oa);
if (blob.includes(UEI) && blob.includes(CAGE)) ok("SAM UEI & CAGE in OpenAPI"); else bad("SAM stamps missing in OpenAPI");

const pm = JSON.parse(fs.readFileSync(path.join(DIR, "postman_collection.json"), "utf8"));
if ((pm.info?.description || "").includes(UEI)) ok("SAM UEI in Postman"); else bad("SAM UEI missing in Postman");
if ((pm.item || []).length > 0) ok("Postman folders=" + pm.item.length); else bad("Postman empty");

const rapid = JSON.parse(fs.readFileSync(path.join(DIR, "rapidapi-manifest.json"), "utf8"));
if (rapid?.vendor?.sam_gov_uei === UEI) ok("SAM UEI in RapidAPI manifest"); else bad("RapidAPI SAM missing");

const aws = JSON.parse(fs.readFileSync(path.join(DIR, "aws-marketplace-api-listing.json"), "utf8"));
if (aws?.vendor?.samGovUei === UEI) ok("SAM UEI in AWS listing"); else bad("AWS SAM missing");

const ts = fs.readFileSync(path.join(DIR, "client-sdk.ts"), "utf8");
const py = fs.readFileSync(path.join(DIR, "client_sdk.py"), "utf8");
if (ts.includes("SmlX402Client") && ts.includes(UEI)) ok("TypeScript SDK"); else bad("TS SDK bad");
if (py.includes("SmlX402Client") && py.includes(UEI)) ok("Python SDK"); else bad("Py SDK bad");

console.log("=".repeat(50));
console.log(fail === 0 ? "🎉 ALL REAL CHECKS PASSED (" + pass + ")" : "FAILED " + fail + " / passed " + pass);
process.exit(fail === 0 ? 0 : 1);
