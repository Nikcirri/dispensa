// Tipi dei dati salvati sul telefono (IndexedDB, vedi db.ts).

/** Dove sta il prodotto. */
export type Location = 'frigo' | 'freezer' | 'dispensa';

/** Unità della quantità. */
export type Unit = 'pz' | 'conf' | 'g' | 'kg' | 'ml' | 'l';

/**
 * Tipo di data sulla confezione:
 * - `scadenza`: "da consumarsi entro" (prodotti freschi: dopo non va mangiato);
 * - `tmc`: "da consumarsi preferibilmente entro" (termine minimo di conservazione: dopo di solito è ancora buono).
 */
export type ExpiryKind = 'scadenza' | 'tmc';

/** Come è stato aggiunto il prodotto. */
export type ItemSource = 'foto' | 'barcode' | 'multi' | 'scontrino' | 'mano' | 'spesa' | 'ricordato';

export interface Item {
  id: string;
  name: string;
  brand?: string;
  /** Formato della confezione, es. "500 g" o "6 × 125 g". */
  size?: string;
  emoji: string;
  location: Location;
  quantity: number;
  unit: Unit;
  /** Data sulla confezione (AAAA-MM-GG) o null se non ha scadenza. */
  expiry: string | null;
  expiryKind: ExpiryKind;
  /** Vero se la data è stimata (non letta dalla confezione). */
  expiryEstimated: boolean;
  /** Giorno di apertura (AAAA-MM-GG) o null se è ancora chiuso. */
  openedAt: string | null;
  /** Una volta aperto, entro quanti giorni va consumato (null = non cambia). */
  openDays: number | null;
  barcode?: string;
  /** Foto del prodotto da Open Food Facts (serve internet per vederla). */
  imageUrl?: string;
  /** Miniatura della foto scattata (data URL JPEG, circa 5 KB). */
  thumb?: string;
  source: ItemSource;
  addedAt: string;
  updatedAt: string;
  note?: string;
}

export type Outcome = 'consumato' | 'buttato';

/** Prodotto tolto dalla dispensa: serve per le statistiche anti-spreco. */
export interface HistoryEntry {
  id?: number;
  at: string;
  /** Giorno (AAAA-MM-GG). */
  date: string;
  name: string;
  emoji: string;
  location: Location;
  outcome: Outcome;
  /** Era già oltre la data quando è stato tolto. */
  wasExpired: boolean;
}

export interface ShoppingItem {
  id: string;
  name: string;
  emoji: string;
  /** Quantità o nota libera, es. "200 ml". */
  note: string;
  done: boolean;
  addedAt: string;
  /** Ordine nella lista (più piccolo = più in alto). */
  order: number;
}

/** Prodotto ricordato: per riaggiungerlo con un tocco e riconoscere subito il suo codice a barre. */
export interface Template {
  /** `b:<codice>` se ha il codice a barre, altrimenti `n:<nome normalizzato>`. */
  key: string;
  name: string;
  brand?: string;
  size?: string;
  emoji: string;
  location: Location;
  quantity: number;
  unit: Unit;
  expiryKind: ExpiryKind;
  /** Quanti giorni dura di solito da quando lo compri (null = non si sa o non scade). */
  shelfDays: number | null;
  openDays: number | null;
  barcode?: string;
  imageUrl?: string;
  thumb?: string;
  uses: number;
  lastUsed: string;
}

export interface UpdateState {
  lastCheck: string | null;
  latestVersion: string | null;
  apkUrl: string | null;
  pageUrl: string | null;
}

export interface Settings {
  onboarded: boolean;
  notify: {
    enabled: boolean;
    /** Ora dell'avviso giornaliero (0-23) e minuti. */
    hour: number;
    minute: number;
  };
  recipes: {
    servings: number;
    vegetarian: boolean;
    lactoseFree: boolean;
    glutenFree: boolean;
    /** Ingredienti che ci sono sempre in casa (non servono in dispensa). */
    staples: string[];
  };
  updates: UpdateState;
}
