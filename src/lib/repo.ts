// Letture e scritture del database (senza interfaccia: si possono provare con i test).
import type { PantryDB } from './db';
import type { BackupData } from './logic/backup';
import { daysLeft } from './logic/expiry';
import { templateFromItem, templateKey } from './logic/drafts';
import type { ModelPauses } from './logic/gemini';
import { parseFirebaseConfig, type HouseInfo, type Shadow } from './logic/house';
import type { Meal } from './logic/meals';
import { sanitizeRecipe, type Recipe } from './logic/recipes';
import { defaultSettings, sanitizeSettings } from './logic/settings';
import { addToList } from './logic/shopping';
import type { HistoryEntry, Item, Outcome, Settings, ShoppingItem, Template } from './types';

// ---------- Impostazioni e chiavi ----------

export async function loadSettings(db: PantryDB): Promise<Settings> {
  const row = await db.kv.get('settings');
  return row ? sanitizeSettings(row.value) : defaultSettings();
}

export async function saveSettings(db: PantryDB, s: Settings): Promise<void> {
  await db.kv.put({ key: 'settings', value: JSON.parse(JSON.stringify(s)) as unknown });
}

/** Chiave di Gemini: fuori dalle impostazioni, così non finisce mai nei backup. */
export async function getAiKey(db: PantryDB): Promise<string> {
  const row = await db.kv.get('geminiKey');
  return typeof row?.value === 'string' ? row.value : '';
}

export async function setAiKey(db: PantryDB, key: string): Promise<void> {
  if (key.trim()) await db.kv.put({ key: 'geminiKey', value: key.trim() });
  else await db.kv.delete('geminiKey');
}

// ---------- Casa condivisa (fuori dai backup, come la chiave di Gemini) ----------

export async function getHouse(db: PantryDB): Promise<HouseInfo | null> {
  const v = (await db.kv.get('house'))?.value as Partial<HouseInfo> | undefined;
  if (!v || typeof v !== 'object' || typeof v.houseId !== 'string' || typeof v.code !== 'string' || !v.firebase) return null;
  const firebase = parseFirebaseConfig(JSON.stringify(v.firebase));
  if (!firebase) return null;
  return { firebase: { ...firebase, appId: typeof v.firebase.appId === 'string' ? v.firebase.appId : firebase.appId }, houseId: v.houseId, code: v.code, name: typeof v.name === 'string' ? v.name : '' };
}

export async function saveHouse(db: PantryDB, info: HouseInfo): Promise<void> {
  await db.kv.put({ key: 'house', value: JSON.parse(JSON.stringify(info)) as unknown });
}

/** Esce dalla casa: il telefono tiene i dati, ma non si aggiornano più. */
export async function clearHouse(db: PantryDB): Promise<void> {
  await db.kv.bulkDelete(['house', 'houseShadow']);
}

