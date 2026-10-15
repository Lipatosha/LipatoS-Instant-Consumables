/**
 * LipatoS — Мгновенное употребление v1.2.0
 * Foundry VTT v14 / dnd5e v6.0.6
 *
 * Использование еды и напитков без подтверждений.
 * Для сосудов с зарядами списывается system.uses.spent, для еды без
 * зарядов — system.quantity. Отправляется обычная карточка D&D5e.
 */

const MODULE_ID = "lipatos-instant-consumables";

const AINDOR_ITEMS = new Set([
  "Золотой колос", "Каменное сердце", "Медовая борода", "Вересковый закат",
  "Лесной шёпот", "Кровь кузни", "Северный ветер", "Последняя медь",
  "Лунная роса", "Багряная лоза", "Слёзы рассвета", "Мёд предков",
  "Золотой улей", "Ягодная ночь", "Железная глотка", "Чёрный ворон",
  "Морская буря", "Пепел дракона", "Лесной дух", "Старый бастион",
  "Родниковая вода", "Вересковый чай", "Ягодный морс", "Пряное молоко",
  "Яблочный сидр", "Горький корень", "Бочковой эль", "Крапивная горечь",
  "Полевой отвар", "Хвойный настой", "Дорожная брага", "Осенний сбор",
  "Рёбра под медовой корочкой", "Похлёбка охотника", "Золотая птица",
  "Речная форель на углях", "Олений окорок в ягодном соусе",
  "Дварфская сковорода", "Рыбацкая уха", "Сад полумесяца",
  "Лесная поляна", "Сырная доска путника", "Копчёное ассорти",
  "Тёплый хлеб с травяным маслом", "Ягодная корзинка",
  "Лунный чизкейк", "Медовые яблоки", "Вересковый пирог",
  "Мятное облако", "Фирменный заказ Брагга", "Ужин Пробуждённого",
  "Сытный завтрак", "Еда в дорогу"
]);


/** Custom food/drink names and flagged consumables are also supported when
 * D&D5e stores them as "equipment" rather than "consumable". */
const FOOD_OR_DRINK_NAME = /(?:пив|эль|медовух|вин[оа]\b|сидр|квас|морс|кофе|чай\b|ча[яею]|напит|вода\b|воды\b|сок\b|молок|ром\b|настойк|похлёбк|суп\b|пирог|хлеб|сыр\b|сух(?:ой|ие)\s+па[ёе]к|у[хш]а\b|р[ёе]бр|цыпл[ёе]нок|колбас|завтрак|ужин|обед)/i;

const pending = new Set();

function getOwnedItem(activity) {
  // The D&D5e use() implementation runs on a CLONE of an item.
  // Always update the actual actor-owned Item document, never that clone.
  const source = activity?.item;
  const actor = activity?.actor ?? source?.actor;
  return actor?.items?.get(source?.id) ?? null;
}

function isInstantFoodOrDrink(item) {
  if (!item || !item.actor || !item.isOwner) return false;
  const override = item.getFlag?.(MODULE_ID, "enabled");
  if (override === false) return false;
  if (override === true) return true;

  const name = String(item.name ?? "").trim();
  if (AINDOR_ITEMS.has(name)) return true;
  if (item.type === "consumable" && item.system?.type?.value === "food") return true;

  // "Бочка пива" is usually Equipment, so the old consumable-only filter
  // missed it and allowed the system's charge confirmation prompt.
  // Match food/drink names, but not arbitrary charged weapons or magic wands.
  return FOOD_OR_DRINK_NAME.test(name);
}

function getChargeData(item) {
  const uses = item.system?.uses;
  const max = Number(uses?.max);
  const spent = Number(uses?.spent);
  if (!Number.isFinite(max) || max <= 0) return null;
  if (!Number.isFinite(spent) || spent < 0) return { invalid: true };
  return { max, spent, remaining: Math.max(0, max - spent) };
}

async function instantUse(item) {
  try {
    if (!item.isOwner || !item.actor?.items?.has(item.id)) return;
    const charges = getChargeData(item);
    if (charges?.invalid) return;

    if (charges) {
      if (charges.remaining < 1) {
        ui.notifications.warn("У «" + item.name + "» не осталось зарядов.");
        return;
      }
      // Match what Foundry VTT tracks: spent charges, NOT item quantity.
      // The preUpdateItem hook in LipatoS-item-move-stack then recalculates
      // weight and value in the SAME embedded-item update.
      const card = await item.displayCard();
      if (!card) return;
      await item.update({ "system.uses.spent": Math.min(charges.max, charges.spent + 1) });
      return;
    }

    const quantity = Number(item.system?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const card = await item.displayCard();
    if (!card) return;
    if (quantity > 1) {
      await item.update({ "system.quantity": quantity - 1 });
    } else {
      // Last portion is consumed, not manually deleted from inventory.
      await item.delete({ lipatosItemConsumed: true, itemMoveStackUse: true });
    }
  } catch (error) {
    console.error(MODULE_ID + " | Не удалось использовать предмет", error);
    ui.notifications.error("Не удалось использовать «" + item.name + "».");
  } finally {
    pending.delete(item.uuid);
  }
}

Hooks.on("dnd5e.preUseActivity", activity => {
  const item = getOwnedItem(activity);
  if (!isInstantFoodOrDrink(item)) return;

  // Cancels the activity BEFORE dnd5e opens its usage dialog or prompts for
  // charge consumption. We handle the single charge and chat card ourselves.
  if (pending.has(item.uuid)) return false;
  pending.add(item.uuid);
  void Promise.resolve().then(() => instantUse(item));
  return false;
});
