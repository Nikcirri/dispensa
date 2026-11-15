// Bozza di un prodotto prima del salvataggio: arriva dalla foto (IA), dal codice a barre, da un prodotto
// ricordato o dal nome scritto a mano. La schermata di conferma la mostra e l'utente la corregge.
import type { ExpiryKind, Item, ItemSource, Location, Template, Unit } from '../types';
import { addDays, daysBetween, isDateKey } from './dates';
import { guessFood } from './foods';
import { capitalize, newId, normalize } from './text';

export interface ProductDraft {
  name: string;
  brand?: string;
  size?: string;
  emoji: string;
  location: Location;
  quantity: number;
  unit: Unit;
  expiry: string | null;
  expiryKind: ExpiryKind;
  expiryEstimated: boolean;
  openDays: number | null;
  /** Già aperto (solo modificando un prodotto). */
  openedAt?: string | null;
  barcode?: string;
  imageUrl?: string;
  thumb?: string;
  source: ItemSource;
  /** La data come è scritta sulla confezione (letta dall'IA). */
  expiryText?: string;
  note?: string;
}

/** Bozza dal solo nome: icona, posto e durata indovinati. */
export function draftFromName(name: string, today: string, source: ItemSource = 'mano'): ProductDraft {
  const g = guessFood(name);
  return {
    name: capitalize(name),
    emoji: g.emoji,
    location: g.location,
    quantity: 1,
    unit: 'pz',
    expiry: g.shelfDays ? addDays(today, g.shelfDays) : null,
    expiryKind: g.kind,
    expiryEstimated: g.shelfDays !== null,
    openDays: g.openDays,
    source,
  };
}

/** Bozza da un prodotto ricordato: la scadenza si stima con la durata che aveva l'ultima volta. */
export function draftFromTemplate(t: Template, today: string): ProductDraft {
  return {
    name: t.name,
    brand: t.brand,
    size: t.size,
    emoji: t.emoji,
    location: t.location,
    quantity: t.quantity > 0 ? t.quantity : 1,
    unit: t.unit,
    expiry: t.shelfDays ? addDays(today, t.shelfDays) : null,
    expiryKind: t.expiryKind,
    expiryEstimated: t.shelfDays !== null,
    openDays: t.openDays,
    barcode: t.barcode,
    imageUrl: t.imageUrl,
    thumb: t.thumb,
    source: 'ricordato',
  };
}

/** Bozza per modificare un prodotto già in dispensa. */
export function draftFromItem(i: Item): ProductDraft {
  return {
    name: i.name,
    brand: i.brand,
    size: i.size,
    emoji: i.emoji,
    location: i.location,
    quantity: i.quantity,
    unit: i.unit,
    expiry: i.expiry,
    expiryKind: i.expiryKind,
    expiryEstimated: i.expiryEstimated,
    openDays: i.openDays,
    openedAt: i.openedAt,
    barcode: i.barcode,
    imageUrl: i.imageUrl,
    thumb: i.thumb,
    source: i.source,
    note: i.note,
  };
}

const clean = (s: string | undefined, max: number) => {
  const t = (s ?? '').trim().slice(0, max);
  return t || undefined;
};

/** Prodotto nuovo dalla bozza confermata. */
export function itemFromDraft(d: ProductDraft, nowIso: string): Item {
  return {
    id: newId(),
    name: capitalize(d.name).slice(0, 80) || 'Prodotto',
    brand: clean(d.brand, 40),
    size: clean(d.size, 30),
    emoji: d.emoji || '🛒',
    location: d.location,
    quantity: d.quantity > 0 ? d.quantity : 1,
    unit: d.unit,
    expiry: d.expiry && isDateKey(d.expiry) ? d.expiry : null,
    expiryKind: d.expiryKind,
    expiryEstimated: !!d.expiry && d.expiryEstimated,
    openedAt: d.openedAt ?? null,
    openDays: d.openDays && d.openDays > 0 ? Math.round(d.openDays) : null,
    barcode: clean(d.barcode, 20),
    imageUrl: clean(d.imageUrl, 400),
    thumb: d.thumb,
    source: d.source,
    addedAt: nowIso,
    updatedAt: nowIso,
    note: clean(d.note, 200),
  };
}

/** Applica a un prodotto esistente le modifiche fatte nella schermata. */
export function applyDraft(item: Item, d: ProductDraft, nowIso: string): Item {
  const fresh = itemFromDraft(d, nowIso);
  return { ...fresh, id: item.id, addedAt: item.addedAt, source: item.source, thumb: d.thumb ?? item.thumb };
}

/** Chiave del prodotto ricordato: il codice a barre se c'è, altrimenti il nome. */
export function templateKey(p: { barcode?: string; name: string }): string {
  return p.barcode ? `b:${p.barcode}` : `n:${normalize(p.name)}`;
}

/** Prodotto ricordato aggiornato con l'ultimo salvataggio (la durata si calcola dal giorno in cui è entrato). */
export function templateFromItem(item: Item, previous: Template | undefined, today: string): Template {
  const added = item.addedAt.slice(0, 10);
  const shelf = item.expiry && added === today ? daysBetween(today, item.expiry) : null;
  return {
    key: templateKey(item),
    name: item.name,
    brand: item.brand,
    size: item.size,
    emoji: item.emoji,
    location: item.location,
    quantity: item.quantity,
    unit: item.unit,
    expiryKind: item.expiryKind,
    shelfDays: shelf !== null && shelf > 0 ? shelf : (previous?.shelfDays ?? null),
    openDays: item.openDays,
    barcode: item.barcode,
    imageUrl: item.imageUrl,
    thumb: item.thumb ?? previous?.thumb,
    uses: (previous?.uses ?? 0) + 1,
    lastUsed: new Date().toISOString(),
  };
}
