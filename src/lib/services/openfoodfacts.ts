// Ricerca del codice a barre su Open Food Facts. Nell'app Android passa dal telefono (CapacitorHttp),
// così si manda lo User-Agent che Open Food Facts chiede e non ci sono blocchi CORS.
import { CapacitorHttp } from '@capacitor/core';
import { UserError } from '../errors';
import { isBarcode, OFF_FIELDS, parseProductResponse, type BarcodeLookup } from '../logic/off';
import { APP_VERSION, isNative } from '../platform';

const USER_AGENT = `Dispensa/${APP_VERSION} (https://github.com/Nikcirri/dispensa)`;
const TIMEOUT_MS = 12_000;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function getJson(url: string): Promise<unknown> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new UserError('Sei offline: scrivi il nome del prodotto a mano.');
  }
  if (isNative()) {
    const res = await CapacitorHttp.get({
      url,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
      responseType: 'json',
    });
    if (res.status >= 400) throw new HttpError(res.status);
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (res.status >= 400) throw new HttpError(res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Cerca il prodotto del codice a barre. "missing" se Open Food Facts non lo conosce. */
export async function lookupBarcode(code: string, today: string): Promise<BarcodeLookup> {
  const clean = code.trim();
  if (!isBarcode(clean)) return { kind: 'missing' };
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json?lc=it&fields=${OFF_FIELDS}`;
  try {
    return parseProductResponse(await getJson(url), clean, today);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { kind: 'missing' };
    if (e instanceof UserError) throw e;
    throw new UserError('Non riesco a contattare Open Food Facts. Scrivi il nome a mano o riprova.');
  }
}
