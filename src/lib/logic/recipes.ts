// Ricette con l'IA a partire da ciò che sta per scadere: testo da mandare, forma della risposta, lettura.
import type { Item } from '../types';
import { formatShort, formatWeekday } from './dates';
import { daysLeft, effectiveExpiry, urgencyOf, type Urgency } from './expiry';
import { formatQuantity } from './foods';
import { extractJson } from './gemini';
import { sortItems } from './pantry';
import { newId } from './text';

export interface RecipeFilters {
  /** ⏱️ meno di 20 minuti */
  quick: boolean;
  /** 🥗 leggero */
  light: boolean;
  /** 🍝 voglia di pasta */
  pasta: boolean;
  /** 🚫 senza lattosio */
  lactoseFree: boolean;
  /** 🌱 vegetariano */
  vegetarian: boolean;
  /** 🏠 solo con quello che ho */
  onlyPantry: boolean;
  servings: number;
  /** Richiesta libera ("per la cena", "senza forno"). */
  extra: string;
}

export const DEFAULT_FILTERS: RecipeFilters = {
  quick: false,
  light: false,
  pasta: false,
  lactoseFree: false,
  vegetarian: false,
  onlyPantry: false,
  servings: 2,
  extra: '',
};

export type Difficulty = 'facile' | 'media' | 'impegnativa';

/** Prodotto della dispensa usato da una ricetta. */
export interface RecipeUse {
  itemId: string | null;
  name: string;
  emoji: string;
  amount: string;
}

export interface MissingIngredient {
  name: string;
  amount: string;
}

export interface Recipe {
  id: string;
  title: string;
  emoji: string;
  minutes: number;
  difficulty: Difficulty;
  servings: number;
  uses: RecipeUse[];
  missing: MissingIngredient[];
  steps: string[];
  why: string;
  tip: string;
  createdAt: string;
}

/** Riferimento breve ("p1") a un prodotto mandato all'IA. */
export interface PantryRef {
  ref: string;
  itemId: string;
  name: string;
  emoji: string;
}

/** Al massimo tanti prodotti nell'elenco per l'IA (i più urgenti per primi). */
export const MAX_PANTRY_LINES = 45;

export const DEFAULT_STAPLES = ['sale', 'pepe', 'olio extravergine d’oliva', 'acqua'];

function expiryNote(item: Item, today: string): string | null {
  const d = daysLeft(item, today);
  if (d === null) return 'nessuna scadenza';
  if (d < 0) return item.expiryKind === 'tmc' ? `termine minimo passato da ${-d} giorni (di solito ancora buono)` : null;
  if (d === 0) return 'SCADE OGGI';
  if (d === 1) return 'SCADE DOMANI';
  if (d <= 5) return `scade tra ${d} giorni`;
  const e = effectiveExpiry(item);
  return e ? `scade il ${formatShort(e, today)}` : 'nessuna scadenza';
}

/** Prodotti da mandare all'IA: i più urgenti per primi; quelli "da consumarsi entro" già passati no. */
export function pantryRefs(items: readonly Item[], today: string): { refs: PantryRef[]; lines: string[] } {
  const refs: PantryRef[] = [];
  const lines: string[] = [];
  for (const item of sortItems(items, 'scadenza')) {
    if (refs.length >= MAX_PANTRY_LINES) break;
    const note = expiryNote(item, today);
    if (note === null) continue;
    const ref = `p${refs.length + 1}`;
    refs.push({ ref, itemId: item.id, name: item.name, emoji: item.emoji });
    const where = item.location === 'freezer' ? 'freezer (surgelato)' : item.location;
    const opened = item.openedAt ? ', già aperto' : '';
    lines.push(`${ref} | ${item.name}${item.brand ? ` (${item.brand})` : ''} | ${formatQuantity(item.quantity, item.unit)}${item.size ? ` da ${item.size}` : ''} | ${where}${opened} | ${note}`);
  }
  return { refs, lines };
}

