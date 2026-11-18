// Ricette con l'IA a partire da ciò che sta per scadere: testo da mandare, forma della risposta, lettura.
import type { Item } from '../types';
import { formatShort, formatWeekday } from './dates';
import { daysLeft, effectiveExpiry, urgencyOf, type Urgency } from './expiry';
import { formatQuantity } from './foods';
import { extractJson } from './gemini';
import { liveRecipe } from './match';
import { sortItems } from './pantry';
import { capitalize, newId } from './text';

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
  /** ⏰ solo con i prodotti in scadenza */
  onlyExpiring: boolean;
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
  onlyExpiring: false,
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
  /** "utente": scritta da chi usa l'app (si può modificare). Senza: proposta dall'IA. */
  source?: 'utente';
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
  if (f.onlyExpiring) {
    out.push(
      'Usa SOLO i prodotti in scadenza dell’elenco (quelli con "SCADE OGGI", "SCADE DOMANI", "scade tra N giorni" o "termine minimo passato") più quelli sempre in casa: niente altri prodotti della dispensa. Se con questi soli non vengono ricette buone, proponi comunque ricette che li usano insieme ad altri prodotti e dillo in "note".',
    );
  }
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
    '- "note" (fuori dalle ricette): una frase per l’utente solo se non sei riuscito a rispettare una richiesta (es. "Con i soli prodotti in scadenza viene solo una ricetta: le altre usano anche la pasta"), altrimenti "".',
    '- Nomi e testi in italiano. Ricette vere e buone, non combinazioni strane solo per usare tutto.',
    'Rispondi SOLO con JSON valido, senza testo prima o dopo, con questa forma:',
    '{"recipes":[{"title":"...","emoji":"🍝","minutes":20,"difficulty":"facile","servings":2,"uses":[{"ref":"p1","amount":"200 ml"}],"missing":[{"name":"...","amount":"..."}],"steps":["..."],"why":"...","tip":"..."}],"note":""}',
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
    note: STR,
  },
  required: ['recipes', 'note'],
} as const;

export function str(v: unknown, max: number): string {
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

/** "Pasta alla Carbonara dellaDispensa" → "Pasta alla Carbonara della Dispensa" (parole attaccate dal modello). */
export function fixTitle(t: string): string {
  return t.replace(/([a-zà-ÿ])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

function parseStepList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((s) => str(s, 400).replace(/^\d+[.)]\s*/, '')).filter(Boolean).slice(0, 12) : [];
}

/** Una ricetta della risposta del modello (anche dentro il piano dei pasti, dove il procedimento arriva dopo). */
export function parseRecipe(
  raw: unknown,
  refs: readonly PantryRef[],
  servings: number,
  nowIso: string,
  opts: { requireSteps?: boolean } = {},
): Recipe | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const title = fixTitle(str(o.title, 80));
  const steps = parseStepList(o.steps);
  if (!title || (opts.requireSteps !== false && !steps.length)) return null;
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

export interface RecipeResult {
  recipes: Recipe[];
  /** Frase dell'IA per l'utente (es. una richiesta che non è riuscita a rispettare), anche vuota. */
  note: string;
}

/** Risposta del modello → ricette (null se la risposta non si capisce). */
export function parseRecipes(text: string, refs: readonly PantryRef[], servings: number, nowIso: string): RecipeResult | null {
  const json = extractJson(text);
  if (typeof json !== 'object' || json === null) return null;
  const list = (json as Record<string, unknown>).recipes;
  if (!Array.isArray(list)) return null;
  return {
    recipes: list.map((r) => parseRecipe(r, refs, servings, nowIso)).filter((r): r is Recipe => r !== null).slice(0, 4),
    note: str((json as Record<string, unknown>).note, 300),
  };
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
    title: fixTitle(o.title) || o.title,
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
    ...(o.source === 'utente' ? { source: 'utente' as const } : {}),
  };
}

// ---------- Procedimento scritto dopo (piatti del piano e ricette scritte senza) ----------

