// Piano dei pasti: pranzo e cena di ogni giorno, settimana per settimana.
// Un pasto può venire da una ricetta (dell'IA o salvata) oppure essere scritto a mano ("pasta al pesto").
import type { Item, ShoppingItem } from '../types';
import { addDays, daysBetween, formatShort, formatWeekday, isDateKey, weekdayIndex, weekdayName } from './dates';
import { daysLeft, effectiveExpiry, isUrgent } from './expiry';
import { sanitizeRecipe, type Recipe } from './recipes';
import { capitalize, newId, normalize } from './text';

export type MealSlot = 'pranzo' | 'cena';

export interface Meal {
  id: string;
  /** Giorno del pasto, AAAA-MM-GG. */
  date: string;
  slot: MealSlot;
  title: string;
  emoji: string;
  /** La ricetta completa, se il pasto viene da una ricetta. */
  recipe: Recipe | null;
  note: string;
  /** Già cucinato. */
  done: boolean;
  createdAt: string;
}

export const SLOTS: readonly { id: MealSlot; label: string; emoji: string }[] = [
  { id: 'pranzo', label: 'Pranzo', emoji: '☀️' },
  { id: 'cena', label: 'Cena', emoji: '🌙' },
];

export function isMealSlot(v: unknown): v is MealSlot {
  return v === 'pranzo' || v === 'cena';
}

export function slotLabel(slot: MealSlot): string {
  return slot === 'pranzo' ? 'Pranzo' : 'Cena';
}

// ---------- Settimane e giorni ----------

/** Lunedì della settimana di un giorno. */
export function weekStart(key: string): string {
  return addDays(key, -((weekdayIndex(key) + 6) % 7));
}

/** I 7 giorni da lunedì a domenica. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** "Questa settimana", "La prossima settimana", "La settimana scorsa" o "Settimana del 7 dic". */
export function weekTitle(start: string, today: string): string {
  const diff = daysBetween(weekStart(today), start) / 7;
  if (diff === 0) return 'Questa settimana';
  if (diff === 1) return 'La prossima settimana';
  if (diff === -1) return 'La settimana scorsa';
  return `Settimana del ${formatShort(start, today)}`;
}

/** "16 – 22 nov" oppure "30 nov – 6 dic". */
export function weekRange(start: string, today: string): string {
  const end = addDays(start, 6);
  const a = formatShort(start, today);
  const b = formatShort(end, today);
  return start.slice(0, 7) === end.slice(0, 7) ? `${a.split(' ')[0]} – ${b}` : `${a} – ${b}`;
}

/** "Oggi", "Domani", "Ieri" oppure il giorno della settimana con l'iniziale grande. */
export function dayTitle(key: string, today: string): string {
  const d = daysBetween(today, key);
  if (d === 0) return 'Oggi';
  if (d === 1) return 'Domani';
  if (d === -1) return 'Ieri';
  return capitalize(weekdayName(key));
}

/** "mercoledì 18" quando il titolo è "Oggi"/"Domani", altrimenti solo "18 nov". */
export function daySubtitle(key: string, today: string): string {
  const d = daysBetween(today, key);
  if (d >= -1 && d <= 1) return `${weekdayName(key)} ${Number(key.slice(8))}`;
  return formatShort(key, today);
}

/** "pranzo di oggi", "cena di domani", "cena di venerdì 20". */
export function whenText(date: string, slot: MealSlot, today: string): string {
  const d = daysBetween(today, date);
  const day = d === 0 ? 'oggi' : d === 1 ? 'domani' : d === -1 ? 'ieri' : `${weekdayName(date)} ${Number(date.slice(8))}`;
  return `${slot} di ${day}`;
}

/** Il prossimo pasto da preparare: pranzo fino alle 15, poi cena fino alle 22, poi il pranzo di domani. */
export function nextSlot(today: string, hour: number): { date: string; slot: MealSlot } {
  if (hour < 15) return { date: today, slot: 'pranzo' };
  if (hour < 22) return { date: today, slot: 'cena' };
  return { date: addDays(today, 1), slot: 'pranzo' };
}

/** Il pasto è già passato (giorni prima di oggi, o il pranzo di oggi dopo le 15). */
export function isPastSlot(date: string, slot: MealSlot, today: string, hour: number): boolean {
  if (date < today) return true;
  if (date > today) return false;
  return slot === 'pranzo' ? hour >= 15 : hour >= 22;
}