export function filterLines(f: RecipeFilters, glutenFree: boolean): string[] {
  const out: string[] = [];
  if (f.quick) out.push('Tempo totale massimo 20 minuti per ogni ricetta.');
  if (f.light) out.push('Piatti leggeri: pochi grassi, niente fritti, porzioni equilibrate.');
  if (f.pasta) out.push('Tutte le ricette devono essere primi piatti di pasta (va bene anche pasta fresca o gnocchi).');
  if (f.lactoseFree) out.push('Senza lattosio: niente latte, panna, burro, yogurt, formaggi freschi o morbidi (vanno bene i prodotti "senza lattosio").');
  if (f.vegetarian) out.push('Ricette vegetariane: niente carne né pesce (neanche brodo di carne o acciughe).');
  if (glutenFree) out.push('Senza glutine: niente pasta, pane o farine di frumento, orzo, farro, segale (vanno bene riso, mais, patate e prodotti "senza glutine").');
  if (f.onlyPantry) out.push('Usa SOLO i prodotti dell’elenco e quelli sempre in casa: "missing" deve essere vuoto.');
  return out;
}

/** Istruzioni per il modello. */
export function buildRecipePrompt(
  items: readonly Item[],
  today: string,
  filters: RecipeFilters,
  options: { staples: readonly string[]; glutenFree: boolean; avoid?: readonly string[] },
): { prompt: string; refs: PantryRef[] } {
  const { refs, lines } = pantryRefs(items, today);
  const staples = options.staples.map((s) => s.trim()).filter(Boolean);
  const extra = filters.extra.trim().slice(0, 300);
  const avoid = (options.avoid ?? []).filter(Boolean).slice(0, 9);
  const servings = Math.min(12, Math.max(1, Math.round(filters.servings)));
  const prompt = [
    `Sei uno chef italiano di cucina casalinga e anti-spreco. Oggi è ${formatWeekday(today)}.`,
    'Ecco cosa c’è in casa (codice | prodotto | quantità | dove | scadenza):',
    ...lines,
    staples.length ? `In casa ci sono sempre anche: ${staples.join(', ')} (non metterli tra gli ingredienti mancanti).` : '',
    `Proponi 3 ricette diverse tra loro (per esempio un primo, un secondo o piatto unico, e un’idea veloce) per ${servings} ${servings === 1 ? 'persona' : 'persone'}.`,
    'Usa SOPRATTUTTO i prodotti che scadono prima ("SCADE OGGI", "SCADE DOMANI", "scade tra pochi giorni"): ogni ricetta deve usarne almeno uno, se ce ne sono. Più prodotti in scadenza usa, meglio è.',
    ...filterLines(filters, options.glutenFree),
    avoid.length ? `Non riproporre queste ricette (già viste): ${avoid.join('; ')}.` : '',
    extra ? `Richiesta dell’utente: """${extra}"""` : '',
    'Regole:',
    '- "uses": i prodotti dell’elenco usati, con il codice esatto (es. "p1") e la quantità da usare (es. "200 ml", "2", "metà"). Usa solo codici dell’elenco.',
    '- "missing": ingredienti che servono ma non sono in casa, con la quantità; il meno possibile.',
    '- "steps": il procedimento in 3–8 passaggi brevi e chiari, con tempi e temperature.',
    '- "minutes": tempo totale realistico. "difficulty": "facile", "media" o "impegnativa".',
    '- "why": una frase su cosa salva dallo spreco (es. "Usa il latte e le zucchine che scadono domani").',
    '- "tip": un consiglio breve (varianti o come conservare gli avanzi).',
    '- Nomi e testi in italiano. Ricette vere e buone, non combinazioni strane solo per usare tutto.',
    'Rispondi SOLO con JSON valido, senza testo prima o dopo, con questa forma:',
    '{"recipes":[{"title":"...","emoji":"🍝","minutes":20,"difficulty":"facile","servings":2,"uses":[{"ref":"p1","amount":"200 ml"}],"missing":[{"name":"...","amount":"..."}],"steps":["..."],"why":"...","tip":"..."}]}',
  ]
    .filter(Boolean)
    .join('\n');
  return { prompt, refs };
}

