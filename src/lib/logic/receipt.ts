// Lo scontrino della spesa: si fotografa e tutti i prodotti alimentari diventano bozze da mettere in dispensa.
// Sullo scontrino la data di scadenza non c'è: si stima (≈) dal giorno della spesa e la si corregge dopo.
import type { ExpiryKind, Location, Unit } from '../types';
import { addDays, daysBetween, formatWeekday } from './dates';
import type { ProductDraft } from './drafts';
import { guessFood, isUnit } from './foods';
import { extractJson, salvageList } from './gemini';
import { isLocation } from './pantry';
import { firstEmoji, parseAiDate } from './scan';
import { capitalize, normalize } from './text';

/** Al massimo tanti prodotti da uno scontrino (anche lungo). */
export const MAX_RECEIPT_PRODUCTS = 60;

const STR = { type: 'string' } as const;
const NUM = { type: 'number' } as const;

export const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    store: STR,
    purchaseDate: STR,
    products: {
      type: 'array',
      maxItems: MAX_RECEIPT_PRODUCTS,
      items: {
        type: 'object',
        properties: {
          line: STR,
          name: STR,
          brand: STR,
          size: STR,
          emoji: STR,
          location: { type: 'string', enum: ['frigo', 'freezer', 'dispensa'] },
          quantity: NUM,
          unit: { type: 'string', enum: ['pz', 'conf', 'g', 'kg', 'ml', 'l'] },
          expiryKind: { type: 'string', enum: ['scadenza', 'tmc'] },
          shelfDays: NUM,
          openDays: NUM,
        },
        required: ['line', 'name', 'brand', 'size', 'emoji', 'location', 'quantity', 'unit', 'expiryKind', 'shelfDays', 'openDays'],
      },
    },
    note: STR,
  },
  required: ['store', 'purchaseDate', 'products', 'note'],
} as const;

export function buildReceiptPrompt(today: string): string {
  return [
    `Sei l’assistente di un’app italiana per gestire la dispensa di casa e non sprecare cibo. Oggi è ${formatWeekday(today)} (${today}).`,
    'La foto mostra uno SCONTRINO della spesa di un supermercato italiano (può essere storto, piegato o tagliato in fondo).',
    'Leggi le righe dei prodotti ed elenca ogni prodotto ALIMENTARE comprato (cibi e bevande), nell’ordine dello scontrino.',
    'Regole per leggere lo scontrino:',
    '- I nomi sono abbreviati e in maiuscolo: scrivili per intero e chiari in italiano (es. "MOZZ.FDL 125G" → "Mozzarella fior di latte" con size "125 g"; "LATTE PS 1L GRANAR." → "Latte parzialmente scremato", brand "Granarolo", size "1 l"; "PASSATA POM." → "Passata di pomodoro").',
    '- "line": la riga esattamente come è stampata (senza il prezzo).',
    '- Quantità: "2 X 1,29" o "N.2" sotto o accanto a un prodotto vuol dire 2 pezzi ("quantity": 2, "unit": "pz"). Per frutta, verdura, carne o formaggio a peso ("0,456 KG X 2,99 €/KG") usa "quantity": 456 e "unit": "g". Se lo stesso prodotto compare su più righe, uniscilo sommando la quantità.',
    '- Ignora: sacchetti e shopper, sconti e promozioni ("SCONTO", righe con prezzo negativo), resi, subtotale e totale, pagamento, resto, IVA, punti e buoni, dati del negozio, e i prodotti che non si mangiano (detersivi, carta, igiene, cosmetici, cibo per animali, piante, giornali).',
    '- Se una riga non si capisce, scrivi il nome più probabile; se proprio non si capisce che cibo è, saltala e dillo in "note".',
    'Per ogni prodotto compila anche:',
    '- "brand": la marca se c’è sulla riga, altrimenti "". "size": il formato (es. "500 g", "1 l", "6 × 125 g"), altrimenti "".',
    '- "emoji": UNA sola emoji che rappresenta il cibo.',
    '- "location": dove si conserva appena comprato: "frigo", "freezer" (solo surgelati e gelati) o "dispensa".',
    '- "expiryKind": "scadenza" per i freschi (latte fresco, carne, pesce, latticini, verdura) e "tmc" per quelli a lunga conservazione (pasta, scatolame, biscotti, latte UHT).',
    '- "shelfDays": quanti giorni dura di solito chiuso dal giorno della spesa (es. latte fresco 6, mozzarella 7, insalata in busta 5, pane 2, petto di pollo 3, pasta secca 540, passata 540, surgelati 180).',
    '- "openDays": entro quanti giorni va consumato una volta aperto (es. latte 3, passata 4, mozzarella 2, prosciutto affettato 3); 0 se non cambia.',
    '- "store": il nome del negozio se si legge, altrimenti "". "purchaseDate": la data stampata sullo scontrino nel formato AAAA-MM-GG, altrimenti "".',
    '- "note": una frase breve se qualcosa non si leggeva (es. "la parte in fondo è tagliata"), altrimenti "".',
    'Se nella foto non c’è uno scontrino della spesa, restituisci "products": [] e spiegalo in "note".',
    'Rispondi SOLO con JSON valido, senza testo prima o dopo, con questa forma:',
    '{"store":"","purchaseDate":"","products":[{"line":"LATTE PS 1L GRANAR.","name":"Latte parzialmente scremato","brand":"Granarolo","size":"1 l","emoji":"🥛","location":"frigo","quantity":1,"unit":"pz","expiryKind":"scadenza","shelfDays":6,"openDays":3}],"note":""}',
  ].join('\n');
}

