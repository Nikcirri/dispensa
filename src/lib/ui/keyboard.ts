// Tasto Invio della tastiera del telefono.

/** Invio su un campo di testo senza modulo: chiude la tastiera (così si vede il resto della schermata). */
export function blurOnEnter(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.blur();
}
