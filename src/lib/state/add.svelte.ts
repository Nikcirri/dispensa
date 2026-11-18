// Scheda "Aggiungi": la modalità scelta (resta quando si cambia scheda) e lo scontrino fotografato in più parti.
import type { ProductDraft } from '../logic/drafts';
import { app } from './app.svelte';

export type AddMode = 'etichetta' | 'scontrino' | 'barcode' | 'multi';

export const addPref = $state({ mode: 'etichetta' as AddMode });

/** Scontrino lungo: i prodotti trovati con le foto di prima (con le modifiche fatte), in attesa della parte che manca. */
export const receipt = $state({
  pending: null as ProductDraft[] | null,
  store: '',
});

/** "Ho fatto la spesa": apre la fotocamera pronta per lo scontrino. */
export function startReceipt(): void {
  addPref.mode = 'scontrino';
  app.tab = 'aggiungi';
}

export function clearReceipt(): void {
  receipt.pending = null;
  receipt.store = '';
}
