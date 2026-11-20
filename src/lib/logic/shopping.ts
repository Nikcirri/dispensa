// Lista della spesa: aggiunte senza doppioni, ordine, testo da condividere.
import type { ShoppingDetail, ShoppingItem } from '../types';
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

export const MAX_DETAILS = 20;
export const MAX_DETAIL_QTY = 99;

/** Specifiche pulite: testo non vuoto (max 80 caratteri), quantità intera da 1 a 99, al massimo 20. */
export function cleanDetails(v: unknown): ShoppingDetail[] {
  if (!Array.isArray(v)) return [];
  const out: ShoppingDetail[] = [];
  for (const d of v as unknown[]) {
    if (!d || typeof d !== 'object') continue;
    const o = d as { text?: unknown; qty?: unknown };
    const text = typeof o.text === 'string' ? o.text.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    if (!text) continue;
    const q = typeof o.qty === 'number' && Number.isFinite(o.qty) ? Math.round(o.qty) : 1;
    out.push({ text, qty: Math.min(MAX_DETAIL_QTY, Math.max(1, q)) });
    if (out.length >= MAX_DETAILS) break;
  }
  return out;
}

/** "2 × penne rigate" (con 1 solo il testo). */
export function detailText(d: ShoppingDetail): string {
  return d.qty > 1 ? `${d.qty} × ${d.text}` : d.text;
}

/** Testo per WhatsApp, note, email. */
export function shoppingShareText(list: readonly ShoppingItem[]): string {
  const todo = sortShopping(list).filter((x) => !x.done);
  return [
    '🛒 Lista della spesa',
    ...todo.flatMap((x) => [`• ${x.name}${x.note ? ` (${x.note})` : ''}`, ...(x.details ?? []).map((d) => `   – ${detailText(d)}`)]),
  ].join('\n');
}

/**
 * Cosa mettere in dispensa per un prodotto comprato: con le specifiche, un prodotto per ognuna
 * ("Pasta" con 2 × "penne rigate" → 2 di "Pasta penne rigate"); senza, il prodotto così com'è.
 */
export function pantryNamesFor(s: Pick<ShoppingItem, 'name' | 'details'>): { name: string; qty: number }[] {
  const details = cleanDetails(s.details);
  if (!details.length) return [{ name: s.name, qty: 1 }];
  const base = normalize(s.name);
  return details.map((d) => {
    const text = d.text;
    // Se la specifica contiene già il nome ("pasta integrale") non si ripete.
    const name = base && normalize(text).includes(base) ? capitalize(text) : `${s.name} ${text}`;
    return { name: name.slice(0, 80), qty: d.qty };
  });
}

/** Più nomi scritti insieme ("latte, pane e uova") → nomi separati. */
export function splitNames(text: string): string[] {
  return text
    .split(/[,;\n]|\s+e\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 30);
}