function slotOrder(slot: MealSlot): number {
  return slot === 'pranzo' ? 0 : 1;
}

/** Ordine: giorno, pranzo prima della cena, poi in ordine di inserimento. */
export function compareMeals(a: Meal, b: Meal): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.slot !== b.slot) return slotOrder(a.slot) - slotOrder(b.slot);
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export type DayMeals = Record<MealSlot, Meal[]>;

/** I pasti di ogni giorno, divisi tra pranzo e cena. */
export function mealsByDay(meals: readonly Meal[], days: readonly string[]): Map<string, DayMeals> {
  const map = new Map<string, DayMeals>();
  for (const d of days) map.set(d, { pranzo: [], cena: [] });
  for (const m of [...meals].sort(compareMeals)) map.get(m.date)?.[m.slot].push(m);
  return map;
}

/** Il primo pasto libero (pranzo o cena) da adesso in avanti, entro due settimane. */
export function firstFreeSlot(meals: readonly Meal[], today: string, hour: number): { date: string; slot: MealSlot } {
  const start = nextSlot(today, hour);
  let cur = start;
  for (let i = 0; i < 28; i++) {
    const c = cur;
    if (!meals.some((m) => m.date === c.date && m.slot === c.slot)) return c;
    cur = c.slot === 'pranzo' ? { date: c.date, slot: 'cena' } : { date: addDays(c.date, 1), slot: 'pranzo' };
  }
  return start;
}

/** I pasti liberi da adesso per `days` giorni (dal primo giorno `from` non passato), solo per i pasti scelti. */
export function freeSlots(
  meals: readonly Meal[],
  from: string,
  days: number,
  slots: readonly MealSlot[],
  today: string,
  hour: number,
): { date: string; slot: MealSlot }[] {
  const out: { date: string; slot: MealSlot }[] = [];
  const first = from < today ? today : from;
  for (let i = 0; i < days; i++) {
    const date = addDays(first, i);
    for (const s of SLOTS) {
      if (!slots.includes(s.id) || isPastSlot(date, s.id, today, hour)) continue;
      if (!meals.some((m) => m.date === date && m.slot === s.id)) out.push({ date, slot: s.id });
    }
  }
  return out;
}

// ---------- Nuovi pasti ----------

const DISHES: readonly [RegExp, string][] = [
  [/pizz/, '🍕'],
  [/risott|riso\b|paella/, '🍚'],
  [/zupp|minestr|brodo|vellutat|passato di/, '🍲'],
  [/pasta|spaghett|penne|fusill|rigaton|linguin|tagliatell|lasagn|gnocch|ravioli|tortellin|maccheron|orecchiett|carbonar|amatrician/, '🍝'],
  [/insalat|caprese/, '🥗'],
  [/frittat|uov|omelette/, '🍳'],
  [/pesce|salmon|merluzz|tonno|orata|branzin|gamber|cozz|vongol|calamar|baccal|sogliol/, '🐟'],
  [/pollo|tacchin/, '🍗'],
  [/carne|bistecc|arrost|polpett|hamburger|scaloppin|cotolett|salsicc|maiale|manzo|vitello|spezzatin|ragu|ragù/, '🥩'],
  [/panin|toast|piadin|tramezzin|sandwich|focacc/, '🥪'],
  [/torta|dolce|biscott|crostat|tiramis|budin/, '🍰'],
  [/ceci|fagiol|lenticch|legum|piselli/, '🫘'],
  [/verdur|zucchin|melanzan|peperon|spinac|broccol|cavol|funghi|patat/, '🥦'],
  [/avanz|fuori|ristorant|pizzeria|sushi|kebab/, '🥡'],
];

/** Icona del piatto dal nome (🍽️ se non si capisce). */
export function dishEmoji(title: string): string {
  const n = normalize(title);
  return DISHES.find(([re]) => re.test(n))?.[1] ?? '🍽️';
}

export function mealFromRecipe(recipe: Recipe, date: string, slot: MealSlot, nowIso: string): Meal {
  return {
    id: newId(),
    date,
    slot,
    title: recipe.title,
    emoji: recipe.emoji || dishEmoji(recipe.title),
    recipe: JSON.parse(JSON.stringify(recipe)) as Recipe,
    note: '',
    done: false,
    createdAt: nowIso,
  };
}

