// Date come "AAAA-MM-GG" (giorno locale del telefono): niente fusi orari nei conti dei giorni.

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Giorno locale di una data. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now: Date = new Date()): string {
  return dateKey(now);
}

function parts(key: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Vero se è una data vera nel formato AAAA-MM-GG (niente 31 febbraio). */
export function isDateKey(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const p = parts(v);
  if (!p) return false;
  const [y, m, d] = p;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Ultimo giorno del mese (per le date con solo mese e anno, es. "03/2027"). */
export function lastDayOfMonth(year: number, month: number): string {
  return `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
}

function utc(key: string): number {
  const p = parts(key);
  if (!p) return NaN;
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

/** Giorni da `from` a `to` (positivo se `to` è dopo). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

export function addDays(key: string, n: number): string {
  const t = utc(key);
  const d = new Date(t + Math.round(n) * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Stessa data di un mese o più dopo (il 31 gennaio + 1 mese = 28/29 febbraio). */
export function addMonths(key: string, n: number): string {
  const p = parts(key);
  if (!p) return key;
  const total = p[0] * 12 + (p[1] - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(p[2], daysInMonth(y, m)))}`;
}

/** Data locale a mezzanotte (per le notifiche). */
export function keyToDate(key: string, hour = 0, minute = 0): Date {
  const p = parts(key) ?? [1970, 1, 1];
  return new Date(p[0], p[1] - 1, p[2], hour, minute, 0, 0);
}

/** "12 mar" (con l'anno se non è quello di `today`: "12 mar 2027"). */
export function formatShort(key: string, today: string): string {
  const p = parts(key);
  if (!p) return key;
  const t = parts(today);
  const base = `${p[2]} ${MONTHS_SHORT[p[1] - 1]}`;
  return t && t[0] === p[0] ? base : `${base} ${p[0]}`;
}

/** "12 marzo 2027". */
export function formatLong(key: string): string {
  const p = parts(key);
  if (!p) return key;
  return `${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}`;
}

/** "martedì 12 marzo". */
export function formatWeekday(key: string): string {
  const p = parts(key);
  if (!p) return key;
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return `${WEEKDAYS[d.getUTCDay()]} ${p[2]} ${MONTHS[p[1] - 1]}`;
}

/** "novembre 2026" per una chiave di mese "AAAA-MM". */
export function formatMonth(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function monthOf(key: string): string {
  return key.slice(0, 7);
}

/** Mese precedente di una chiave "AAAA-MM". */
export function previousMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** Saluto in alto nella Dispensa (come Nutrizione). */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 13) return 'Buongiorno';
  if (hour >= 13 && hour < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}
