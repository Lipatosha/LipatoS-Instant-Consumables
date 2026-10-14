/**
 * LipatoS — Мгновенное использование предметов v1.3.0
 * Foundry VTT v14 / D&D5e 6.0.6
 *
 * Inventory physical items except equipment and containers.
 * Charges are consumed before quantity; sends an ordinary D&D5e chat card.
 */
const MODULE_ID = "lipatos-instant-consumables";

// The physical inventory types supported in D&D5e.
// Never consume worn equipment/armor or containers, even when flagged.
const USABLE_TYPES = new Set(["consumable", "loot", "tool", "weapon"]);
const EXCLUDED_TYPES = new Set(["equipment", "container", "backpack"]);
const pending = new Set();

function canInstantUse(item) {
  if (!item || item.documentName !== "Item" || !item.actor || !item.isOwner) return false;
  if (EXCLUDED_TYPES.has(item.type)) return false;
  if (!USABLE_TYPES.has(item.type)) return false;
  if (item.getFlag?.(MODULE_ID, "enabled") === false) return false;
  return true;
}

function itemFromActivity(activity) {
  // D&D5e preUseActivity is called on an item clone. Look up the real Item.
  const source = activity?.item;
  const actor = activity?.actor ?? source?.actor;
  return actor?.items?.get(source?.id) ?? null;
}

function chargeData(item) {
  const rawMax = item.system?.uses?.max;
  const rawSpent = item.system?.uses?.spent;
  const max = Number(rawMax);
  const spent = Number(rawSpent);
  if (rawMax === "" || rawMax === null || rawMax === undefined ||
      !Number.isFinite(max) || max <= 0) return null;
  if (!Number.isFinite(spent) || spent < 0) return { invalid: true };
  return { max, spent, remaining: Math.max(0, max - spent) };
}

async function consume(item) {
  try {
    if (!canInstantUse(item) || item.actor.items.get(item.id) !== item) return;
    const charges = chargeData(item);
    if (charges?.invalid) {
      ui.notifications.warn("Некорректное количество зарядов у «" + item.name + "».");
      return;
    }
    if (charges) {
      if (charges.remaining < 1) {
        ui.notifications.warn("У «" + item.name + "» не осталось зарядов.");
        return;
      }
      const card = await item.displayCard();
      if (!card) return;
      // preUpdateItem of item-move-stack recalculates weight and price.
      await item.update({ "system.uses.spent": Math.min(charges.max, charges.spent + 1) });
      return;
    }

    const quantity = Number(item.system?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      ui.notifications.warn("У «" + item.name + "» нет доступного количества.");
      return;
    }
    const card = await item.displayCard();
    if (!card) return;
    if (quantity > 1) await item.update({ "system.quantity": quantity - 1 });
    else await item.delete();
  } catch (error) {
    console.error(MODULE_ID + " | Не удалось использовать предмет", error);
    ui.notifications.error("Не удалось использовать «" + item.name + "».");
  } finally {
    pending.delete(item.uuid);
  }
}

// Public interface for the "Использовать" command in item-move-stack.
// It bypasses item.use() for inventory entries with no D&D5e activity.
function useItem(item) {
  if (!canInstantUse(item)) return false;
  if (pending.has(item.uuid)) return true;
  pending.add(item.uuid);
  void Promise.resolve().then(() => consume(item));
  return true;
}

// D&D5e activities on consumables, loot and tools are handled automatically.
// Weapon ATTACK activities must still work normally; weapon consumption is
// exclusively an explicit "Использовать" inventory action, not an attack.
Hooks.on("dnd5e.preUseActivity", activity => {
  const item = itemFromActivity(activity);
  if (!canInstantUse(item)) return;
  if (item.type === "weapon" && activity.type !== "utility") return;
  useItem(item);
  return false; // Cancel the native charge / consumption dialog.
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = { canUse: canInstantUse, useItem };
});
