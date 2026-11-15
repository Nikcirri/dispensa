// Scadenze: quanti giorni mancano, colore del bollino, testi.
import type { ExpiryKind, Item } from '../types';
import { addDays, daysBetween, formatShort } from './dates';

/**
 * Colore del bollino:
 * - `scaduto`: la data è passata;
 * - `rosso`: scade oggi o domani;
 * - `arancione`: scade tra 2 e 5 giorni;
 * - `verde`: più avanti;
 * - `nessuna`: senza data.
 */
export type Urgency = 'scaduto' | 'rosso' | 'arancione' | 'verde' | 'nessuna';

/** Fino a quanti giorni il bollino è arancione. */
export const ORANGE_MAX_DAYS = 5;

type ExpiryFields = Pick<Item, 'expiry' | 'openedAt' | 'openDays'>;

/** Data da usare davvero: se il prodotto è aperto vale la più vicina tra la confezione e "aperto + giorni". */
export function effectiveExpiry(item: ExpiryFields): string | null {
  const opened = item.openedAt && item.openDays && item.openDays > 0 ? addDays(item.openedAt, item.openDays) : null;
  if (opened && item.expiry) return opened < item.expiry ? opened : item.expiry;
  return opened ?? item.expiry;
}

/** Vero se la data che conta è quella dell'apertura (non quella della confezione). */
export function limitedByOpening(item: ExpiryFields): boolean {
  if (!item.openedAt || !item.openDays) return false;
  const opened = addDays(item.openedAt, item.openDays);
  return !item.expiry || opened < item.expiry;
}

/** Giorni che mancano alla data che conta (negativo = già passata, null = senza data). */
export function daysLeft(item: ExpiryFields, today: string): number | null {
  const e = effectiveExpiry(item);
  return e ? daysBetween(today, e) : null;
}

export function urgencyOf(days: number | null): Urgency {
  if (days === null) return 'nessuna';
  if (days < 0) return 'scaduto';
  if (days <= 1) return 'rosso';
  if (days <= ORANGE_MAX_DAYS) return 'arancione';
  return 'verde';
}

/** Rosso o già scaduto: da usare subito. */
export function isUrgent(days: number | null): boolean {
  return days !== null && days <= 1;
}

/** Testo corto del bollino: "Oggi", "Domani", "3 giorni", "2 sett.", "5 mesi", "Scaduto". */
export function badgeText(days: number | null, kind: ExpiryKind): string {
  if (days === null) return 'Senza data';
  if (days < 0) return kind === 'tmc' ? 'TMC passato' : 'Scaduto';
  if (days === 0) return 'Oggi';
  if (days === 1) return 'Domani';
  if (days < 14) return `${days} giorni`;
  if (days < 60) return `${Math.round(days / 7)} sett.`;
  if (days < 730) return `${Math.round(days / 30.4)} mesi`;
  return `${Math.round(days / 365)} anni`;
}

/** Frase completa: "Scade domani", "Scaduto da 3 giorni", "Scade tra 2 settimane (12 mar)". */
export function expiryText(days: number | null, kind: ExpiryKind, date: string | null, today: string): string {
  if (days === null || !date) return 'Nessuna scadenza';
  const when = formatShort(date, today);
  if (days < 0) {
    const ago = -days === 1 ? 'ieri' : `da ${-days} giorni`;
    return kind === 'tmc' ? `Termine minimo passato ${ago === 'ieri' ? 'ieri' : ago}` : `Scaduto ${ago}`;
  }
  if (days === 0) return 'Scade oggi';
  if (days === 1) return 'Scade domani';
  if (days < 14) return `Scade tra ${days} giorni (${when})`;
  return `Scade il ${when}`;
}

/** Consiglio per un prodotto oltre la data. */
export function pastDateAdvice(kind: ExpiryKind): string {
  return kind === 'tmc'
    ? 'È un “preferibilmente entro”: spesso è ancora buono. Guarda, annusa e assaggia prima di buttarlo.'
    : 'È un “da consumarsi entro”: per sicurezza è meglio non mangiarlo.';
}

/** "Aperto oggi", "Aperto ieri", "Aperto da 3 giorni". */
export function openedText(openedAt: string | null, today: string): string {
  if (!openedAt) return '';
  const d = daysBetween(openedAt, today);
  if (d <= 0) return 'Aperto oggi';
  if (d === 1) return 'Aperto ieri';
  return `Aperto da ${d} giorni`;
}

/** Ordine per urgenza: prima chi scade prima, i prodotti senza data in fondo, poi per nome. */
export function compareByExpiry(a: Item, b: Item): number {
  const ea = effectiveExpiry(a);
  const eb = effectiveExpiry(b);
  if (ea !== eb) {
    if (ea === null) return 1;
    if (eb === null) return -1;
    return ea < eb ? -1 : 1;
  }
  return a.name.localeCompare(b.name, 'it');
}