export function mealFromText(text: string, date: string, slot: MealSlot, nowIso: string): Meal {
  const title = capitalize(text.trim().replace(/\s+/g, ' ').slice(0, 80));
  return { id: newId(), date, slot, title, emoji: dishEmoji(title), recipe: null, note: '', done: false, createdAt: nowIso };
}

// ---------- Controlli con la dispensa ----------

export interface MealWarning {
  /** `prima`: il prodotto scade prima del pasto; `manca`: non è più in dispensa. */
  kind: 'prima' | 'manca';
  name: string;
  emoji: string;
  /** Data di scadenza (per `prima`). */
  date: string;
}

/** Avvisi per un pasto ancora da fare: ingredienti che scadono prima o che non ci sono più. */
export function mealWarnings(meal: Meal, items: readonly Item[], today: string): MealWarning[] {
  if (!meal.recipe || meal.done || meal.date < today) return [];
  const out: MealWarning[] = [];
  const recipe = relinkRecipe(meal.recipe, items) ?? meal.recipe;
  for (const u of recipe.uses) {
    if (!u.itemId) continue;
    const item = items.find((i) => i.id === u.itemId);
    if (!item) {
      out.push({ kind: 'manca', name: u.name, emoji: u.emoji, date: '' });
      continue;
    }
    const e = effectiveExpiry(item);
    // Un "preferibilmente entro" passato di qualche giorno di solito è ancora buono: niente avviso.
    if (e && e < meal.date && item.expiryKind !== 'tmc') out.push({ kind: 'prima', name: item.name, emoji: item.emoji, date: e });
  }
  return out;
}

export function warningText(w: MealWarning, today: string): string {
  if (w.kind === 'manca') return `${w.name}: non c’è più in dispensa`;
  const d = daysBetween(today, w.date);
  const when = d < 0 ? 'è già scaduto' : d === 0 ? 'scade oggi' : d === 1 ? 'scade domani' : `scade prima (${formatShort(w.date, today)})`;
  return `${w.name} ${when}`;
}

/** Per ogni prodotto, i pasti ancora da fare che lo usano (da oggi in avanti, il più vicino per primo). */
export function plannedUses(meals: readonly Meal[], today: string, items: readonly Item[] = []): Map<string, Meal[]> {
  const map = new Map<string, Meal[]>();
  for (const m of [...meals].sort(compareMeals)) {
    if (m.done || m.date < today || !m.recipe) continue;
    for (const u of (relinkRecipe(m.recipe, items) ?? m.recipe).uses) {
      if (!u.itemId) continue;
      const list = map.get(u.itemId);
      if (list) {
        if (!list.includes(m)) list.push(m);
      } else map.set(u.itemId, [m]);
    }
  }
  return map;
}

/** "In programma: cena di venerdì 20" (+ quanti altri pasti lo usano). */
export function plannedText(meals: readonly Meal[], today: string): string {
  const first = meals[0];
  if (!first) return '';
  const more = meals.length - 1;
  return `In programma: ${whenText(first.date, first.slot, today)}${more > 0 ? ` (+${more})` : ''}`;
}

/** Il pasto ancora da fare con questa ricetta (da ieri in avanti, il più vicino): cucinandola diventa fatto. */
export function plannedMealOf(recipeId: string, meals: readonly Meal[], today: string): Meal | null {
  const from = addDays(today, -1);
  return [...meals].sort(compareMeals).find((m) => !m.done && m.recipe?.id === recipeId && m.date >= from) ?? null;
}

/** Prodotti da usare subito (oggi, domani o scaduti da poco) che nessun pasto in programma usa. */
export function urgentNotPlanned(items: readonly Item[], meals: readonly Meal[], today: string, max = 4): Item[] {
  const planned = plannedUses(meals, today, items);
  return items
    .filter((i) => {
      const d = daysLeft(i, today);
      if (d === null || planned.has(i.id)) return false;
      return isUrgent(d) && (d >= 0 || i.expiryKind === 'tmc');
    })
    .sort((a, b) => (effectiveExpiry(a) ?? '').localeCompare(effectiveExpiry(b) ?? ''))
    .slice(0, max);
}

// ---------- Ingredienti comprati dopo ----------

