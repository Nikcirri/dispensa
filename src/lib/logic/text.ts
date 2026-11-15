// Piccole funzioni sui testi.

/** Minuscolo, senza accenti e spazi doppi: per cercare e confrontare i nomi. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Prima lettera maiuscola. */
export function capitalize(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Vero se tutte le parole cercate sono nel testo (in qualsiasi ordine). */
export function matchesQuery(text: string, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const t = normalize(text);
  return q.split(' ').every((w) => t.includes(w));
}

/** "Latte, Yogurt e Uova". */
export function joinNames(names: readonly string[], max = 3): string {
  const list = names.slice(0, max);
  const rest = names.length - list.length;
  if (rest > 0) return `${list.join(', ')} e altri ${rest}`;
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`;
}

/** Identificativo casuale. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Plurale semplice: "1 prodotto", "3 prodotti". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
