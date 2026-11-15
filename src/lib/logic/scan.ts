// Lettura delle foto con l'IA: etichetta di un prodotto, più prodotti o uno scontrino, oppure solo la data.
import type { ExpiryKind, Location, Unit } from '../types';
import { addDays, daysBetween, formatWeekday, isDateKey, lastDayOfMonth } from './dates';
import type { ProductDraft } from './drafts';
import { guessFood, isUnit } from './foods';
import { extractJson } from './gemini';
import { isLocation } from './pantry';
import { capitalize } from './text';

/**
 * - `etichetta`: un prodotto (o la sua etichetta) in primo piano;
 * - `multi`: la spesa appena fatta (più prodotti) oppure uno scontrino;
 * - `data`: solo la data di scadenza di un prodotto già scelto.
 */
export type ScanMode = 'etichetta' | 'multi' | 'data';

export interface ScanResult {
  products: ProductDraft[];
  note: string;
}

const STR = { type: 'string' } as const;
const NUM = { type: 'number' } as const;

/** Forma della risposta per gli "structured outputs" di Gemini. */
export const SCAN_SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          name: STR,
          brand: STR,
          size: STR,
          emoji: STR,
          location: { type: 'string', enum: ['frigo', 'freezer', 'dispensa'] },
          quantity: NUM,
          unit: { type: 'string', enum: ['pz', 'conf', 'g', 'kg', 'ml', 'l'] },
          expiry: STR,
          expiryText: STR,
          expiryKind: { type: 'string', enum: ['scadenza', 'tmc'] },
          shelfDays: NUM,
          openDays: NUM,
        },
        required: ['name', 'brand', 'size', 'emoji', 'location', 'quantity', 'unit', 'expiry', 'expiryText', 'expiryKind', 'shelfDays', 'openDays'],
      },
    },
    note: STR,
  },
  required: ['products', 'note'],
} as const;