const STOP_WORDS = new Set(['del', 'dei', 'della', 'delle', 'dello', 'degli', 'alla', 'alle', 'allo', 'con', 'per', 'gli', 'una', 'uno', 'senza']);
/** Parole che fanno un prodotto diverso: "Pomodori" non sono "Pomodori pelati". */
const OTHER_PRODUCT = ['pelat', 'passat', 'concentrat', 'polver', 'condensat', 'sciroppat', 'scatol', 'sottolio', 'sottacet'];

/** "Pomodori pelati" → ["pomodor", "pelat"]: parole senza la vocale finale (pomodoro/pomodori, carota/carote). */
export function nameStems(name: string): string[] {
  return normalize(name)
    .split(' ')
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 ? w.replace(/[aeiou]+$/, '') : w));
}

/**
 * Il prodotto della dispensa che corrisponde a un ingrediente scritto ("Pomodori pelati", "Uova"):
 * stesso nome, oppure stesse parole al singolare/plurale, oppure un prodotto con qualche parola in più
 * ("Latte" → "Latte parzialmente scremato") ma non un prodotto diverso ("Pomodori" ≠ "Pomodori pelati").
 */
export function findInPantry(name: string, items: readonly Item[], exclude: ReadonlySet<string> = new Set()): Item | null {
  const target = nameStems(name);
  if (!target.length) return null;
  const candidates = items.filter((i) => !exclude.has(i.id));
  const n = normalize(name);
  const exact = candidates.find((i) => normalize(i.name) === n);
  if (exact) return exact;
  const key = target.join(' ');
  const same = candidates.find((i) => nameStems(i.name).join(' ') === key);
  if (same) return same;
  const containing = candidates
    .filter((i) => {
      const words = nameStems(i.name);
      if (!target.every((t) => words.includes(t))) return false;
      const extra = words.filter((w) => !target.includes(w));
      return !extra.some((w) => OTHER_PRODUCT.some((o) => w.startsWith(o)));
    })
    .sort((a, b) => a.name.length - b.name.length);
  return containing[0] ?? null;
}

/**
 * Collega la ricetta alla dispensa di adesso:
 * - gli ingredienti "da comprare" che ora ci sono (comprati, o aggiunti dopo) diventano prodotti usati:
 *   non risultano più mancanti e in Dispensa sono "In programma";
 * - un prodotto usato che non c'è più (finito) si ricollega a uno uguale comprato di nuovo.
 * Restituisce null se non cambia niente.
 */
export function relinkRecipe(recipe: Recipe, items: readonly Item[]): Recipe | null {
  const present = new Set(items.map((i) => i.id));
  const taken = new Set(recipe.uses.map((u) => u.itemId).filter((id): id is string => !!id && present.has(id)));
  let changed = false;
  const uses = recipe.uses.map((u) => {
    if (u.itemId && present.has(u.itemId)) return u;
    const item = findInPantry(u.name, items, taken);
    if (!item) return u;
    taken.add(item.id);
    changed = true;
    return { ...u, itemId: item.id, name: item.name, emoji: item.emoji || u.emoji };
  });
  const found = new Map<number, Item>();
  // Prima i nomi uguali, poi le corrispondenze più larghe: "Pomodori pelati" non si prende i "Pomodori".
  for (const strict of [true, false]) {
    recipe.missing.forEach((m, i) => {
      if (found.has(i)) return;
      const item = findInPantry(m.name, items, taken);
      if (!item) return;
      const isStrict = normalize(item.name) === normalize(m.name) || nameStems(item.name).join(' ') === nameStems(m.name).join(' ');
      if (strict && !isStrict) return;
      found.set(i, item);
      taken.add(item.id);
    });
  }
  if (!found.size && !changed) return null;
  const missing: Recipe['missing'] = [];
  recipe.missing.forEach((m, i) => {
    const item = found.get(i);
    if (item) uses.push({ itemId: item.id, name: item.name, emoji: item.emoji || '🛒', amount: m.amount });
    else missing.push(m);
  });
  return { ...recipe, uses, missing };
}

/** I pasti ancora da fare da ricollegare alla dispensa (ingredienti comprati o ricomprati), già aggiornati. */
export function mealsToRelink(meals: readonly Meal[], items: readonly Item[], today: string): Meal[] {
  const out: Meal[] = [];
  for (const m of meals) {
    if (m.done || m.date < today || !m.recipe) continue;
    const recipe = relinkRecipe(m.recipe, items);
    if (recipe) out.push({ ...m, recipe });
  }
  return out;
}

export interface ToBuy {
  name: string;
  amount: string;
  /** Per quale piatto serve. */
  for: string;
}

