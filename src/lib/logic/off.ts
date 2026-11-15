// Lettura dei dati di Open Food Facts (https://world.openfoodfacts.org, licenza ODbL) per il codice a barre.
// Solo funzioni pure: le richieste di rete sono in services/openfoodfacts.ts.
import type { Location } from '../types';
import { addDays } from './dates';
import type { ProductDraft } from './drafts';
import { guessFood, isKnownFood } from './foods';
import { capitalize } from './text';

export const OFF_FIELDS = [
  'code',
  'product_name',
  'product_name_it',
  'generic_name',
  'generic_name_it',
  'brands',
  'quantity',
  'categories_tags',
  'image_front_small_url',
  'image_small_url',
].join(',');

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ').trim();
  return '';
}

/** Codice a barre plausibile (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function isBarcode(s: string): boolean {
  return /^\d{8}$|^\d{12,14}$/.test(s.trim());
}

export function productName(p: Json): string {
  return str(p['product_name_it']) || str(p['product_name']) || str(p['generic_name_it']) || str(p['generic_name']) || '';
}

/** Dove si tiene, dalle categorie di Open Food Facts (null se non si capisce). */
export function locationFromCategories(tags: unknown): Location | null {
  if (!Array.isArray(tags)) return null;
  const t = tags.filter((x): x is string => typeof x === 'string').join(' ');
  if (/frozen|surgel|ice-cream|gelat/.test(t)) return 'freezer';
  if (/uht|long-life|canned|dried|pasta|rice|cereal|biscuit|snack|beverage|water|coffee|tea|oil|vinegar|sugar|flour|spice|condiment|jam|chocolate|confection/.test(t)) {
    return 'dispensa';
  }
  if (/fresh|dairies|dairy|cheese|yogurt|milk|meat|fish|seafood|charcuterie|ham|sausage|eggs|refrigerated|desserts-chilled/.test(t)) return 'frigo';
  return null;
}

/** Un prodotto di Open Food Facts → bozza da confermare. */
export function productToDraft(p: Json, code: string, today: string): ProductDraft {
  const name = capitalize(productName(p));
  const guess = guessFood(name);
  const fromCategories = locationFromCategories(p['categories_tags']);
  // Il nome riconosciuto vale più delle categorie (spesso incomplete); i surgelati si fidano delle categorie.
  const location: Location = fromCategories === 'freezer' || !isKnownFood(name) ? (fromCategories ?? guess.location) : guess.location;
  const shelf = location === 'freezer' && guess.location !== 'freezer' ? 180 : guess.shelfDays;
  const image = str(p['image_front_small_url']) || str(p['image_small_url']);
  return {
    name,
    brand: str(p['brands']).split(',')[0]?.trim() || undefined,
    size: str(p['quantity']).slice(0, 30) || undefined,
    emoji: location === 'freezer' && guess.location !== 'freezer' ? '🧊' : guess.emoji,
    location,
    quantity: 1,
    unit: 'pz',
    expiry: shelf ? addDays(today, shelf) : null,
    expiryKind: location === 'freezer' ? 'tmc' : guess.kind,
    expiryEstimated: shelf !== null,
    openDays: guess.openDays,
    barcode: code,
    imageUrl: /^https:\/\//.test(image) ? image : undefined,
    source: 'barcode',
  };
}

export type BarcodeLookup = { kind: 'found'; draft: ProductDraft } | { kind: 'missing' };

/** Risposta della ricerca per codice a barre (API v2). */
export function parseProductResponse(json: unknown, code: string, today: string): BarcodeLookup {
  if (!isObj(json)) return { kind: 'missing' };
  const status = json['status'];
  const ok = status === 1 || status === 'success' || status === 'success_with_warnings';
  const product = json['product'];
  if (!ok || !isObj(product) || !productName(product)) return { kind: 'missing' };
  return { kind: 'found', draft: productToDraft(product, code, today) };
}