export async function getHouseShadow(db: PantryDB): Promise<Shadow> {
  const v = (await db.kv.get('houseShadow'))?.value;
  if (!v || typeof v !== 'object') return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

export async function saveHouseShadow(db: PantryDB, shadow: Shadow): Promise<void> {
  await db.kv.put({ key: 'houseShadow', value: { ...shadow } });
}

/** Toglie dal telefono dispensa, spesa e pasti (entrando in una casa con "Tieni solo quelli della casa"). */
export async function clearSharedData(db: PantryDB): Promise<void> {
  await db.transaction('rw', [db.items, db.shopping, db.meals, db.kv], async () => {
    await Promise.all([db.items.clear(), db.shopping.clear(), db.meals.clear(), db.kv.delete('houseShadow')]);
  });
}

/** Modelli di Gemini messi in pausa (limite gratuito raggiunto o modello inesistente) e fino a quando. */
export async function getModelPauses(db: PantryDB): Promise<ModelPauses> {
  const row = await db.kv.get('aiModelPauses');
  const v = row?.value;
  if (typeof v !== 'object' || v === null) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'));
}

export async function setModelPauses(db: PantryDB, pauses: ModelPauses): Promise<void> {
  await db.kv.put({ key: 'aiModelPauses', value: pauses });
}

// ---------- Dispensa ----------

export async function allItems(db: PantryDB): Promise<Item[]> {
  return db.items.toArray();
}

/** Salva un prodotto e lo ricorda (per riaggiungerlo con un tocco e riconoscere il codice a barre). */
export async function saveItem(db: PantryDB, item: Item, today: string, remember = true): Promise<void> {
  await db.transaction('rw', db.items, db.templates, async () => {
    await db.items.put(item);
    if (!remember) return;
    const key = templateKey(item);
    const prev = await db.templates.get(key);
    await db.templates.put(templateFromItem(item, prev, today));
    // Se ha il codice a barre, il ricordo "per nome" non serve più.
    if (item.barcode) await db.templates.delete(templateKey({ name: item.name }));
  });
}

export async function updateItem(db: PantryDB, id: string, change: Partial<Item>): Promise<void> {
  await db.items.update(id, { ...change, updatedAt: new Date().toISOString() });
}

export interface Removal {
  item: Item;
  historyId: number;
}

/** Toglie un prodotto (finito o buttato) e lo segna nelle statistiche. */
export async function removeItem(db: PantryDB, item: Item, outcome: Outcome, today: string): Promise<Removal> {
  const d = daysLeft(item, today);
  const entry: HistoryEntry = {
    at: new Date().toISOString(),
    date: today,
    name: item.name,
    emoji: item.emoji,
    location: item.location,
    outcome,
    wasExpired: d !== null && d < 0,
  };
  let historyId = 0;
  await db.transaction('rw', db.items, db.history, async () => {
    await db.items.delete(item.id);
    historyId = (await db.history.add(entry)) as number;
  });
  return { item, historyId };
}

/** Annulla la rimozione: il prodotto torna e la riga delle statistiche sparisce. */
export async function undoRemoval(db: PantryDB, r: Removal): Promise<void> {
  await db.transaction('rw', db.items, db.history, async () => {
    await db.items.put(r.item);
    await db.history.delete(r.historyId);
  });
}

/** Elimina un prodotto senza contarlo (aggiunto per sbaglio). */
export async function deleteItem(db: PantryDB, id: string): Promise<void> {
  await db.items.delete(id);
}

export async function allHistory(db: PantryDB): Promise<HistoryEntry[]> {
  return db.history.orderBy('date').reverse().toArray();
}

// ---------- Prodotti ricordati ----------

export async function recentTemplates(db: PantryDB, max = 16): Promise<Template[]> {
  return db.templates.orderBy('lastUsed').reverse().limit(max).toArray();
}

export async function templateByBarcode(db: PantryDB, code: string): Promise<Template | undefined> {
  return db.templates.get(`b:${code}`);
}

export async function forgetTemplate(db: PantryDB, key: string): Promise<void> {
  await db.templates.delete(key);
}

// ---------- Spesa ----------

export async function allShopping(db: PantryDB): Promise<ShoppingItem[]> {
  return db.shopping.toArray();
}

/** Aggiunge in cima alla spesa (senza doppioni). Restituisce true se c'era già. */
export async function addShopping(db: PantryDB, name: string, note = ''): Promise<boolean> {
  const list = await db.shopping.toArray();
  const { item, existed } = addToList(list, name, note);
  await db.shopping.put(item);
  return existed;
}

export async function updateShopping(db: PantryDB, id: string, change: Partial<ShoppingItem>): Promise<void> {
  await db.shopping.update(id, change);
}

export async function deleteShopping(db: PantryDB, ids: string[]): Promise<void> {
  await db.shopping.bulkDelete(ids);
}

// ---------- Ricette ----------

export async function savedRecipes(db: PantryDB): Promise<Recipe[]> {
  return (await db.recipes.orderBy('createdAt').reverse().toArray()).map(sanitizeRecipe).filter((r): r is Recipe => r !== null);
}

export async function saveRecipe(db: PantryDB, r: Recipe): Promise<void> {
  await db.recipes.put(JSON.parse(JSON.stringify(r)) as Recipe);
}

export async function unsaveRecipe(db: PantryDB, id: string): Promise<void> {
  await db.recipes.delete(id);
}

/** Ultime ricette proposte (restano quando si cambia scheda o si chiude l'app). */
export async function getLastRecipes(db: PantryDB): Promise<Recipe[]> {
  const row = await db.kv.get('lastRecipes');
  return Array.isArray(row?.value) ? row.value.map(sanitizeRecipe).filter((r): r is Recipe => r !== null) : [];
}

export async function setLastRecipes(db: PantryDB, list: Recipe[], note: { text: string; onlyExpiring: boolean } = { text: '', onlyExpiring: false }): Promise<void> {
  await db.kv.bulkPut([
    { key: 'lastRecipes', value: JSON.parse(JSON.stringify(list)) as unknown },
    { key: 'lastRecipesNote', value: note },
  ]);
}

/** Frase dell'IA sulle ultime ricette e se erano state chieste solo con prodotti in scadenza. */
export async function getLastRecipesNote(db: PantryDB): Promise<{ text: string; onlyExpiring: boolean }> {
  const v = (await db.kv.get('lastRecipesNote'))?.value as { text?: unknown; onlyExpiring?: unknown } | undefined;
  return { text: typeof v?.text === 'string' ? v.text : '', onlyExpiring: v?.onlyExpiring === true };
}

// ---------- Backup ----------

export async function exportAll(db: PantryDB): Promise<BackupData> {
  const [settings, items, history, shopping, templates, recipes, meals] = await Promise.all([
    loadSettings(db),
    db.items.toArray(),
    db.history.toArray(),
    db.shopping.toArray(),
    db.templates.toArray(),
    db.recipes.toArray(),
    db.meals.toArray(),
  ]);
  return { settings, items, history: history.map(({ id: _id, ...h }) => h), shopping, templates, recipes, meals };
}

/** Sostituisce tutti i dati con quelli del backup (la chiave di Gemini resta). */
export async function importAll(db: PantryDB, data: BackupData): Promise<void> {
  await db.transaction('rw', [db.items, db.history, db.shopping, db.templates, db.recipes, db.meals, db.kv], async () => {
    await Promise.all([db.items.clear(), db.history.clear(), db.shopping.clear(), db.templates.clear(), db.recipes.clear(), db.meals.clear()]);
    await db.items.bulkPut(data.items);
    await db.history.bulkAdd(data.history.map(({ id: _id, ...h }) => h));
    await db.shopping.bulkPut(data.shopping);
    await db.templates.bulkPut(data.templates);
    await db.recipes.bulkPut(data.recipes);
    await db.meals.bulkPut(data.meals);
    await saveSettings(db, data.settings);
    await db.kv.bulkDelete(['lastRecipes', 'lastRecipesNote']);
  });
}

// ---------- Piano dei pasti ----------

/** Pasti tra due giorni compresi (AAAA-MM-GG). */
export async function mealsBetween(db: PantryDB, from: string, to: string): Promise<Meal[]> {
  return db.meals.where('date').between(from, to, true, true).toArray();
}

export async function saveMeals(db: PantryDB, meals: readonly Meal[]): Promise<void> {
  await db.meals.bulkPut(JSON.parse(JSON.stringify(meals)) as Meal[]);
}

export async function updateMeal(db: PantryDB, id: string, change: Partial<Omit<Meal, 'id'>>): Promise<void> {
  await db.meals.update(id, JSON.parse(JSON.stringify(change)) as Partial<Meal>);
}

export async function deleteMeal(db: PantryDB, id: string): Promise<void> {
  await db.meals.delete(id);
}

/** Toglie i pasti vecchi (più di 120 giorni fa): il piano resta leggero. */
export async function pruneMeals(db: PantryDB, before: string): Promise<number> {
  return db.meals.where('date').below(before).delete();
}