/** Istruzioni per il modello. */
export function buildScanPrompt(mode: ScanMode, today: string, productName = ''): string {
  const intro =
    mode === 'etichetta'
      ? 'L’utente inquadra un prodotto alimentare (o la sua etichetta) per metterlo in dispensa. Di solito c’è UN solo prodotto: restituisci quello in primo piano. Se si vede solo la data di scadenza e non si capisce il prodotto, restituisci un prodotto con "name": "" e la data.'
      : mode === 'multi'
        ? 'La foto mostra la spesa appena fatta: più prodotti alimentari (sul tavolo, in un sacchetto, in frigo) OPPURE uno scontrino della spesa. Elenca ogni prodotto alimentare diverso (massimo 30) e unisci i doppioni aumentando "quantity". Se è uno scontrino: scrivi nomi completi e chiari (gli scontrini abbreviano, es. "MOZZ.FDL 125G" → "Mozzarella fior di latte" con size "125 g"), ignora sacchetti, sconti, totali e prodotti che non si mangiano (detersivi, carta, cosmetici); sugli scontrini la data non c’è: "expiry": "" e stima "shelfDays".'
        : `L’utente fotografa la data di scadenza stampata sulla confezione di "${productName.slice(0, 60)}". Restituisci UN solo prodotto con "name": "${productName.slice(0, 60)}" e la data letta; gli altri campi stimali.`;
  return [
    `Sei l’assistente di un’app italiana per gestire la dispensa di casa e non sprecare cibo. Oggi è ${formatWeekday(today)} (${today}).`,
    intro,
    'Per ogni prodotto compila:',
    '- "name": nome chiaro in italiano, come lo direbbe una persona (es. "Latte parzialmente scremato", "Yogurt greco bianco", "Mozzarella"), senza marca e senza peso.',
    '- "brand": la marca se si legge, altrimenti "". "size": il formato se si legge (es. "500 g", "1 l", "6 × 125 g"), altrimenti "".',
    '- "emoji": UNA sola emoji che rappresenta il cibo.',
    '- "location": dove si conserva appena comprato: "frigo", "freezer" (solo surgelati e gelati) o "dispensa".',
    '- "quantity" e "unit": quanti pezzi o confezioni si vedono ("pz" o "conf"); per frutta e verdura sfuse anche "g" o "kg".',
    '- "expiry": la data di scadenza stampata, nel formato AAAA-MM-GG. Le date italiane sono giorno/mese/anno; con l’anno a 2 cifre "27" vuol dire 2027. Se ci sono solo mese e anno (es. "03/2027", "03.27", "MAR 2027") usa l’ultimo giorno del mese. Il lotto ("L", "LOT", "Lotto") NON è la data. Se la data non si vede o non si legge con sicurezza scrivi "" e NON inventarla.',
    '- "expiryText": la data esattamente come la leggi (es. "da consumarsi entro 12/03/27"), altrimenti "".',
    '- "expiryKind": "tmc" se c’è scritto "da consumarsi preferibilmente entro" (o TMC) o se il prodotto è a lunga conservazione; "scadenza" se c’è scritto "da consumarsi entro" o se è un prodotto fresco.',
    '- "shelfDays": quanti giorni dura di solito chiuso, contando da oggi (es. latte fresco 6, mozzarella 7, insalata 4, pasta secca 540). Serve quando la data non si legge.',
    '- "openDays": entro quanti giorni va consumato una volta aperto (es. latte 3, passata 4, mozzarella 2, prosciutto affettato 3); 0 se non cambia (pasta secca, riso, frutta intera).',
    mode === 'multi' ? '' : 'Se nella foto non c’è nessun cibo né una data, restituisci "products": [].',
    'Rispondi SOLO con JSON valido, senza testo prima o dopo, con questa forma:',
    '{"products":[{"name":"...","brand":"","size":"","emoji":"🥛","location":"frigo","quantity":1,"unit":"pz","expiry":"2027-03-12","expiryText":"","expiryKind":"scadenza","shelfDays":6,"openDays":3}],"note":"una frase breve su cosa non si leggeva bene, oppure \\"\\""}',
  ]
    .filter(Boolean)
    .join('\n');
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** La prima emoji del testo (se c'è). */
export function firstEmoji(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (!t) return '';
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: 'grapheme' }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  const first = Seg ? ([...new Seg('it', { granularity: 'grapheme' }).segment(t)][0]?.segment ?? '') : [...t][0] ?? '';
  return /\p{Extended_Pictographic}/u.test(first) ? first : '';
}

/**
 * Data letta dall'IA → AAAA-MM-GG valida, o null. Accetta anche "12/03/2027", "12.03.27" e "03/2027".
 * Scarta date assurde (più di 2 anni fa o oltre 15 anni).
 */
export function parseAiDate(raw: unknown, today: string): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  let key: string | null = null;
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) key = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  if (!key && (m = /^(\d{1,2})[./\- ](\d{1,2})[./\- ](\d{2}|\d{4})$/.exec(t))) {
    key = `${year(m[3]!)}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  if (!key && (m = /^(\d{1,2})[./\- ](\d{4}|\d{2})$/.exec(t))) {
    const month = Number(m[1]);
    if (month >= 1 && month <= 12) key = lastDayOfMonth(year(m[2]!), month);
  }
  if (!key && (m = /^(\d{4})-(\d{1,2})$/.exec(t))) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) key = lastDayOfMonth(Number(m[1]), month);
  }
  if (!key || !isDateKey(key)) return null;
  const diff = daysBetween(today, key);
  return diff < -730 || diff > 365 * 15 ? null : key;
}

function parseProduct(raw: unknown, today: string): ProductDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const name = capitalize(str(o.name, 60));
  const expiryRead = parseAiDate(o.expiry, today);
  if (!name && !expiryRead) return null;
  const guess = guessFood(name);
  const location: Location = isLocation(o.location) ? o.location : guess.location;
  const unit: Unit = isUnit(o.unit) ? o.unit : 'pz';
  const q = num(o.quantity);
  const quantity = q !== null && q > 0 && q <= 9999 ? Math.round(q * 100) / 100 : 1;
  const kind: ExpiryKind = o.expiryKind === 'tmc' || o.expiryKind === 'scadenza' ? o.expiryKind : guess.kind;
  const shelf = num(o.shelfDays);
  const shelfDays = shelf !== null && shelf >= 1 && shelf <= 3650 ? Math.round(shelf) : guess.shelfDays;
  const open = num(o.openDays);
  const openDays = open !== null && open >= 1 && open <= 365 ? Math.round(open) : open === 0 ? null : guess.openDays;
  const expiry = expiryRead ?? (shelfDays ? addDays(today, shelfDays) : null);
  return {
    name,
    brand: str(o.brand, 40) || undefined,
    size: str(o.size, 30) || undefined,
    emoji: firstEmoji(o.emoji) || guess.emoji,
    location,
    quantity,
    unit,
    expiry,
    expiryKind: kind,
    expiryEstimated: expiryRead === null && expiry !== null,
    openDays,
    source: 'foto',
    expiryText: str(o.expiryText, 80) || undefined,
  };
}

/** Risposta del modello → prodotti (null se la risposta non si capisce). */
export function parseScan(text: string, today: string): ScanResult | null {
  const json = extractJson(text);
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.products)) return null;
  const products = o.products.map((p) => parseProduct(p, today)).filter((p): p is ProductDraft => p !== null).slice(0, 30);
  return { products, note: str(o.note, 200) };
}

/** Messaggio durante l'attesa, in base ai secondi passati. */
export function scanWaitingMessage(seconds: number, mode: ScanMode): string {
  if (seconds < 3) return 'Invio la foto…';
  if (seconds < 9) return mode === 'multi' ? 'Riconosco i prodotti…' : mode === 'data' ? 'Leggo la data…' : 'Leggo l’etichetta…';
  if (seconds < 20) return mode === 'multi' ? 'Preparo l’elenco…' : 'Cerco la data di scadenza…';
  return 'Ci vuole più del solito, ancora un momento…';
}
