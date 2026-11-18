import { describe, expect, it } from 'vitest';
import type { HistoryEntry, Item } from '../types';
import { BackupError, makeBackup, parseBackup } from './backup';
import { addDays, addMonths, daysBetween, formatShort, greeting, isDateKey, lastDayOfMonth } from './dates';
import { draftFromName, itemFromDraft, templateFromItem, templateKey } from './drafts';
import { badgeText, compareByExpiry, daysLeft, effectiveExpiry, expiryText, limitedByOpening, urgencyOf } from './expiry';
import { formatQuantity, guessFood, quantityStep } from './foods';
import { planExpiryNotifications } from './notify';
import { parseProductResponse } from './off';
import { filterItems, groupByUrgency, itemsToUseFirst, mostWasted, monthStats, sortItems, summarize } from './pantry';
import { defaultSettings, sanitizeSettings } from './settings';
import { addToList, shoppingShareText, sortShopping, splitNames } from './shopping';
import { joinNames, matchesQuery, normalize } from './text';

const TODAY = '2026-11-15';

function item(over: Partial<Item> = {}): Item {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    name: 'Latte',
    emoji: '🥛',
    location: 'frigo',
    quantity: 1,
    unit: 'pz',
    expiry: null,
    expiryKind: 'scadenza',
    expiryEstimated: false,
    openedAt: null,
    openDays: null,
    source: 'mano',
    addedAt: `${TODAY}T10:00:00.000Z`,
    updatedAt: `${TODAY}T10:00:00.000Z`,
    ...over,
  };
}

describe('date', () => {
  it('conti dei giorni anche a cavallo dei mesi e dell’ora legale', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween(TODAY, '2026-11-14')).toBe(-1);
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(lastDayOfMonth(2028, 2)).toBe('2028-02-29');
  });
  it('date valide e testi', () => {
    expect(isDateKey('2027-02-29')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('12/03/2027')).toBe(false);
    expect(formatShort('2026-12-03', TODAY)).toBe('3 dic');
    expect(formatShort('2027-03-12', TODAY)).toBe('12 mar 2027');
    expect(greeting(9)).toBe('Buongiorno');
    expect(greeting(15)).toBe('Buon pomeriggio');
    expect(greeting(22)).toBe('Buonasera');
  });
});

describe('scadenze', () => {
  it('colori del bollino: rosso oggi e domani, arancione fino a 5 giorni', () => {
    expect(urgencyOf(null)).toBe('nessuna');
    expect(urgencyOf(-1)).toBe('scaduto');
    expect(urgencyOf(0)).toBe('rosso');
    expect(urgencyOf(1)).toBe('rosso');
    expect(urgencyOf(2)).toBe('arancione');
    expect(urgencyOf(5)).toBe('arancione');
    expect(urgencyOf(6)).toBe('verde');
  });
  it('un prodotto aperto scade prima', () => {
    const milk = item({ expiry: '2026-11-25', openedAt: '2026-11-14', openDays: 3 });
    expect(effectiveExpiry(milk)).toBe('2026-11-17');
    expect(limitedByOpening(milk)).toBe(true);
    expect(daysLeft(milk, TODAY)).toBe(2);
    // Se la confezione scade prima, vale la confezione.
    const soon = item({ expiry: '2026-11-16', openedAt: TODAY, openDays: 5 });
    expect(effectiveExpiry(soon)).toBe('2026-11-16');
    expect(limitedByOpening(soon)).toBe(false);
  });
  it('testi', () => {
    expect(badgeText(0, 'scadenza')).toBe('Oggi');
    expect(badgeText(1, 'scadenza')).toBe('Domani');
    expect(badgeText(3, 'scadenza')).toBe('3 giorni');
    expect(badgeText(-2, 'scadenza')).toBe('Scaduto');
    expect(badgeText(-2, 'tmc')).toBe('TMC passato');
    expect(badgeText(90, 'tmc')).toBe('3 mesi');
    expect(expiryText(-1, 'scadenza', '2026-11-14', TODAY)).toBe('Scaduto ieri');
    expect(expiryText(3, 'scadenza', '2026-11-18', TODAY)).toBe('Scade tra 3 giorni (18 nov)');
  });
  it('ordine: prima chi scade prima, senza data in fondo', () => {
    const list = [item({ name: 'B', expiry: null }), item({ name: 'C', expiry: '2026-11-20' }), item({ name: 'A', expiry: '2026-11-16' })];
    expect([...list].sort(compareByExpiry).map((i) => i.name)).toEqual(['A', 'C', 'B']);
  });
});