const STR = { type: 'string' } as const;

export const RECIPES_SCHEMA = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          title: STR,
          emoji: STR,
          minutes: { type: 'number' },
          difficulty: { type: 'string', enum: ['facile', 'media', 'impegnativa'] },
          servings: { type: 'number' },
          uses: {
            type: 'array',
            items: { type: 'object', properties: { ref: STR, amount: STR }, required: ['ref', 'amount'] },
          },
          missing: {
            type: 'array',
            items: { type: 'object', properties: { name: STR, amount: STR }, required: ['name', 'amount'] },
          },
          steps: { type: 'array', items: STR, minItems: 1, maxItems: 12 },
          why: STR,
          tip: STR,
        },
        required: ['title', 'emoji', 'minutes', 'difficulty', 'servings', 'uses', 'missing', 'steps', 'why', 'tip'],
      },
    },
  },
  required: ['recipes'],
} as const;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function firstPictograph(v: unknown): string {
  const t = str(v, 16);
  const m = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u.exec(t);
  return m ? m[0] : '';
}

function parseRecipe(raw: unknown, refs: readonly PantryRef[], servings: number, nowIso: string): Recipe | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const title = str(o.title, 80);
  const steps = Array.isArray(o.steps) ? o.steps.map((s) => str(s, 400).replace(/^\d+[.)]\s*/, '')).filter(Boolean).slice(0, 12) : [];
  if (!title || !steps.length) return null;
  const seen = new Set<string>();
  const uses: RecipeUse[] = [];
  for (const u of Array.isArray(o.uses) ? o.uses : []) {
    if (typeof u !== 'object' || u === null) continue;
    const ref = str((u as Record<string, unknown>).ref, 8).toLowerCase();
    const found = refs.find((r) => r.ref === ref);
    if (!found || seen.has(found.itemId)) continue;
    seen.add(found.itemId);
    uses.push({ itemId: found.itemId, name: found.name, emoji: found.emoji, amount: str((u as Record<string, unknown>).amount, 40) });
  }
  const missing: MissingIngredient[] = [];
  for (const m of Array.isArray(o.missing) ? o.missing : []) {
    if (typeof m !== 'object' || m === null) continue;
    const name = str((m as Record<string, unknown>).name, 60);
    if (name) missing.push({ name, amount: str((m as Record<string, unknown>).amount, 40) });
  }
  const minutes = num(o.minutes);
  const serv = num(o.servings);
  const diff = o.difficulty === 'media' || o.difficulty === 'impegnativa' ? o.difficulty : 'facile';
  return {
    id: newId(),
    title,
    emoji: firstPictograph(o.emoji) || '🍽️',
    minutes: minutes !== null && minutes > 0 && minutes <= 600 ? Math.round(minutes) : 30,
    difficulty: diff,
    servings: serv !== null && serv >= 1 && serv <= 20 ? Math.round(serv) : servings,
    uses,
    missing: missing.slice(0, 12),
    steps,
    why: str(o.why, 200),
    tip: str(o.tip, 300),
    createdAt: nowIso,
  };
}

/** Risposta del modello → ricette (null se la risposta non si capisce). */
export function parseRecipes(text: string, refs: readonly PantryRef[], servings: number, nowIso: string): Recipe[] | null {
  const json = extractJson(text);
  if (typeof json !== 'object' || json === null) return null;
  const list = (json as Record<string, unknown>).recipes;
  if (!Array.isArray(list)) return null;
  return list.map((r) => parseRecipe(r, refs, servings, nowIso)).filter((r): r is Recipe => r !== null).slice(0, 4);
}