export interface ReceiptResult {
  products: ProductDraft[];
  store: string;
  /** Giorno della spesa usato per stimare le date (quello sullo scontrino, se è recente; altrimenti oggi). */
  purchaseDate: string;
  note: string;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Righe che non sono prodotti da mangiare, anche se il modello le ha lasciate. */
const NOT_FOOD = /^(shopper|sacchett|busta|borsa|sconto|totale|subtotale|resto|contanti|bancomat|carta di credito|iva|punti)/i;

function parseReceiptProduct(raw: unknown, from: string): ProductDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const name = capitalize(str(o.name, 60));
  if (!name || NOT_FOOD.test(name)) return null;
  const guess = guessFood(name);
  const location: Location = isLocation(o.location) ? o.location : guess.location;
  const unit: Unit = isUnit(o.unit) ? o.unit : 'pz';
  const q = num(o.quantity);
  const quantity = q !== null && q > 0 && q <= 99_999 ? Math.round(q * 100) / 100 : 1;
  const kind: ExpiryKind = o.expiryKind === 'tmc' || o.expiryKind === 'scadenza' ? o.expiryKind : guess.kind;
  const shelf = num(o.shelfDays);
  const shelfDays = shelf !== null && shelf >= 1 && shelf <= 3650 ? Math.round(shelf) : guess.shelfDays;
  const open = num(o.openDays);
  const openDays = open !== null && open >= 1 && open <= 365 ? Math.round(open) : open === 0 ? null : guess.openDays;
  const expiry = shelfDays ? addDays(from, shelfDays) : null;
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
    // Sullo scontrino la data non c'è mai: è sempre stimata (≈) e va controllata sulla confezione.
    expiryEstimated: expiry !== null,
    openDays,
    source: 'scontrino',
    receiptLine: str(o.line, 60) || undefined,
  };
}

/** Risposta del modello → prodotti dello scontrino (null se la risposta non si capisce). Recupera anche le risposte tagliate. */
export function parseReceipt(text: string, today: string): ReceiptResult | null {
  const json = extractJson(text);
  let o: Record<string, unknown> = {};
  let list: unknown[] | null = null;
  if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
    o = json as Record<string, unknown>;
    if (Array.isArray(o.products)) list = o.products;
  }
  if (!list) {
    const salvaged = salvageList(text, text.includes('"products"') ? 'products' : undefined);
    if (!salvaged.length) return null;
    list = salvaged;
  }
  // Le date si stimano dal giorno della spesa, se lo scontrino è di questi giorni (fino a 2 settimane fa).
  const printed = parseAiDate(o.purchaseDate, today);
  const age = printed ? daysBetween(printed, today) : -1;
  const from = printed && age >= 0 && age <= 14 ? printed : today;
  const products = mergeSameProducts(list.map((p) => parseReceiptProduct(p, from)).filter((p): p is ProductDraft => p !== null)).slice(0, MAX_RECEIPT_PRODUCTS);
  return { products, store: str(o.store, 40), purchaseDate: from, note: str(o.note, 200) };
}

function sameKey(d: ProductDraft): string {
  return `${normalize(d.name)}|${d.unit}`;
}

/** Stesso prodotto su più righe dello scontrino: una riga sola con la quantità sommata. */
export function mergeSameProducts(list: readonly ProductDraft[]): ProductDraft[] {
  const out: ProductDraft[] = [];
  for (const d of list) {
    const same = out.find((x) => sameKey(x) === sameKey(d));
    if (same) same.quantity = Math.round((same.quantity + d.quantity) * 100) / 100;
    else out.push({ ...d });
  }
  return out;
}

/**
 * Scontrino lungo fotografato in più parti: si aggiungono i prodotti nuovi.
 * Le foto di solito si sovrappongono: un prodotto già trovato non si conta due volte
 * (resta quello di prima, con le modifiche fatte, e la quantità più alta tra le due letture).
 */
export function addReceiptPart(previous: readonly ProductDraft[], next: readonly ProductDraft[]): ProductDraft[] {
  const out = previous.map((d) => ({ ...d }));
  for (const d of next) {
    const same = out.find((x) => sameKey(x) === sameKey(d));
    if (same) same.quantity = Math.max(same.quantity, d.quantity);
    else out.push({ ...d });
  }
  return out.slice(0, MAX_RECEIPT_PRODUCTS * 2);
}

/** Data da controllare: stimata e di un prodotto fresco (scade entro 45 giorni). Quelli a lunga conservazione vanno bene così. */
/** Prodotto fresco (scade entro 45 giorni): la data va guardata sulla confezione. */
export function isFreshDraft(d: Pick<ProductDraft, 'expiry'>, today: string): boolean {
  return !!d.expiry && daysBetween(today, d.expiry) <= 45;
}

/** Fresco con la data ancora stimata: è da controllare. */
export function needsDateCheck(d: Pick<ProductDraft, 'expiry' | 'expiryEstimated'>, today: string): boolean {
  return d.expiryEstimated && isFreshDraft(d, today);
}

export function receiptWaitingMessage(seconds: number): string {
  if (seconds < 3) return 'Invio la foto dello scontrino…';
  if (seconds < 10) return 'Leggo le righe dello scontrino…';
  if (seconds < 25) return 'Scrivo i nomi per intero e tolgo quello che non si mangia…';
  if (seconds < 50) return 'Scontrino lungo: ancora un momento…';
  return 'Ci vuole più del solito: provo anche con altri modelli…';
}