export function buildStepsPrompt(recipe: Recipe): string {
  const ingredients = [
    ...recipe.uses.map((u) => `- ${u.name}${u.amount ? `: ${u.amount}` : ''}`),
    ...recipe.missing.map((m) => `- ${m.name}${m.amount ? `: ${m.amount}` : ''}`),
  ];
  return [
    'Sei uno chef italiano di cucina casalinga.',
    `Scrivi il procedimento di questo piatto: «${recipe.title}», per ${recipe.servings} ${recipe.servings === 1 ? 'persona' : 'persone'}.`,
    ingredients.length ? 'Ingredienti:' : '',
    ...ingredients,
    'Regole:',
    '- "steps": il procedimento in 3–8 passaggi brevi e chiari, con tempi e temperature. Usa gli ingredienti dell’elenco (sale, olio, pepe e acqua si possono aggiungere).',
    '- "minutes": tempo totale realistico.',
    '- "tip": un consiglio breve (varianti o come conservare gli avanzi), anche "".',
    'Rispondi SOLO con JSON valido, senza testo prima o dopo, con questa forma:',
    '{"steps":["..."],"minutes":20,"tip":"..."}',
  ]
    .filter(Boolean)
    .join('\n');
}

export const STEPS_SCHEMA = {
  type: 'object',
  properties: {
    steps: { type: 'array', items: STR, minItems: 1, maxItems: 12 },
    minutes: { type: 'number' },
    tip: STR,
  },
  required: ['steps', 'minutes', 'tip'],
} as const;

export interface StepsResult {
  steps: string[];
  minutes: number | null;
  tip: string;
}

export function parseSteps(text: string): StepsResult | null {
  const json = extractJson(text);
  if (typeof json !== 'object' || json === null) {
    // A volte arriva solo la lista dei passaggi.
    const list = salvageStrings(text);
    return list.length ? { steps: list, minutes: null, tip: '' } : null;
  }
  const o = json as Record<string, unknown>;
  const steps = parseStepList(o.steps);
  if (!steps.length) return null;
  const minutes = num(o.minutes);
  return { steps, minutes: minutes !== null && minutes > 0 && minutes <= 600 ? Math.round(minutes) : null, tip: str(o.tip, 300) };
}

function salvageStrings(text: string): string[] {
  const t = text.trim();
  if (!t.startsWith('[')) return [];
  try {
    return parseStepList(JSON.parse(t) as unknown);
  } catch {
    return [];
  }
}

/** La ricetta con il procedimento appena scritto. */
export function withSteps(recipe: Recipe, r: StepsResult): Recipe {
  return { ...recipe, steps: r.steps, tip: r.tip || recipe.tip, minutes: r.minutes ?? recipe.minutes };
}

// ---------- Ricette scritte da chi usa l'app ----------

/** Un passaggio per riga ("1. Cuoci la pasta" → "Cuoci la pasta"). */
export function stepsFromText(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim().replace(/^(\d+[.)]|[-•*])\s*/, '').slice(0, 400))
    .filter(Boolean)
    .slice(0, 20);
}

export interface UserRecipeFields {
  id?: string;
  title: string;
  emoji: string;
  servings: number;
  minutes: number;
  uses: RecipeUse[];
  missing: MissingIngredient[];
  steps: string[];
  createdAt?: string;
}

export function buildUserRecipe(f: UserRecipeFields, nowIso: string): Recipe {
  return {
    id: f.id ?? newId(),
    title: capitalize(fixTitle(f.title.slice(0, 80))) || 'Ricetta',
    emoji: f.emoji || '🍽️',
    minutes: Math.min(600, Math.max(1, Math.round(f.minutes || 30))),
    difficulty: 'facile',
    servings: Math.min(20, Math.max(1, Math.round(f.servings || 2))),
    uses: f.uses.map((u) => ({ ...u, amount: u.amount.trim().slice(0, 40) })),
    missing: f.missing.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim().slice(0, 60), amount: m.amount.trim().slice(0, 40) })),
    steps: f.steps,
    why: '',
    tip: '',
    createdAt: f.createdAt ?? nowIso,
    source: 'utente',
  };
}

/** Quanti ne restano dopo averne usati (solo per pezzi e confezioni, se la quantità usata è un numero chiaro). */
export function leftoverAfter(item: Pick<Item, 'quantity' | 'unit'>, amount: string): number | null {
  if (item.unit !== 'pz' && item.unit !== 'conf') return null;
  const m = /^\s*(\d+)(?![\d.,])(?!\s*(?:g|gr|kg|ml|cl|l)\b)/i.exec(amount);
  if (!m) return null;
  const used = Number(m[1]);
  return used > 0 && used < item.quantity ? item.quantity - used : null;
}