/** Legge una ricetta salvata (backup o memoria), scartando quelle rovinate. */
export function sanitizeRecipe(v: unknown): Recipe | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.title !== 'string' || !Array.isArray(o.steps) || !Array.isArray(o.uses) || !Array.isArray(o.missing)) return null;
  const uses = (o.uses as unknown[])
    .filter((u): u is RecipeUse => typeof u === 'object' && u !== null && typeof (u as RecipeUse).name === 'string')
    .map((u) => ({ itemId: typeof u.itemId === 'string' ? u.itemId : null, name: u.name, emoji: typeof u.emoji === 'string' ? u.emoji : '🛒', amount: typeof u.amount === 'string' ? u.amount : '' }));
  const missing = (o.missing as unknown[])
    .filter((m): m is MissingIngredient => typeof m === 'object' && m !== null && typeof (m as MissingIngredient).name === 'string')
    .map((m) => ({ name: m.name, amount: typeof m.amount === 'string' ? m.amount : '' }));
  return {
    id: o.id,
    title: o.title,
    emoji: typeof o.emoji === 'string' ? o.emoji : '🍽️',
    minutes: typeof o.minutes === 'number' ? o.minutes : 30,
    difficulty: o.difficulty === 'media' || o.difficulty === 'impegnativa' ? o.difficulty : 'facile',
    servings: typeof o.servings === 'number' ? o.servings : 2,
    uses,
    missing,
    steps: (o.steps as unknown[]).filter((s): s is string => typeof s === 'string'),
    why: typeof o.why === 'string' ? o.why : '',
    tip: typeof o.tip === 'string' ? o.tip : '',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date(0).toISOString(),
  };
}

export interface UseStatus extends RecipeUse {
  /** Il prodotto è ancora in dispensa. */
  present: boolean;
  urgency: Urgency;
}

/** Stato attuale dei prodotti usati (il prodotto può essere stato consumato nel frattempo). */
export function useStatuses(recipe: Recipe, items: readonly Item[], today: string): UseStatus[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return recipe.uses.map((u) => {
    const item = u.itemId ? byId.get(u.itemId) : undefined;
    return { ...u, present: !!item, urgency: item ? urgencyOf(daysLeft(item, today)) : 'nessuna' };
  });
}

/** Quanti prodotti in scadenza (rossi, arancioni o oltre la data) salva la ricetta. */
export function savedCount(statuses: readonly UseStatus[]): number {
  return statuses.filter((s) => s.present && (s.urgency === 'rosso' || s.urgency === 'arancione' || s.urgency === 'scaduto')).length;
}

/** Ricette in ordine: prima quelle che salvano più prodotti in scadenza. */
export function sortRecipes(recipes: readonly Recipe[], items: readonly Item[], today: string): Recipe[] {
  const score = (r: Recipe) => {
    const st = useStatuses(r, items, today);
    return savedCount(st) * 10 + st.filter((s) => s.urgency === 'rosso').length * 5 + st.filter((s) => s.present).length;
  };
  return [...recipes].map((r) => ({ r, s: score(r) })).sort((a, b) => b.s - a.s).map((x) => x.r);
}

/** Testo da condividere (WhatsApp, note…). */
export function recipeShareText(r: Recipe): string {
  return [
    `${r.emoji} ${r.title}`,
    `⏱️ ${r.minutes} min · ${r.difficulty} · ${r.servings} ${r.servings === 1 ? 'persona' : 'persone'}`,
    '',
    'Ingredienti:',
    ...r.uses.map((u) => `• ${u.name}${u.amount ? ` – ${u.amount}` : ''}`),
    ...r.missing.map((m) => `• ${m.name}${m.amount ? ` – ${m.amount}` : ''}`),
    '',
    'Procedimento:',
    ...r.steps.map((s, i) => `${i + 1}. ${s}`),
    r.tip ? `\nConsiglio: ${r.tip}` : '',
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .trim();
}

/** Messaggio durante l'attesa. */
export function recipeWaitingMessage(seconds: number): string {
  if (seconds < 4) return 'Guardo cosa c’è in dispensa…';
  if (seconds < 12) return 'Scelgo gli ingredienti in scadenza…';
  if (seconds < 25) return 'Scrivo le ricette…';
  return 'Quasi pronto, ancora un momento…';
}
