// Lista della spesa: aggiunte senza doppioni, ordine, testo da condividere.
import type { ShoppingItem } from '../types';
import { guessFood } from './foods';
import { capitalize, newId, normalize } from './text';

/** Ordine per stare in cima alla lista. */
export function topOrder(list: readonly ShoppingItem[]): number {
  return list.length ? Math.min(...list.map((x) => x.order)) - 1 : 0;
}

/**
 * Aggiunge un prodotto in cima alla lista. Se c'è già (anche spuntato) non si duplica: torna da comprare
 * e sale in cima; la nota nuova sostituisce quella vecchia se non è vuota.
 * Restituisce la riga da salvare e se era già presente.
 */
export function addToList(list: readonly ShoppingItem[], name: string, note = '', nowIso = new Date().toISOString()): { item: ShoppingItem; existed: boolean } {
  const clean = capitalize(name).slice(0, 60);
  const key = normalize(clean);
  const existing = list.find((x) => normalize(x.name) === key);
  const order = topOrder(list);
  if (existing) {
    return { item: { ...existing, done: false, order, note: note.trim() || existing.note }, existed: true };
  }
  return {
    item: { id: newId(), name: clean, emoji: guessFood(clean).emoji, note: note.trim().slice(0, 40), done: false, addedAt: nowIso, order },
    existed: false,
  };
}

/** Prima da comprare (nell'ordine scelto), poi quelli già nel carrello. */
export function sortShopping(list: readonly ShoppingItem[]): ShoppingItem[] {
  return [...list].sort((a, b) => Number(a.done) - Number(b.done) || a.order - b.order || a.name.localeCompare(b.name, 'it'));
}

/** Testo per WhatsApp, note, email. */
export function shoppingShareText(list: readonly ShoppingItem[]): string {
  const todo = sortShopping(list).filter((x) => !x.done);
  return ['🛒 Lista della spesa', ...todo.map((x) => `• ${x.name}${x.note ? ` (${x.note})` : ''}`)].join('\n');
}

/** Più nomi scritti insieme ("latte, pane e uova") → nomi separati. */
export function splitNames(text: string): string[] {
  return text
    .split(/[,;\n]|\s+e\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 30);
}
