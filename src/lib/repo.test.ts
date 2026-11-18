import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { PantryDB } from './db';
import { mealFromText } from './logic/meals';
import { draftFromName, itemFromDraft } from './logic/drafts';
import { defaultSettings } from './logic/settings';
import {
  addShopping,
  allHistory,
  allItems,
  allShopping,
  exportAll,
  getAiKey,
  importAll,
  loadSettings,
  mealsBetween,
  pruneMeals,
  saveMeals,
  updateMeal,
  recentTemplates,
  removeItem,
  saveItem,
  saveSettings,
  setAiKey,
  templateByBarcode,
  undoRemoval,
} from './repo';

const TODAY = '2026-11-15';
let db: PantryDB;

beforeEach(async () => {
  db = new PantryDB(`test-${Math.random()}`);
  await db.open();
});

describe('database', () => {
  it('salva, ricorda e riconosce il codice a barre', async () => {
    const it1 = itemFromDraft({ ...draftFromName('Yogurt greco', TODAY), barcode: '8000000000001' }, `${TODAY}T08:00:00.000Z`);
    await saveItem(db, it1, TODAY);
    expect(await allItems(db)).toHaveLength(1);
    expect((await templateByBarcode(db, '8000000000001'))?.name).toBe('Yogurt greco');
    expect(await recentTemplates(db)).toHaveLength(1);
  });

  it('finito, buttato e annulla', async () => {
    const it1 = itemFromDraft({ ...draftFromName('Latte', TODAY), expiry: '2026-11-10' }, `${TODAY}T08:00:00.000Z`);
    await saveItem(db, it1, TODAY);
    const r = await removeItem(db, it1, 'buttato', TODAY);
    expect(await allItems(db)).toHaveLength(0);
    const h = await allHistory(db);
    expect(h[0]).toMatchObject({ name: 'Latte', outcome: 'buttato', wasExpired: true });
    await undoRemoval(db, r);
    expect(await allItems(db)).toHaveLength(1);
    expect(await allHistory(db)).toHaveLength(0);
  });

  it('spesa senza doppioni', async () => {
    expect(await addShopping(db, 'Pane')).toBe(false);
    expect(await addShopping(db, 'pane')).toBe(true);
    expect(await allShopping(db)).toHaveLength(1);
  });

  it('la chiave di Gemini non va nel backup; il ripristino sostituisce tutto', async () => {
    await setAiKey(db, 'AQ.segreta');
    await saveSettings(db, { ...defaultSettings(), onboarded: true });
    await saveItem(db, itemFromDraft(draftFromName('Pasta', TODAY), `${TODAY}T08:00:00.000Z`), TODAY);
    const data = await exportAll(db);
    expect(JSON.stringify(data)).not.toContain('segreta');
    await importAll(db, { ...data, items: [] });
    expect(await allItems(db)).toHaveLength(0);
    expect(await getAiKey(db)).toBe('AQ.segreta');
    expect((await loadSettings(db)).onboarded).toBe(true);
  });

  it('piano dei pasti: salva, legge per settimana, segna fatto, va nel backup', async () => {
    const a = mealFromText('pasta al pesto', '2026-11-16', 'pranzo', 'x');
    const b = mealFromText('minestrone', '2026-11-23', 'cena', 'x');
    const old = mealFromText('pizza', '2026-01-02', 'cena', 'x');
    await saveMeals(db, [a, b, old]);
    expect((await mealsBetween(db, '2026-11-16', '2026-11-22')).map((m) => m.title)).toEqual(['Pasta al pesto']);
    await updateMeal(db, a.id, { done: true });
    expect((await mealsBetween(db, '2026-11-16', '2026-11-16'))[0]!.done).toBe(true);
    expect(await pruneMeals(db, '2026-07-01')).toBe(1);
    const data = await exportAll(db);
    expect(data.meals).toHaveLength(2);
    await importAll(db, { ...data, meals: [] });
    expect(await mealsBetween(db, '2000-01-01', '2100-01-01')).toHaveLength(0);
  });

  it('il database della 1.1 si aggiorna alla versione con i pasti senza perdere i prodotti', async () => {
    const name = `old-${Math.random()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ items: 'id, location, expiry, barcode, addedAt', history: '++id, date, outcome', shopping: 'id, done, order', templates: 'key, barcode, lastUsed', recipes: 'id, createdAt', kv: 'key' });
    await v1.table('items').put(itemFromDraft(draftFromName('Latte', TODAY), `${TODAY}T08:00:00.000Z`));
    v1.close();
    const v2 = new PantryDB(name);
    await v2.open();
    expect(await allItems(v2)).toHaveLength(1);
    expect(await v2.meals.count()).toBe(0);
  });
});
