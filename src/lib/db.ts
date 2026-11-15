import Dexie, { type EntityTable } from 'dexie';
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
  }
}

export const db = new PantryDB();
