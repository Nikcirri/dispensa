import { describe, expect, it } from 'vitest';
import type { Item } from '../types';
import {
  dayTitle,
  dishEmoji,
  firstFreeSlot,
  freeSlots,
  mealFromRecipe,
  mealFromText,
  mealsByDay,
  mealWarnings,
  nextSlot,
  plannedMealOf,
  plannedUses,
  shoppingForMeals,
  urgentNotPlanned,
  warningText,
  weekDays,
  weekRange,
  weekShareText,
  weekStart,
  weekStats,
  weekTitle,
  whenText,
  widgetMeals,
} from './meals';
import { buildPlanPrompt, parsePlan, planSlots, PLAN_SCHEMA } from './plan';
import type { Recipe } from './recipes';
import { widgetData } from './widget';

// Mercoledì 18 novembre 2026.
const TODAY = '2026-11-18';

function item(over: Partial<Item>): Item {
  return {
    id: 'x',
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
    addedAt: '',
    updatedAt: '',
    ...over,
  };
}

function recipe(over: Partial<Recipe>): Recipe {
  return { id: 'r', title: 'Frittata', emoji: '🍳', minutes: 15, difficulty: 'facile', servings: 2, uses: [], missing: [], steps: ['x'], why: '', tip: '', createdAt: '', ...over };
}

