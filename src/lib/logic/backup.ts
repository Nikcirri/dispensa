// Backup: tutti i dati in un file JSON da salvare dove si vuole (Drive, email, WhatsApp…).
// La chiave di Gemini NON va nel backup.
import { cleanDetails } from './shopping';
import type { HistoryEntry, Item, Settings, ShoppingItem, Template } from '../types';
import { isDateKey } from './dates';
import { isUnit } from './foods';
import { isLocation } from './pantry';
import { sanitizeMeal, type Meal } from './meals';
import { sanitizeRecipe, type Recipe } from './recipes';
import { sanitizeSettings } from './settings';

export const BACKUP_FORMAT = 1;

export interface BackupData {
  settings: Settings;
  items: Item[];
  history: HistoryEntry[];
  shopping: ShoppingItem[];
  templates: Template[];
  recipes: Recipe[];
  /** Piano dei pasti (dalla 1.2.0; i backup vecchi non lo hanno). */
  meals: Meal[];
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export function backupFileName(today: string): string {
  return `dispensa-backup-${today}.json`;
}

export function makeBackup(data: BackupData, version: string, now: Date = new Date()): string {
  return JSON.stringify({ app: 'dispensa', format: BACKUP_FORMAT, version, exportedAt: now.toISOString(), data });
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown) => (isStr(v) ? v : undefined);

export function sanitizeItem(v: unknown): Item | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isLocation(v.location)) return null;
  return {
    id: v.id,
    name: v.name,
    brand: optStr(v.brand),
    size: optStr(v.size),
    emoji: isStr(v.emoji) && v.emoji ? v.emoji : '🛒',
    location: v.location,
    quantity: isNum(v.quantity) && v.quantity > 0 ? v.quantity : 1,
    unit: isUnit(v.unit) ? v.unit : 'pz',
    expiry: isDateKey(v.expiry) ? v.expiry : null,
    expiryKind: v.expiryKind === 'tmc' ? 'tmc' : 'scadenza',
    expiryEstimated: v.expiryEstimated === true,
    openedAt: isDateKey(v.openedAt) ? v.openedAt : null,
    openDays: isNum(v.openDays) && v.openDays > 0 ? Math.round(v.openDays) : null,
    barcode: optStr(v.barcode),
    imageUrl: optStr(v.imageUrl),
    thumb: isStr(v.thumb) && v.thumb.startsWith('data:image/') ? v.thumb : undefined,
    source: v.source === 'foto' || v.source === 'barcode' || v.source === 'multi' || v.source === 'scontrino' || v.source === 'spesa' || v.source === 'ricordato' ? v.source : 'mano',
    addedAt: isStr(v.addedAt) ? v.addedAt : new Date().toISOString(),
    updatedAt: isStr(v.updatedAt) ? v.updatedAt : new Date().toISOString(),
    note: optStr(v.note),
  };
}

function sanitizeHistory(v: unknown): HistoryEntry | null {
  if (!isObj(v) || !isStr(v.name) || !isDateKey(v.date) || (v.outcome !== 'consumato' && v.outcome !== 'buttato')) return null;
  return {
    at: isStr(v.at) ? v.at : `${v.date}T12:00:00.000Z`,
    date: v.date,
    name: v.name,
    emoji: isStr(v.emoji) ? v.emoji : '🛒',
    location: isLocation(v.location) ? v.location : 'dispensa',
    outcome: v.outcome,
    wasExpired: v.wasExpired === true,
  };
}

/** Le specifiche di un prodotto della spesa: il campo c'è solo se ce n'è almeno una (così i dati restano uguali tra i telefoni). */
function withDetails(v: unknown): Pick<ShoppingItem, 'details'> {
  const details = cleanDetails(v);
  return details.length ? { details } : {};
}

export function sanitizeShopping(v: unknown): ShoppingItem | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name)) return null;
  return {
    id: v.id,
    name: v.name,
    emoji: isStr(v.emoji) ? v.emoji : '🛒',
    note: isStr(v.note) ? v.note : '',
    done: v.done === true,
    addedAt: isStr(v.addedAt) ? v.addedAt : new Date().toISOString(),
    order: isNum(v.order) ? v.order : 0,
    ...withDetails(v.details),
  };
}

function sanitizeTemplate(v: unknown): Template | null {
  if (!isObj(v) || !isStr(v.key) || !isStr(v.name) || !isLocation(v.location)) return null;
  return {
    key: v.key,
    name: v.name,
    brand: optStr(v.brand),
    size: optStr(v.size),
    emoji: isStr(v.emoji) ? v.emoji : '🛒',
    location: v.location,
    quantity: isNum(v.quantity) && v.quantity > 0 ? v.quantity : 1,
    unit: isUnit(v.unit) ? v.unit : 'pz',
    expiryKind: v.expiryKind === 'tmc' ? 'tmc' : 'scadenza',
    shelfDays: isNum(v.shelfDays) && v.shelfDays > 0 ? Math.round(v.shelfDays) : null,
    openDays: isNum(v.openDays) && v.openDays > 0 ? Math.round(v.openDays) : null,
    barcode: optStr(v.barcode),
    imageUrl: optStr(v.imageUrl),
    thumb: isStr(v.thumb) && v.thumb.startsWith('data:image/') ? v.thumb : undefined,
    uses: isNum(v.uses) ? v.uses : 1,
    lastUsed: isStr(v.lastUsed) ? v.lastUsed : new Date(0).toISOString(),
  };
}

function list<T>(v: unknown, fn: (x: unknown) => T | null): T[] {
  return Array.isArray(v) ? v.map(fn).filter((x): x is T => x !== null) : [];
}

/** Legge il testo di un backup. Lancia BackupError con un messaggio comprensibile se non va bene. */
export function parseBackup(text: string): BackupData {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupError('Il file non è un backup valido (non riesco a leggerlo).');
  }
  if (!isObj(json) || json.app !== 'dispensa' || !isObj(json.data)) {
    throw new BackupError('Questo file non è un backup dell’app Dispensa.');
  }
  if (!isNum(json.format) || json.format > BACKUP_FORMAT) {
    throw new BackupError('Il backup è di una versione più nuova dell’app: aggiorna l’app e riprova.');
  }
  const d = json.data;
  return {
    settings: { ...sanitizeSettings(d.settings), onboarded: true },
    items: list(d.items, sanitizeItem),
    history: list(d.history, sanitizeHistory),
    shopping: list(d.shopping, sanitizeShopping),
    templates: list(d.templates, sanitizeTemplate),
    recipes: list(d.recipes, sanitizeRecipe),
    meals: list(d.meals, sanitizeMeal),
  };
}
