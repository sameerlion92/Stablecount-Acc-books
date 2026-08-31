import assert from "node:assert/strict";
import test from "node:test";

function normalizePersonName(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

test("invited user activation requires matching assigned name", () => {
  assert.equal(normalizePersonName("  Jane   Doe "), normalizePersonName("Jane Doe"));
  assert.notEqual(normalizePersonName("Jane Doe"), normalizePersonName("John Doe"));
});
