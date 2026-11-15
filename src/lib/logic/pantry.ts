// Elenco della dispensa: filtri, ordine, gruppi per urgenza, riassunti e statistiche anti-spreco.
import type { HistoryEntry, Item, Location } from '../types';
import { formatMonth, monthOf, previousMonth } from './dates';
import { compareByExpiry, daysLeft, isUrgent, urgencyOf, type Urgency } from './expiry';
import { matchesQuery } from './text';

export type LocationFilter = Location | 'tutto';
export type SortMode = 'scadenza' | 'nome' | 'recenti';

export const LOCATIONS: { id: Location; label: string }[] = [
  { id: 'frigo', label: 'Frigo' },
  { id: 'freezer', label: 'Freezer' },
  { id: 'dispensa', label: 'Dispensa' },
];

export function locationLabel(l: Location): string {
  return LOCATIONS.find((x) => x.id === l)?.label ?? l;
}

export function isLocation(v: unknown): v is Location {
  return v === 'frigo' || v === 'freezer' || v === 'dispensa';
}

export function filterItems(items: readonly Item[], location: LocationFilter, query: string): Item[] {
  return items.filter(
    (i) => (location === 'tutto' || i.location === location) && matchesQuery(`${i.name} ${i.brand ?? ''} ${i.note ?? ''}`, query),
  );
}

export function sortItems(items: readonly Item[], mode: SortMode): Item[] {
  const list = [...items];
  if (mode === 'nome') return list.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  if (mode === 'recenti') return list.sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
  return list.sort(compareByExpiry);
}

export interface Section {
  id: Urgency;
  title: string;
  items: Item[];
}

const SECTION_TITLES: Record<Urgency, string> = {
  scaduto: 'Oltre la data',
  rosso: 'Oggi e domani',
  arancione: 'Entro 5 giorni',
  verde: 'Più avanti',
  nessuna: 'Senza scadenza',
};

const SECTION_ORDER: Urgency[] = ['scaduto', 'rosso', 'arancione', 'verde', 'nessuna'];

/** Divide l'elenco (già ordinato per scadenza) in gruppi per colore. */
export function groupByUrgency(items: readonly Item[], today: string): Section[] {
  const map = new Map<Urgency, Item[]>();
  for (const i of items) {
    const u = urgencyOf(daysLeft(i, today));
    const arr = map.get(u) ?? [];
    arr.push(i);
    map.set(u, arr);
  }
  return SECTION_ORDER.filter((u) => map.has(u)).map((u) => ({ id: u, title: SECTION_TITLES[u], items: map.get(u)! }));
}

export function countByLocation(items: readonly Item[]): Record<LocationFilter, number> {
  const out: Record<LocationFilter, number> = { tutto: items.length, frigo: 0, freezer: 0, dispensa: 0 };
  for (const i of items) out[i.location]++;
  return out;
}

export interface PantrySummary {
  total: number;
  /** Scaduti. */
  expired: number;
  /** Oggi o domani. */
  urgent: number;
  /** Tra 2 e 5 giorni. */
  soon: number;
}

export function summarize(items: readonly Item[], today: string): PantrySummary {
  const out: PantrySummary = { total: items.length, expired: 0, urgent: 0, soon: 0 };
  for (const i of items) {
    const u = urgencyOf(daysLeft(i, today));
    if (u === 'scaduto') out.expired++;
    else if (u === 'rosso') out.urgent++;
    else if (u === 'arancione') out.soon++;
  }
  return out;
}

/** I prodotti da usare per primi (scaduti da poco, oggi, domani, poi entro 5 giorni). */
export function itemsToUseFirst(items: readonly Item[], today: string, max = 6): Item[] {
  return sortItems(
    items.filter((i) => {
      const d = daysLeft(i, today);
      if (d === null || d > 5) return false;
      // Oltre la data si propone solo un "preferibilmente entro" (TMC): un "da consumarsi entro" passato non si cucina.
      return d >= 0 || i.expiryKind === 'tmc';
    }),
    'scadenza',
  ).slice(0, max);
}

/** Vero se c'è almeno un prodotto rosso (oggi o domani). */
export function hasUrgent(items: readonly Item[], today: string): boolean {
  return items.some((i) => {
    const d = daysLeft(i, today);
    return isUrgent(d) && d !== null && d >= 0;
  });
}

// ---------- Statistiche anti-spreco ----------

export interface MonthStats {
  month: string;
  label: string;
  consumed: number;
  wasted: number;
  /** Percentuale di prodotti consumati (null se non ci sono dati). */
  savedPct: number | null;
}

export function monthStats(history: readonly HistoryEntry[], month: string): MonthStats {
  let consumed = 0;
  let wasted = 0;
  for (const h of history) {
    if (monthOf(h.date) !== month) continue;
    if (h.outcome === 'consumato') consumed++;
    else wasted++;
  }
  const total = consumed + wasted;
  return { month, label: formatMonth(month), consumed, wasted, savedPct: total ? Math.round((consumed / total) * 100) : null };
}

/** Gli ultimi `n` mesi, dal più recente. */
export function recentMonths(history: readonly HistoryEntry[], today: string, n = 6): MonthStats[] {
  const out: MonthStats[] = [];
  let m = monthOf(today);
  for (let i = 0; i < n; i++) {
    out.push(monthStats(history, m));
    m = previousMonth(m);
  }
  return out;
}

/** I prodotti buttati più spesso (per capire cosa comprare in quantità minore). */
export function mostWasted(history: readonly HistoryEntry[], max = 3): { name: string; emoji: string; count: number }[] {
  const map = new Map<string, { name: string; emoji: string; count: number }>();
  for (const h of history) {
    if (h.outcome !== 'buttato') continue;
    const key = h.name.trim().toLowerCase();
    const cur = map.get(key) ?? { name: h.name, emoji: h.emoji, count: 0 };
    cur.count++;
    map.set(key, cur);
  }
  return [...map.values()].filter((x) => x.count >= 2).sort((a, b) => b.count - a.count).slice(0, max);
}
