// "Programma con l'IA": una ricetta per ogni pasto libero dei prossimi giorni,
// con i prodotti che scadono prima messi nei pasti più vicini.
import type { Item } from '../types';
import { daysBetween, formatWeekday } from './dates';
import { extractJson } from './gemini';
import type { MealSlot } from './meals';
import { DEFAULT_FILTERS, filterLines, pantryRefs, parseRecipe, str, type PantryRef, type Recipe } from './recipes';

/** Al massimo tanti pasti in una richiesta (risposte più lunghe diventano lente e fragili). */
export const MAX_PLAN_SLOTS = 10;

export interface PlanSlot {
  /** Codice breve per l'IA: "s1", "s2"… */
  code: string;
  date: string;
  slot: MealSlot;
}

export interface PlanOptions {
  servings: number;
  vegetarian: boolean;
  lactoseFree: boolean;
  glutenFree: boolean;
  /** Solo con quello che c'è in casa: niente da comprare. */
  onlyPantry: boolean;
  staples: readonly string[];
  /** Richiesta scritta dall'utente ("pesce il venerdì"). */
  extra: string;
}

export interface PlanProposal {
  slot: PlanSlot;
  recipe: Recipe;
}

export interface PlanResult {
  proposals: PlanProposal[];
  note: string;
}

export function planSlots(free: readonly { date: string; slot: MealSlot }[]): PlanSlot[] {
  return free.slice(0, MAX_PLAN_SLOTS).map((f, i) => ({ code: `s${i + 1}`, date: f.date, slot: f.slot }));
}

function slotLine(s: PlanSlot, today: string): string {
  const d = daysBetween(today, s.date);
  const when = d === 0 ? 'oggi' : d === 1 ? 'domani' : `tra ${d} giorni`;
  return `${s.code} | ${formatWeekday(s.date)} (${when}) | ${s.slot}`;
}

export function buildPlanPrompt(items: readonly Item[], today: string, slots: readonly PlanSlot[], opt: PlanOptions): { prompt: string; refs: PantryRef[] } {
  const { refs, lines } = pantryRefs(items, today);
  const staples = opt.staples.map((s) => s.trim()).filter(Boolean);
  const servings = Math.min(12, Math.max(1, Math.round(opt.servings)));
  const extra = opt.extra.trim().slice(0, 300);
  const filters = { ...DEFAULT_FILTERS, vegetarian: opt.vegetarian, lactoseFree: opt.lactoseFree, onlyPantry: opt.onlyPantry, servings, extra };
  const prompt = [
    `Sei uno chef italiano di cucina casalinga e anti-spreco. Oggi è ${formatWeekday(today)}.`,
    'Ecco cosa c’è in casa (codice | prodotto | quantità | dove | scadenza):',
    ...lines,
    staples.length ? `In casa ci sono sempre anche: ${staples.join(', ')} (non metterli tra gli ingredienti mancanti).` : '',
    'Programma questi pasti (codice | giorno | pasto):',
    ...slots.map((s) => slotLine(s, today)),
    `Per OGNI pasto dell’elenco proponi UNA ricetta per ${servings} ${servings === 1 ? 'persona' : 'persone'}.`,
    'Regole del piano:',
    '- Anti-spreco prima di tutto: metti i prodotti che scadono prima nei pasti più vicini. Un prodotto che scade in un certo giorno va usato in un pasto di quel giorno o di un giorno prima.',
    '- Non usare lo stesso prodotto in più pasti se la quantità non basta.',
    '- Varia: non due primi di pasta di fila, alterna primi, secondi, piatti unici, zuppe e verdure. Il pranzo può essere più semplice e veloce.',
    '- I prodotti senza scadenza vicina (pasta, riso, scatolame, surgelati) usali per completare i piatti.',
    ...filterLines(filters, opt.glutenFree),
    extra ? `Richiesta dell’utente: """${extra}"""` : '',
    'Regole per ogni ricetta:',
    '- "slot": il codice del pasto (es. "s1"), ogni codice una volta sola.',
    '- "uses": i prodotti dell’elenco usati, con il codice esatto (es. "p1") e la quantità (es. "200 ml", "2", "metà"). Usa solo codici dell’elenco.',
    '- "missing": ingredienti che servono ma non sono in casa, con la quantità; il meno possibile.',
    '- "steps": il procedimento in 3–6 passaggi brevi e chiari.',
    '- "minutes": tempo totale realistico. "difficulty": "facile", "media" o "impegnativa".',
    '- "why": una frase su cosa salva dallo spreco. "tip": un consiglio breve (anche "").',
    '- "note" (fuori dai pasti): una frase per l’utente solo se non sei riuscito a rispettare una richiesta, altrimenti "".',
    '- Nomi e testi in italiano. Ricette vere e buone, non combinazioni strane solo per usare tutto.',
    'Rispondi SOLO con JSON valido, senza testo prima o dopo, con questa forma:',
    '{"meals":[{"slot":"s1","title":"...","emoji":"🍝","minutes":20,"difficulty":"facile","servings":2,"uses":[{"ref":"p1","amount":"200 ml"}],"missing":[{"name":"...","amount":"..."}],"steps":["..."],"why":"...","tip":"..."}],"note":""}',
  ]
    .filter(Boolean)
    .join('\n');
  return { prompt, refs };
}

const STR = { type: 'string' } as const;

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    meals: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_PLAN_SLOTS,
      items: {
        type: 'object',
        properties: {
          slot: STR,
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
          steps: { type: 'array', items: STR, minItems: 1, maxItems: 8 },
          why: STR,
          tip: STR,
        },
        required: ['slot', 'title', 'emoji', 'minutes', 'difficulty', 'servings', 'uses', 'missing', 'steps', 'why', 'tip'],
      },
    },
    note: STR,
  },
  required: ['meals', 'note'],
} as const;

/** Risposta del modello → una proposta per pasto (null se la risposta non si capisce). */
export function parsePlan(text: string, refs: readonly PantryRef[], slots: readonly PlanSlot[], servings: number, nowIso: string): PlanResult | null {
  const json = extractJson(text);
  if (typeof json !== 'object' || json === null) return null;
  const list = (json as Record<string, unknown>).meals;
  if (!Array.isArray(list)) return null;
  const used = new Set<string>();
  const proposals: PlanProposal[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const code = str((raw as Record<string, unknown>).slot, 8).toLowerCase();
    const slot = slots.find((s) => s.code === code);
    if (!slot || used.has(code)) continue;
    const recipe = parseRecipe(raw, refs, servings, nowIso);
    if (!recipe) continue;
    used.add(code);
    proposals.push({ slot, recipe });
  }
  proposals.sort((a, b) => slots.indexOf(a.slot) - slots.indexOf(b.slot));
  return { proposals, note: str((json as Record<string, unknown>).note, 300) };
}

/** Frase da mostrare mentre l'IA prepara il piano. */
export function planWaitingMessage(seconds: number): string {
  if (seconds < 4) return 'Guardo cosa c’è in dispensa…';
  if (seconds < 12) return 'Metto i prodotti che scadono prima nei primi giorni…';
  if (seconds < 30) return 'Scrivo le ricette dei pasti…';
  return 'Tanti pasti da preparare: ancora un momento…';
}
