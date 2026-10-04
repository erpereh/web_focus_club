// Prints the `--only` filter that deploys exactly the functions exported by
// functions/src/index.ts, e.g. "functions:createAppointment,functions:...".
//
// A filtered deploy never proposes deleting functions that are not listed, so
// functions intentionally kept in production without source (for example
// `adminRestoreSuggestion`) survive, and retiring a function is always an
// explicit `firebase functions:delete`. See docs/production-release-checklist.md.
const fs = require("node:fs");
const path = require("node:path");

const TRIGGER = /^export const ([A-Za-z0-9_]+)\s*=\s*(onCall|onRequest|onSchedule|onDocument\w+|onTaskDispatched|onMessagePublished|before\w+)\b/gm;

function exportedFunctionNames(source) {
  return [...source.matchAll(TRIGGER)].map((match) => match[1]).sort();
}

function deployFilter(names) {
  return names.map((name) => `functions:${name}`).join(",");
}

if (require.main === module) {
  const file = path.join(__dirname, "..", "src", "index.ts");
  const names = exportedFunctionNames(fs.readFileSync(process.argv[2] ?? file, "utf8"));
  if (names.length === 0) {
    console.error("[deploy-filter] No exported functions found.");
    process.exit(1);
  }
  process.stdout.write(deployFilter(names));
}

module.exports = { deployFilter, exportedFunctionNames };
