import Dexie, { type EntityTable } from 'dexie';
import type { Meal } from './logic/meals';
import type { Recipe } from './logic/recipes';
import type { HistoryEntry, Item, ShoppingItem, Template } from './types';

export interface KV {
  key: string;
  value: unknown;
}

/** Tutti i dati restano sul telefono, in IndexedDB. Non cambiare il nome del database. */
export class PantryDB extends Dexie {
  items!: EntityTable<Item, 'id'>;
  history!: EntityTable<HistoryEntry, 'id'>;
  shopping!: EntityTable<ShoppingItem, 'id'>;
  templates!: EntityTable<Template, 'key'>;
  /** Ricette salvate tra i preferiti. */
  recipes!: EntityTable<Recipe, 'id'>;
  /** Piano dei pasti (dalla versione 2 del database). */
  meals!: EntityTable<Meal, 'id'>;
  kv!: EntityTable<KV, 'key'>;

  constructor(name = 'dispensa') {
    super(name);
    // Per cambiare lo schema aggiungi una nuova version() senza togliere questa.
    this.version(1).stores({
      items: 'id, location, expiry, barcode, addedAt',
      history: '++id, date, outcome',
      shopping: 'id, done, order',
      templates: 'key, barcode, lastUsed',
      recipes: 'id, createdAt',
      kv: 'key',
    });
    // 1.2.0: piano dei pasti.
    this.version(2).stores({
      meals: 'id, date',
    });
  }
}

export const db = new PantryDB();