/** Ingredienti che mancano per i pasti ancora da fare dei giorni dati, tolti quelli già nella lista della spesa. */
export function shoppingForMeals(meals: readonly Meal[], days: readonly string[], items: readonly Item[], shopping: readonly ShoppingItem[], today: string): ToBuy[] {
  const inList = new Set(shopping.filter((s) => !s.done).map((s) => normalize(s.name)));
  const seen = new Set<string>();
  const out: ToBuy[] = [];
  const add = (name: string, amount: string, title: string) => {
    const k = normalize(name);
    if (!k || inList.has(k) || seen.has(k)) return;
    seen.add(k);
    out.push({ name, amount, for: title });
  };
  for (const m of [...meals].sort(compareMeals)) {
    if (m.done || !m.recipe || m.date < today || !days.includes(m.date)) continue;
    // Quelli comprati nel frattempo non mancano più.
    const recipe = relinkRecipe(m.recipe, items) ?? m.recipe;
    for (const x of recipe.missing) add(x.name, x.amount, m.title);
    for (const u of recipe.uses) if (u.itemId && !items.some((i) => i.id === u.itemId)) add(u.name, u.amount, m.title);
  }
  return out;
}

export interface WeekStats {
  /** Pasti in programma (pranzi e cene con almeno un piatto). */
  planned: number;
  /** Pranzi e cene della settimana: 14. */
  total: number;
  /** Prodotti in scadenza (entro 5 giorni) usati dai pasti da fare. */
  rescued: number;
}

export function weekStats(meals: readonly Meal[], days: readonly string[], items: readonly Item[], today: string): WeekStats {
  const byDay = mealsByDay(meals, days);
  let planned = 0;
  for (const d of byDay.values()) planned += (d.pranzo.length ? 1 : 0) + (d.cena.length ? 1 : 0);
  const rescued = new Set<string>();
  for (const m of meals) {
    if (m.done || !m.recipe || m.date < today || !days.includes(m.date)) continue;
    for (const u of m.recipe.uses) {
      const item = items.find((i) => i.id === u.itemId);
      const d = item ? daysLeft(item, today) : null;
      if (item && d !== null && d <= 5) rescued.add(item.id);
    }
  }
  return { planned, total: days.length * 2, rescued: rescued.size };
}

/** Testo da mandare in famiglia (WhatsApp…): i pasti della settimana giorno per giorno. */
export function weekShareText(meals: readonly Meal[], days: readonly string[]): string {
  const byDay = mealsByDay(meals, days);
  const lines = ['🍽️ Pasti della settimana'];
  for (const d of days) {
    const dm = byDay.get(d)!;
    if (!dm.pranzo.length && !dm.cena.length) continue;
    lines.push('', `📅 ${capitalize(formatWeekday(d))}`);
    for (const s of SLOTS) {
      const list = dm[s.id];
      if (list.length) lines.push(`${s.emoji} ${s.label}: ${list.map((m) => `${m.emoji} ${m.title}`).join(', ')}`);
    }
  }
  if (lines.length === 1) lines.push('', 'Ancora niente in programma.');
  return lines.join('\n');
}

// ---------- Widget ----------

/** Pasti dei prossimi giorni per il widget (il telefono sceglie da solo oggi e domani). */
export function widgetMeals(meals: readonly Meal[], today: string, days = 8): { date: string; slot: MealSlot; title: string; emoji: string; done: boolean }[] {
  const last = addDays(today, days - 1);
  return [...meals]
    .filter((m) => m.date >= today && m.date <= last)
    .sort(compareMeals)
    .slice(0, 40)
    .map((m) => ({ date: m.date, slot: m.slot, title: m.title, emoji: m.emoji, done: m.done }));
}

// ---------- Backup ----------

export function sanitizeMeal(v: unknown): Meal | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !isDateKey(o.date) || !isMealSlot(o.slot) || typeof o.title !== 'string' || !o.title.trim()) return null;
  return {
    id: o.id,
    date: o.date,
    slot: o.slot,
    title: o.title.slice(0, 80),
    emoji: typeof o.emoji === 'string' && o.emoji ? o.emoji : dishEmoji(o.title),
    recipe: o.recipe ? sanitizeRecipe(o.recipe) : null,
    note: typeof o.note === 'string' ? o.note.slice(0, 300) : '',
    done: o.done === true,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
  };
}