describe('conoscenze sui cibi', () => {
  it('indovina icona, posto e durata', () => {
    expect(guessFood('Latte parzialmente scremato')).toMatchObject({ emoji: '🥛', location: 'frigo', openDays: 3, kind: 'scadenza' });
    expect(guessFood('Latte UHT intero')).toMatchObject({ location: 'dispensa', kind: 'tmc' });
    expect(guessFood('Spaghetti n.5')).toMatchObject({ emoji: '🍝', location: 'dispensa', kind: 'tmc' });
    expect(guessFood('Piselli surgelati')).toMatchObject({ location: 'freezer' });
    expect(guessFood('Tonno all’olio')).toMatchObject({ location: 'dispensa' });
    expect(guessFood('Mozzarella di bufala').emoji).toBe('🧀');
    expect(guessFood('Mozzarella fior di latte').emoji).toBe('🧀');
    expect(guessFood('Banane').emoji).toBe('🍌');
    expect(guessFood('Cosa strana').emoji).toBe('🛒');
  });
  it('quantità', () => {
    expect(formatQuantity(1.5, 'l')).toBe('1,5 l');
    expect(formatQuantity(2, 'conf')).toBe('2 conf.');
    expect(quantityStep('pz', 3)).toBe(1);
    expect(quantityStep('g', 500)).toBe(50);
    expect(quantityStep('g', 100)).toBe(10);
  });
});

describe('dispensa', () => {
  const list = [
    item({ name: 'Yogurt', expiry: '2026-11-16' }),
    item({ name: 'Pasta', location: 'dispensa', expiry: '2027-06-01', expiryKind: 'tmc' }),
    item({ name: 'Piselli', location: 'freezer', expiry: '2026-11-19' }),
    item({ name: 'Prosciutto', expiry: '2026-11-13' }),
    item({ name: 'Biscotti', location: 'dispensa', expiry: '2026-11-12', expiryKind: 'tmc' }),
    item({ name: 'Sale', location: 'dispensa', expiry: null }),
  ];
  it('filtra per posto e per testo', () => {
    expect(filterItems(list, 'freezer', '').map((i) => i.name)).toEqual(['Piselli']);
    expect(filterItems(list, 'tutto', 'yog').map((i) => i.name)).toEqual(['Yogurt']);
    expect(matchesQuery('Caffè macinato', 'caffe mac')).toBe(true);
    expect(normalize('  Perché  ')).toBe('perche');
  });
  it('gruppi per colore e riassunto', () => {
    const groups = groupByUrgency(sortItems(list, 'scadenza'), TODAY);
    expect(groups.map((g) => g.id)).toEqual(['scaduto', 'rosso', 'arancione', 'verde', 'nessuna']);
    expect(summarize(list, TODAY)).toEqual({ total: 6, expired: 2, urgent: 1, soon: 1 });
  });
  it('da usare per primi: niente "da consumarsi entro" già passati', () => {
    const names = itemsToUseFirst(list, TODAY).map((i) => i.name);
    expect(names).toEqual(['Biscotti', 'Yogurt', 'Piselli']);
  });
  it('statistiche anti-spreco', () => {
    const h: HistoryEntry[] = [
      { at: '', date: '2026-11-02', name: 'Insalata', emoji: '🥬', location: 'frigo', outcome: 'buttato', wasExpired: true },
      { at: '', date: '2026-11-05', name: 'insalata', emoji: '🥬', location: 'frigo', outcome: 'buttato', wasExpired: true },
      { at: '', date: '2026-11-06', name: 'Latte', emoji: '🥛', location: 'frigo', outcome: 'consumato', wasExpired: false },
      { at: '', date: '2026-11-07', name: 'Pane', emoji: '🍞', location: 'dispensa', outcome: 'consumato', wasExpired: false },
      { at: '', date: '2026-10-07', name: 'Pane', emoji: '🍞', location: 'dispensa', outcome: 'consumato', wasExpired: false },
    ];
    expect(monthStats(h, '2026-11')).toMatchObject({ consumed: 2, wasted: 2, savedPct: 50, label: 'novembre 2026' });
    expect(mostWasted(h)).toEqual([{ name: 'Insalata', emoji: '🥬', count: 2 }]);
  });
});

describe('bozze e prodotti ricordati', () => {
  it('dal nome: scadenza stimata', () => {
    const d = draftFromName('latte fresco', TODAY);
    expect(d).toMatchObject({ name: 'Latte fresco', location: 'frigo', expiry: '2026-11-21', expiryEstimated: true });
  });
  it('il prodotto ricorda quanto dura', () => {
    const it1 = itemFromDraft({ ...draftFromName('Yogurt', TODAY), expiry: '2026-11-29', barcode: '8000500310427' }, `${TODAY}T09:00:00.000Z`);
    const t = templateFromItem(it1, undefined, TODAY);
    expect(t.key).toBe('b:8000500310427');
    expect(t.shelfDays).toBe(14);
    expect(t.uses).toBe(1);
    expect(templateKey({ name: 'Pane Integrale ' })).toBe('n:pane integrale');
  });
});

