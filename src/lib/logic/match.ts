// Collegare gli ingredienti di una ricetta ai prodotti della dispensa di adesso.
// Le ricette ricordano i prodotti per id: se un prodotto finisce e si ricompra (nuovo id),
// o se un ingrediente "da comprare" viene comprato, qui si ritrova per nome.
import type { Item } from '../types';
import type { Recipe } from './recipes';
import { normalize } from './text';

const STOP_WORDS = new Set(['del', 'dei', 'della', 'delle', 'dello', 'degli', 'alla', 'alle', 'allo', 'con', 'per', 'gli', 'una', 'uno', 'senza']);

/**
 * Parole che fanno un prodotto diverso: "Pomodori" non sono "Pomodori pelati",
 * "Pane" non è "Pane grattugiato", "Latte" non è "Latte di soia".
 */
const OTHER_PRODUCT = [
  'pelat',
  'passat',
  'concentrat',
  'polver',
  'condensat',
  'sciroppat',
  'scatol',
  'sottolio',
  'sottacet',
  'grattugiat',
  'secc',
  'soia',
  'mandorl',
  'avena',
  'cocc',
  'ris',
];

function words(name: string): string[] {
  return normalize(name)
    .split(' ')
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function stem(w: string): string {
  return w.length > 3 ? w.replace(/[aeiou]+$/, '') : w;
}

/** "Pomodori pelati" → ["pomodor", "pelat"]: parole senza la vocale finale (pomodoro/pomodori, carota/carote). */
export function nameStems(name: string): string[] {
  return words(name).map(stem);
}

function sameName(a: string, b: string): boolean {
  return normalize(a) === normalize(b) || nameStems(a).join(' ') === nameStems(b).join(' ');
}

/**
 * Il prodotto della dispensa che corrisponde a un ingrediente scritto ("Pomodori pelati", "Uova"):
 * stesso nome, oppure stesse parole al singolare/plurale, oppure lo stesso prodotto con qualche parola in più
 * ("Latte" → "Latte parzialmente scremato": la prima parola deve essere la stessa), ma non un prodotto diverso.
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
      const stems = nameStems(i.name);
      if (stems[0] !== target[0] || !target.every((t) => stems.includes(t))) return false;
      const extra = words(i.name).filter((w) => !target.includes(stem(w)));
      return !extra.some((w) => OTHER_PRODUCT.some((o) => w.startsWith(o)));
    })
    .sort((a, b) => a.name.length - b.name.length);
  return containing[0] ?? null;
}

/**
 * Collega la ricetta alla dispensa di adesso:
 * - un prodotto usato che non c'è più (finito) si ricollega a uno uguale ancora in dispensa o ricomprato;
 * - gli ingredienti "da comprare" che ora ci sono (comprati, o aggiunti dopo) diventano prodotti usati:
 *   non risultano più mancanti e in Dispensa sono "In programma".
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
      if (!item || (strict && !sameName(item.name, m.name))) return;
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

/** La ricetta collegata alla dispensa di adesso (la stessa se non cambia niente). */
export function liveRecipe(recipe: Recipe, items: readonly Item[]): Recipe {
  return relinkRecipe(recipe, items) ?? recipe;
}
