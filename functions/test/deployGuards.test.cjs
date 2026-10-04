// Guards for the production deploy: Firestore indexes that exist in
// production must stay in firestore.indexes.json (otherwise the CLI proposes
// deleting them), and the functions deploy filter must cover every export
// without touching functions kept in production on purpose.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { deployFilter, exportedFunctionNames } = require("../scripts/deploy-filter.cjs");

const root = path.join(__dirname, "..", "..");
const indexes = JSON.parse(fs.readFileSync(path.join(root, "firestore.indexes.json"), "utf8"));
const source = fs.readFileSync(path.join(__dirname, "..", "src", "index.ts"), "utf8");

function indexKey(index) {
  return `${index.collectionGroup}|${index.queryScope}|${index.fields
    .map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`)
    .join(",")}`;
}

// Composite indexes read from production (focus-club-f73b8) on 2026-10-04,
// plus none removed: the file must always contain all of them.
const PRODUCTION_COMPOSITE_INDEXES = [
  ["appointments", [["userId", "ASCENDING"], ["createdAt", "DESCENDING"]]],
  ["appointments", [["status", "ASCENDING"], ["createdAt", "DESCENDING"]]],
  ["appointments", [["assignedTrainer", "ASCENDING"], ["status", "ASCENDING"], ["createdAt", "DESCENDING"]]],
  ["bonos", [["userId", "ASCENDING"], ["createdAt", "DESCENDING"]]],
  ["customer_suggestions", [["status", "ASCENDING"], ["createdAt", "DESCENDING"]]],
  ["gallery_items", [["active", "ASCENDING"], ["createdAt", "DESCENDING"]]],
  ["gallery_items", [["active", "ASCENDING"], ["order", "ASCENDING"]]],
  ["media_files", [["folderId", "ASCENDING"], ["createdAt", "DESCENDING"]]],
  ["support_conversations", [["userId", "ASCENDING"], ["lastMessageAt", "DESCENDING"]]],
  ["support_conversations", [["status", "ASCENDING"], ["lastMessageAt", "DESCENDING"]]],
].map(([collectionGroup, fields]) => indexKey({
  collectionGroup,
  queryScope: "COLLECTION",
  fields: fields.map(([fieldPath, order]) => ({ fieldPath, order })),
}));

test("firestore.indexes.json keeps every composite index that exists in production", () => {
  const local = new Set(indexes.indexes.map(indexKey));
  const missing = PRODUCTION_COMPOSITE_INDEXES.filter((key) => !local.has(key));
  assert.deepEqual(missing, [], "a deploy would propose deleting these production indexes");
  assert.equal(local.size, indexes.indexes.length, "duplicated index definitions");
});

test("firestore.indexes.json keeps the fcmTokens collection-group overrides", () => {
  const overrides = indexes.fieldOverrides.map((override) => ({
    field: `${override.collectionGroup}.${override.fieldPath}`,
    collectionGroup: override.indexes.some((index) => index.queryScope === "COLLECTION_GROUP"),
  }));
  assert.deepEqual(overrides, [
    { field: "fcmTokens.token", collectionGroup: true },
    { field: "fcmTokens.updatedAt", collectionGroup: true },
  ]);
});

test("the deploy filter lists every exported function and nothing else", () => {
  const names = exportedFunctionNames(source);
  const declared = (source.match(/^export const \w+\s*=/gm) ?? []).length;
  assert.equal(names.length, declared, "every export must be recognised as a function trigger");
  assert.ok(names.includes("onAppointmentCustomerNotification"));
  assert.ok(names.includes("pruneStaleFcmTokensScheduled"));
  // Kept in production on purpose / retired explicitly with functions:delete.
  assert.ok(!names.includes("adminRestoreSuggestion"));
  assert.ok(!names.includes("onAppointmentStatusPushNotification"));
  // deleteOwnAccount belongs to the `portal` codebase (app_focus_club).
  assert.ok(!names.includes("deleteOwnAccount"));

  const filter = deployFilter(names);
  assert.match(filter, /^functions:[A-Za-z0-9_]+(,functions:[A-Za-z0-9_]+)*$/);
  assert.equal(filter.split(",").length, names.length);
});
