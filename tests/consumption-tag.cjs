const assert = require("node:assert/strict");
const fs = require("node:fs");
const js = fs.readFileSync("scripts/main.mjs", "utf8");
assert.ok(js.includes("await item.delete({ lipatosItemConsumed: true, itemMoveStackUse: true });"),
  "Consuming the last portion must be marked as consumption");
assert.ok(js.includes("await item.displayCard()"),
  "Original use card must remain");
assert.ok(js.includes('await item.update({ "system.quantity": quantity - 1 })'),
  "Partial food stack must still be consumed normally");
console.log("Instant Consumables depletion flags passed.");
