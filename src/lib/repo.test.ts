import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PantryDB } from './db';
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
});