describe('codice a barre (Open Food Facts)', () => {
  it('legge nome, marca, formato, foto e posto', () => {
    const json = {
      status: 1,
      product: {
        product_name_it: 'Latte fresco parzialmente scremato',
        brands: 'Granarolo, Altro',
        quantity: '1 l',
        categories_tags: ['en:dairies', 'en:milks'],
        image_front_small_url: 'https://images.openfoodfacts.org/x.jpg',
      },
    };
    const r = parseProductResponse(json, '8002670000000', TODAY);
    expect(r.kind).toBe('found');
    if (r.kind === 'found') {
      expect(r.draft).toMatchObject({ name: 'Latte fresco parzialmente scremato', brand: 'Granarolo', size: '1 l', location: 'frigo', barcode: '8002670000000' });
      expect(r.draft.imageUrl).toContain('https://');
    }
  });
  it('surgelati dalle categorie, prodotto mancante', () => {
    const r = parseProductResponse({ status: 1, product: { product_name: 'Minestrone', categories_tags: ['en:frozen-foods'] } }, '123', TODAY);
    expect(r.kind === 'found' && r.draft.location).toBe('freezer');
    expect(parseProductResponse({ status: 0 }, '123', TODAY).kind).toBe('missing');
  });
});

describe('spesa', () => {
  it('niente doppioni: chi c’è già torna in cima', () => {
    const a = addToList([], 'latte', '', 'x').item;
    const b = addToList([a], 'Pane', '2', 'x').item;
    const again = addToList([{ ...a, done: true }, b], 'LATTE');
    expect(again.existed).toBe(true);
    expect(again.item.done).toBe(false);
    expect(again.item.order).toBeLessThan(b.order);
    expect(sortShopping([{ ...a, done: true }, b]).map((x) => x.name)).toEqual(['Pane', 'Latte']);
    expect(shoppingShareText([b])).toBe('🛒 Lista della spesa\n• Pane (2)');
  });
  it('più nomi insieme', () => {
    expect(splitNames('latte, pane e uova')).toEqual(['latte', 'pane', 'uova']);
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B e C');
    expect(joinNames(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C e altri 2');
  });
});

describe('avvisi delle scadenze', () => {
  it('solo nei giorni con qualcosa che scade oggi o domani, all’ora scelta', () => {
    const now = new Date(2026, 10, 15, 9, 0);
    const list = [item({ name: 'Latte', expiry: '2026-11-15' }), item({ name: 'Yogurt', expiry: '2026-11-16' }), item({ name: 'Pasta', expiry: '2026-11-20' })];
    const plan = planExpiryNotifications(list, now, 18, 0);
    expect(plan.map((p) => p.at.getDate())).toEqual([15, 16, 19, 20]);
    expect(plan[0]!.title).toBe('Scade oggi: Latte');
    expect(plan[0]!.body).toContain('Domani: Yogurt');
    expect(plan[2]!.title).toBe('Domani scade: Pasta');
    // Ora già passata: oggi niente.
    expect(planExpiryNotifications(list, new Date(2026, 10, 15, 19, 0), 18, 0)[0]!.at.getDate()).toBe(16);
  });
});

describe('impostazioni e backup', () => {
  it('impostazioni rovinate tornano ai valori di partenza', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
    const s = sanitizeSettings({ notify: { enabled: false, hour: 30 }, recipes: { servings: 0, staples: ['sale', 3] } });
    expect(s.notify).toEqual({ enabled: false, hour: 23, minute: 0 });
    expect(s.recipes.servings).toBe(1);
    expect(s.recipes.staples).toEqual(['sale']);
  });
  it('backup: va e torna, e rifiuta i file sbagliati', () => {
    const data = {
      settings: defaultSettings(),
      items: [item({ name: 'Latte', expiry: '2026-11-20' })],
      history: [{ at: 'x', date: TODAY, name: 'Pane', emoji: '🍞', location: 'dispensa' as const, outcome: 'consumato' as const, wasExpired: false }],
      shopping: [],
      templates: [],
      recipes: [],
      meals: [
        { id: 'm1', date: '2026-11-19', slot: 'cena' as const, title: 'Pasta al pesto', emoji: '🍝', recipe: null, note: '', done: false, createdAt: 'x' },
        { id: 'm2', date: 'ieri', slot: 'cena' as const, title: 'Rovinato', emoji: '', recipe: null, note: '', done: false, createdAt: 'x' },
      ],
    };
    const back = parseBackup(makeBackup(data, '1.0.0'));
    expect(back.items[0]!.name).toBe('Latte');
    expect(back.meals.map((m) => m.title)).toEqual(['Pasta al pesto']);
    // I backup delle versioni prima della 1.2.0 non hanno il piano dei pasti.
    expect(parseBackup(JSON.stringify({ app: 'dispensa', format: 1, data: { settings: {} } })).meals).toEqual([]);
    expect(back.history).toHaveLength(1);
    expect(back.settings.onboarded).toBe(true);
    expect(() => parseBackup('{"app":"nutrizione","data":{}}')).toThrow(BackupError);
    expect(() => parseBackup('ciao')).toThrow(BackupError);
  });
});