describe('piano dei pasti: settimane e giorni', () => {
  it('la settimana va da lunedì a domenica', () => {
    expect(weekStart(TODAY)).toBe('2026-11-16');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
    expect(weekDays('2026-11-16')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  });

  it('titoli e date in italiano', () => {
    expect(weekTitle('2026-11-16', TODAY)).toBe('Questa settimana');
    expect(weekTitle('2026-11-23', TODAY)).toBe('La prossima settimana');
    expect(weekTitle('2026-11-09', TODAY)).toBe('La settimana scorsa');
    expect(weekTitle('2026-12-07', TODAY)).toBe('Settimana del 7 dic');
    expect(weekRange('2026-11-16', TODAY)).toBe('16 – 22 nov');
    expect(weekRange('2026-11-30', TODAY)).toBe('30 nov – 6 dic');
    expect(dayTitle(TODAY, TODAY)).toBe('Oggi');
    expect(dayTitle('2026-11-19', TODAY)).toBe('Domani');
    expect(dayTitle('2026-11-20', TODAY)).toBe('Venerdì');
    expect(whenText('2026-11-20', 'cena', TODAY)).toBe('cena di venerdì 20');
    expect(whenText(TODAY, 'pranzo', TODAY)).toBe('pranzo di oggi');
  });

  it('prossimo pasto e pasti liberi secondo l’ora', () => {
    expect(nextSlot(TODAY, 9)).toEqual({ date: TODAY, slot: 'pranzo' });
    expect(nextSlot(TODAY, 16)).toEqual({ date: TODAY, slot: 'cena' });
    expect(nextSlot(TODAY, 23)).toEqual({ date: '2026-11-19', slot: 'pranzo' });
    const pranzo = mealFromText('pasta', TODAY, 'pranzo', 'x');
    expect(firstFreeSlot([pranzo], TODAY, 9)).toEqual({ date: TODAY, slot: 'cena' });
    // Alle 16 il pranzo di oggi è passato: restano la cena di oggi e i pasti dei giorni dopo.
    expect(freeSlots([], TODAY, 2, ['pranzo', 'cena'], TODAY, 16)).toEqual([
      { date: TODAY, slot: 'cena' },
      { date: '2026-11-19', slot: 'pranzo' },
      { date: '2026-11-19', slot: 'cena' },
    ]);
    expect(freeSlots([pranzo], '2026-11-16', 1, ['pranzo'], TODAY, 9)).toEqual([]);
  });

  it('icona del piatto dal nome e pasti divisi per giorno', () => {
    expect(dishEmoji('Spaghetti alle vongole')).toBe('🍝');
    expect(dishEmoji('Minestrone')).toBe('🍲');
    expect(dishEmoji('Polpette al sugo')).toBe('🥩');
    expect(dishEmoji('Qualcosa')).toBe('🍽️');
    const m = mealFromText('  pizza   margherita ', TODAY, 'cena', 'x');
    expect(m).toMatchObject({ title: 'Pizza margherita', emoji: '🍕', recipe: null, done: false });
    const byDay = mealsByDay([m], weekDays('2026-11-16'));
    expect(byDay.get(TODAY)!.cena).toHaveLength(1);
    expect(byDay.get(TODAY)!.pranzo).toHaveLength(0);
  });
});

describe('piano dei pasti: dispensa e spesa', () => {
  const mozzarella = item({ id: 'mozz', name: 'Mozzarella', expiry: TODAY });
  const zucchine = item({ id: 'zuc', name: 'Zucchine', expiry: '2026-11-25' });
  const biscotti = item({ id: 'bis', name: 'Biscotti', expiry: '2026-11-17', expiryKind: 'tmc' });
  const items = [mozzarella, zucchine, biscotti];
  const use = (itemId: string, name: string) => ({ itemId, name, emoji: '🛒', amount: '1' });
  const friday = mealFromRecipe(
    recipe({ title: 'Parmigiana', uses: [use('mozz', 'Mozzarella'), use('zuc', 'Zucchine'), use('bis', 'Biscotti'), use('gone', 'Uova')], missing: [{ name: 'Basilico', amount: '1 mazzetto' }] }),
    '2026-11-20',
    'cena',
    'x',
  );

  it('avvisa se un ingrediente scade prima del pasto o non c’è più (non per un TMC)', () => {
    const w = mealWarnings(friday, items, TODAY);
    expect(w.map((x) => x.kind)).toEqual(['prima', 'manca']);
    expect(warningText(w[0]!, TODAY)).toBe('Mozzarella scade oggi');
    expect(warningText(w[1]!, TODAY)).toBe('Uova: non c’è più in dispensa');
    expect(mealWarnings({ ...friday, done: true }, items, TODAY)).toEqual([]);
  });

  it('cucinando una ricetta del piano si trova il pasto da segnare fatto', () => {
    const r = friday.recipe!;
    expect(plannedMealOf(r.id, [friday], TODAY)?.id).toBe(friday.id);
    expect(plannedMealOf(r.id, [{ ...friday, done: true }], TODAY)).toBeNull();
    expect(plannedMealOf(r.id, [{ ...friday, date: '2026-11-10' }], TODAY)).toBeNull();
    expect(plannedMealOf('altra', [friday], TODAY)).toBeNull();
  });

  it('prodotti già nel piano e quelli urgenti ancora senza pasto', () => {
    expect(plannedUses([friday], TODAY).get('mozz')?.title).toBe('Parmigiana');
    expect(urgentNotPlanned(items, [friday], TODAY)).toEqual([]);
    expect(urgentNotPlanned(items, [], TODAY).map((i) => i.name)).toEqual(['Biscotti', 'Mozzarella']);
  });

  it('ingredienti da comprare per la settimana, senza doppioni né quelli già in lista', () => {
    const days = weekDays('2026-11-16');
    const list = shoppingForMeals([friday], days, items, [], TODAY);
    expect(list.map((x) => x.name)).toEqual(['Basilico', 'Uova']);
    expect(list[0]!.for).toBe('Parmigiana');
    const inList = [{ id: 's', name: 'basilico', emoji: '🌿', note: '', done: false, addedAt: '', order: 0 }];
    expect(shoppingForMeals([friday], days, items, inList, TODAY).map((x) => x.name)).toEqual(['Uova']);
    expect(shoppingForMeals([friday], weekDays('2026-11-23'), items, [], TODAY)).toEqual([]);
  });

  it('numeri della settimana, testo da condividere e dati del widget', () => {
    const days = weekDays('2026-11-16');
    const pasta = mealFromText('pasta al pesto', TODAY, 'pranzo', 'x');
    expect(weekStats([friday, pasta], days, items, TODAY)).toEqual({ planned: 2, total: 14, rescued: 2 });
    const text = weekShareText([friday, pasta], days);
    expect(text).toContain('📅 Mercoledì 18 novembre');
    expect(text).toContain('☀️ Pranzo: 🍝 Pasta al pesto');
    expect(widgetMeals([friday, pasta, mealFromText('vecchio', '2026-11-10', 'cena', 'x')], TODAY).map((m) => m.title)).toEqual(['Pasta al pesto', 'Parmigiana']);
  });
});

describe('programma con l’IA', () => {
  const items = [item({ id: 'mozz', name: 'Mozzarella', expiry: TODAY }), item({ id: 'pasta', name: 'Pasta', location: 'dispensa', expiry: '2027-06-01', expiryKind: 'tmc' })];

  it('chiede una ricetta per ogni pasto libero, con le regole anti-spreco', () => {
    const slots = planSlots(freeSlots([], TODAY, 2, ['cena'], TODAY, 10));
    expect(slots.map((s) => s.code)).toEqual(['s1', 's2']);
    const { prompt, refs } = buildPlanPrompt(items, TODAY, slots, { servings: 3, vegetarian: true, lactoseFree: false, glutenFree: false, onlyPantry: false, staples: ['sale'], extra: 'pesce venerdì' });
    expect(refs).toHaveLength(2);
    expect(prompt).toContain('s1 | mercoledì 18 novembre (oggi) | cena');
    expect(prompt).toContain('s2 | giovedì 19 novembre (domani) | cena');
    expect(prompt).toContain('per 3 persone');
    expect(prompt).toContain('vegetariane');
    expect(prompt).toContain('pesce venerdì');
    expect(PLAN_SCHEMA.required).toEqual(['meals', 'note']);
  });

  it('legge la risposta: un pasto per codice, codici sconosciuti scartati, in ordine', () => {
    const slots = planSlots(freeSlots([], TODAY, 2, ['cena'], TODAY, 10));
    const { refs } = buildPlanPrompt(items, TODAY, slots, { servings: 2, vegetarian: false, lactoseFree: false, glutenFree: false, onlyPantry: false, staples: [], extra: '' });
    const meal = (slot: string, title: string) => ({ slot, title, emoji: '🍝', minutes: 20, difficulty: 'facile', servings: 2, uses: [{ ref: 'p1', amount: '1' }], missing: [], steps: ['Cuoci.'], why: '', tip: '' });
    const text = JSON.stringify({ meals: [meal('s2', 'Pasta e fagioli'), meal('s1', 'Caprese'), meal('s1', 'Doppione'), meal('s9', 'Sconosciuto')], note: '' });
    const r = parsePlan(text, refs, slots, 2, 'now')!;
    expect(r.proposals.map((p) => [p.slot.code, p.recipe.title])).toEqual([
      ['s1', 'Caprese'],
      ['s2', 'Pasta e fagioli'],
    ]);
    expect(r.proposals[0]!.recipe.uses[0]!.itemId).toBe('mozz');
    expect(parsePlan('niente', refs, slots, 2, 'now')).toBeNull();
  });
});

describe('dati dei widget', () => {
  it('prodotti in ordine di scadenza (quella che conta, anche da aperto) e pasti da oggi', () => {
    const latte = item({ id: 'l', name: 'Latte', expiry: '2026-11-30', openedAt: '2026-11-17', openDays: 3 });
    const pasta = item({ id: 'p', name: 'Pasta', emoji: '', expiry: null });
    const yogurt = item({ id: 'y', name: 'Yogurt', expiry: '2026-11-19', expiryKind: 'tmc' });
    const d = widgetData([pasta, latte, yogurt], [mealFromText('pizza', TODAY, 'cena', 'x')], TODAY);
    expect(d.products.map((p) => [p.name, p.expiry, p.kind])).toEqual([
      ['Yogurt', '2026-11-19', 'tmc'],
      ['Latte', '2026-11-20', 'scadenza'],
      ['Pasta', '', 'scadenza'],
    ]);
    expect(d.products[2]!.emoji).toBe('🛒');
    expect(d.total).toBe(3);
    expect(d.meals).toEqual([{ date: TODAY, slot: 'cena', title: 'Pizza', emoji: '🍕', done: false }]);
  });
});