export interface UseStatus extends RecipeUse {
  /** Il prodotto è ancora in dispensa. */
  present: boolean;
  urgency: Urgency;
  /** In scadenza: entro 5 giorni, oppure un "preferibilmente entro" già passato. */
  expiring: boolean;
}

/**
 * Stato attuale dei prodotti usati. La ricetta si ricollega prima alla dispensa di adesso
 * (prodotti finiti e ricomprati, ingredienti "da comprare" che ora ci sono): vedi `liveRecipe`.
 */
export function useStatuses(recipe: Recipe, items: readonly Item[], today: string): UseStatus[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return liveRecipe(recipe, items).uses.map((u) => {
    const item = u.itemId ? byId.get(u.itemId) : undefined;
    const d = item ? daysLeft(item, today) : null;
    const expiring = !!item && d !== null && d <= 5 && (d >= 0 || item.expiryKind === 'tmc');
    return { ...u, present: !!item, urgency: item ? urgencyOf(d) : 'nessuna', expiring };
  });
}

/** Quanti prodotti in scadenza salva la ricetta. */
export function savedCount(statuses: readonly UseStatus[]): number {
  return statuses.filter((s) => s.present && s.expiring).length;
}

/**
 * Gruppo della ricetta:
 * - `scadenza`: usa solo prodotti in scadenza della dispensa (più quelli sempre in casa ed eventuali da comprare);
 * - `misto`: usa prodotti in scadenza e anche altri della dispensa;
 * - `altro`: non usa prodotti in scadenza.
 */
export type RecipeGroup = 'scadenza' | 'misto' | 'altro';

export function recipeGroup(recipe: Recipe, items: readonly Item[], today: string): RecipeGroup {
  const present = useStatuses(recipe, items, today).filter((s) => s.present);
  const expiring = present.filter((s) => s.expiring).length;
  if (!expiring) return 'altro';
  return expiring === present.length ? 'scadenza' : 'misto';
}

export const GROUP_TITLES: Record<RecipeGroup, string> = {
  scadenza: 'Solo con prodotti in scadenza',
  misto: 'Con prodotti in scadenza e altri',
  altro: 'Altre idee con quello che hai',
};

/** Ricette divise per gruppo (in ordine: solo in scadenza, misto, altro), senza gruppi vuoti. */
export function groupRecipes(recipes: readonly Recipe[], items: readonly Item[], today: string): { id: RecipeGroup; title: string; recipes: Recipe[] }[] {
  const order: RecipeGroup[] = ['scadenza', 'misto', 'altro'];
  return order
    .map((id) => ({ id, title: GROUP_TITLES[id], recipes: recipes.filter((r) => recipeGroup(r, items, today) === id) }))
    .filter((g) => g.recipes.length > 0);
}

/** Vero se l'utente ha chiesto solo prodotti in scadenza (con la pillola o scrivendolo in "Altro?"). */
export function wantsOnlyExpiring(f: Pick<RecipeFilters, 'onlyExpiring' | 'extra'>): boolean {
  return f.onlyExpiring || /scaden|scadono|scade\b/i.test(f.extra);
}

/**
 * Messaggio sopra le ricette quando si chiedevano solo prodotti in scadenza: se nessuna li usa da sola,
 * lo si dice e si spiega cosa sono le altre; se solo alcune, si spiega la divisione. Vuoto se non serve.
 */
export function onlyExpiringMessage(groups: readonly { id: RecipeGroup; recipes: readonly Recipe[] }[]): string {
  const only = groups.find((g) => g.id === 'scadenza')?.recipes.length ?? 0;
  const others = groups.filter((g) => g.id !== 'scadenza').reduce((n, g) => n + g.recipes.length, 0);
  if (!only && !others) return '';
  if (!only) return 'Non ho trovato ricette con solo prodotti in scadenza: queste li usano insieme ad altri prodotti che hai.';
  if (!others) return 'Ecco le ricette con solo prodotti in scadenza (più quelli sempre in casa).';
  return `${only === 1 ? 'Una ricetta usa' : `${only} ricette usano`} solo prodotti in scadenza; ${others === 1 ? 'l’altra li usa' : 'le altre li usano'} insieme ad altri prodotti.`;
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
