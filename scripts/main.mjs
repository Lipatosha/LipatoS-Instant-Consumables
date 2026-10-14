/**
 * LipatoS — Мгновенное употребление v1.0.0
 * Foundry VTT v14 / dnd5e v6.0.6
 *
 * Использование активности еды/напитков без диалога: списать одну порцию,
 * а при последней порции удалить предмет из инвентаря персонажа.
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

const pending = new Set();

Hooks.on("dnd5e.preUseActivity", (activity) => {
  const actor = activity?.actor ?? activity?.item?.actor;
  const itemId = activity?.item?.id;
  const item = actor?.items?.get(itemId);
  if (!item || item.type !== "consumable") return;

  const isFood = item.system?.type?.value === "food";
  const isAindor = AINDOR_ITEMS.has(item.name?.trim());
  const enabled = item.getFlag(MODULE_ID, "enabled") === true;
  if (!isFood && !isAindor && !enabled) return;

  // Блокируем обычную активацию до появления окна и стандартного расхода.
  const key = item.uuid;
  if (pending.has(key)) return false;
  pending.add(key);

  // Hooks.call синхронный: изменение документа выполняем после завершения хука.
  void Promise.resolve().then(async () => {
    try {
      // Игрок должен иметь право изменять инвентарь своего персонажа.
      if (!item.isOwner || !actor.items.has(item.id)) return;
      const quantity = Number(item.system?.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return;

      if (quantity > 1) {
        await item.update({ "system.quantity": quantity - 1 });
      } else {
        await item.delete();
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Не удалось употребить предмет`, error);
      ui.notifications.error(`Не удалось использовать «${item.name}».`);
    } finally {
      pending.delete(key);
    }
  });

  return false;
});
