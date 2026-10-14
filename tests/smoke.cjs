const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let useHook;
const errors = [];
const sandbox = {
  Hooks: { on(name, cb) { if (name === "dnd5e.preUseActivity") useHook = cb; } },
  ui: { notifications: { error: value => errors.push(value) } },
  console
};
vm.runInNewContext(fs.readFileSync("scripts/main.mjs", "utf8"), sandbox);
assert.equal(typeof useHook, "function");

const drain = () => new Promise(resolve => setImmediate(resolve));
function fixture({name="Вересковый закат",quantity=4,food=true,post=true}={}) {
  const calls = { cards:0, updates:[], deletes:0 };
  const actor = { items: new Map() };
  const item = {
    id: "item-" + Math.random(),
    name,
    uuid: "Actor.test.Item." + Math.random(),
    actor,
    type: "consumable",
    isOwner: true,
    system: { quantity, type: { value: food ? "food" : "potion" } },
    getFlag: () => false,
    async displayCard() {
      calls.cards++;
      if (post === "throw") throw new Error("Chat blocked");
      if (!post) return undefined;
      return { id: "chat-message" };
    },
    async update(changes) {
      calls.updates.push(changes);
      item.system.quantity = changes["system.quantity"];
    },
    async delete() {
      calls.deletes++;
      actor.items.delete(item.id);
    }
  };
  actor.items.set(item.id, item);
  return { item, actor, calls, activity:{ actor, item } };
}

async function run() {
  {
    const x=fixture();
    assert.equal(useHook(x.activity), false, "tracked items intercept native use");
    await drain();
    assert.equal(x.calls.cards, 1, "post exactly one card");
    assert.equal(x.calls.updates.length, 1, "decrease stack once");
    assert.equal(x.item.system.quantity, 3);
    assert.equal(x.calls.deletes, 0);
  }
  {
    const x=fixture({ quantity:1 });
    assert.equal(useHook(x.activity), false);
    await drain();
    assert.equal(x.calls.cards, 1);
    assert.equal(x.calls.deletes, 1, "last portion deleted");
  }
  {
    const x=fixture({post:false});
    assert.equal(useHook(x.activity), false);
    await drain();
    assert.equal(x.calls.updates.length, 0, "blocked chat must not consume");
  }
  {
    const x=fixture({post:"throw"});
    assert.equal(useHook(x.activity), false);
    await drain();
    assert.equal(x.calls.updates.length, 0, "failed chat must not consume");
    assert.equal(errors.length, 1);
  }
  {
    const x=fixture();
    assert.equal(useHook(x.activity), false);
    assert.equal(useHook(x.activity), false, "prevent concurrent double use");
    await drain();
    assert.equal(x.calls.cards, 1);
    assert.equal(x.calls.updates.length, 1);
  }
  {
    const x=fixture({name:"Обычное зелье", food:false});
    assert.equal(useHook(x.activity), undefined, "unrelated consumables remain native");
    await drain();
    assert.equal(x.calls.cards, 0);
  }
  console.log("Instant Consumables 1.1.0: chat-card and consumption smoke tests passed.");
}
run().catch(error => { console.error(error); process.exitCode=1; });
