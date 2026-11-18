// Casa condivisa: due o più telefoni vedono la stessa dispensa, la stessa lista della spesa e gli stessi pasti.
// Qui c'è solo la logica pura: configurazione di Firebase, inviti, confronto tra i dati del telefono e quelli della casa.
// Le ricette salvate, le statistiche, i prodotti ricordati e la chiave di Gemini restano solo sul telefono.

/** Le tabelle che si condividono. */
export const HOUSE_TABLES = ['items', 'shopping', 'meals'] as const;
export type HouseTable = (typeof HOUSE_TABLES)[number];

/** Quello che serve per collegarsi al progetto Firebase dell'utente (dati pubblici, non segreti). */
export interface FirebaseSettings {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/** La casa a cui è collegato il telefono (sta in `kv` `house`, mai nei backup). */
export interface HouseInfo {
  firebase: FirebaseSettings;
  houseId: string;
  /** Codice segreto dell'invito: serve per entrare nella casa. */
  code: string;
  /** Il nome con cui gli altri ti vedono (es. "Mamma"). */
  name: string;
}

export interface HouseMember {
  uid: string;
  name: string;
  /** Ultima volta che ha aperto l'app collegata alla casa (ms). */
  seenAt: number;
}

/** Un documento della casa: il record del telefono scritto come JSON, chi l'ha scritto e quando. */
export interface RemoteDoc {
  id: string;
  json: string;
  by: string;
  at: number;
}

// ---------- Configurazione di Firebase ----------

const API_KEY = /^AIza[0-9A-Za-z_-]{30,60}$/;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

function field(text: string, name: string): string {
  // Accetta sia lo snippet JavaScript della console (apiKey: "…") sia il JSON ("apiKey": "…").
  const m = new RegExp(`["']?${name}["']?\\s*[:=]\\s*["'\`]([^"'\`\\s]+)["'\`]`).exec(text);
  return m?.[1]?.trim() ?? '';
}

/** Legge la configurazione copiata dalla console di Firebase. null se manca qualcosa di essenziale. */
export function parseFirebaseConfig(text: string): FirebaseSettings | null {
  const apiKey = field(text, 'apiKey');
  const projectId = field(text, 'projectId');
  if (!API_KEY.test(apiKey) || !PROJECT_ID.test(projectId)) return null;
  const authDomain = field(text, 'authDomain') || `${projectId}.firebaseapp.com`;
  const appId = field(text, 'appId');
  return { apiKey, authDomain, projectId, appId };
}

/** Cosa non va nella configurazione incollata (stringa vuota se va bene). */
export function firebaseConfigProblem(text: string): string {
  if (!text.trim()) return '';
  const apiKey = field(text, 'apiKey');
  const projectId = field(text, 'projectId');
  if (!apiKey && !projectId) return 'Non trovo la configurazione: copia tutto il riquadro che inizia con “const firebaseConfig”.';
  if (!API_KEY.test(apiKey)) return 'Manca la riga apiKey (o è incompleta): ricopia tutto il riquadro.';
  if (!PROJECT_ID.test(projectId)) return 'Manca la riga projectId (o è incompleta): ricopia tutto il riquadro.';
  return '';
}

/** I progetti "demo-" di Firebase non esistono online: servono per provare l'app con l'emulatore. */
export function isEmulatorProject(projectId: string): boolean {
  return projectId.startsWith('demo-');
}

// ---------- Inviti ----------

const INVITE_PREFIX = 'DSP1.';
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Codice casuale (per l'id della casa e il codice dell'invito). */
export function randomCode(length: number, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(length);
  let out = '';
  for (const b of bytes) out += ID_CHARS[b % ID_CHARS.length];
  return out;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Il codice dell'invito: contiene la configurazione di Firebase, la casa e il codice segreto. */
export function makeInviteCode(info: Pick<HouseInfo, 'firebase' | 'houseId' | 'code'>): string {
  const f = info.firebase;
  return INVITE_PREFIX + toBase64Url(JSON.stringify({ k: f.apiKey, d: f.authDomain, p: f.projectId, a: f.appId, h: info.houseId, c: info.code }));
}

/** Legge un invito da qualsiasi testo (anche tutto il messaggio di WhatsApp). null se non c'è o è rovinato. */
export function readInvite(text: string): Pick<HouseInfo, 'firebase' | 'houseId' | 'code'> | null {
  const m = /DSP1\.([A-Za-z0-9_-]{40,})/.exec(text);
  if (!m?.[1]) return null;
  try {
    const v = JSON.parse(fromBase64Url(m[1])) as Record<string, unknown>;
    const s = (x: unknown) => (typeof x === 'string' ? x : '');
    const firebase = parseFirebaseConfig(JSON.stringify({ apiKey: s(v.k), projectId: s(v.p), authDomain: s(v.d), appId: s(v.a) }));
    const houseId = s(v.h);
    const code = s(v.c);
    if (!firebase || !/^[A-Za-z0-9]{12,40}$/.test(houseId) || !/^[A-Za-z0-9]{16,64}$/.test(code)) return null;
    return { firebase, houseId, code };
  } catch {
    return null;
  }
}

export const INSTALL_PAGE = 'https://github.com/Nikcirri/dispensa/releases/latest';

/** Il messaggio da mandare su WhatsApp (l'app legge il codice anche se si incolla tutto il messaggio). */
export function inviteMessage(inviteCode: string, fromName: string): string {
  const who = fromName.trim() || 'Qualcuno';
  return [
    `🏠 ${who} ti invita nella sua casa su Dispensa: dispensa, lista della spesa e pasti in comune.`,
    '',
    `1. Installa l'app Dispensa: ${INSTALL_PAGE}`,
    '2. Apri l’app → ⚙️ Impostazioni → Casa condivisa → Ho un invito',
    '3. Incolla tutto questo messaggio.',
    '',
    inviteCode,
  ].join('\n');
}

/** Nome da mostrare agli altri: corto e senza spazi strani. */
export function cleanMemberName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 30);
}

// ---------- Confronto dei dati ----------

/** JSON con le chiavi in ordine (lo stesso record dà sempre lo stesso testo); i valori undefined si tolgono. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Impronta corta di un testo (cyrb53): basta per capire se un record è cambiato. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function recordHash(record: unknown): string {
  return hashText(canonicalJson(record));
}

/**
 * Lo "stato condiviso": per ogni record (`tabella/id`) l'impronta dell'ultima versione uguale sul telefono e nella casa.
 * Serve per capire chi ha cambiato cosa: se il telefono è diverso dallo stato condiviso l'ha cambiato il telefono,
 * se la casa è diversa l'ha cambiato qualcun altro.
 */
export type Shadow = Record<string, string>;

export const shadowKey = (table: HouseTable, id: string) => `${table}/${id}`;

/** Record più grandi di così non si mandano (Firestore accetta al massimo 1 MiB per documento). */
export const MAX_DOC_CHARS = 900_000;

export interface PushPlan {
  puts: { table: HouseTable; id: string; json: string; hash: string }[];
  deletes: { table: HouseTable; id: string }[];
}

/** Cosa mandare alla casa: i record nuovi o cambiati sul telefono e quelli tolti dal telefono. */
export function planPush(table: HouseTable, local: readonly { id: string }[], shadow: Shadow): PushPlan {
  const plan: PushPlan = { puts: [], deletes: [] };
  const ids = new Set<string>();
  for (const rec of local) {
    ids.add(rec.id);
    const json = canonicalJson(rec);
    // Firestore non accetta documenti così grandi (non succede con le miniature normali, di pochi KB).
    if (json.length > MAX_DOC_CHARS) continue;
    const hash = hashText(json);
    if (shadow[shadowKey(table, rec.id)] !== hash) plan.puts.push({ table, id: rec.id, json, hash });
  }
  const prefix = `${table}/`;
  for (const key of Object.keys(shadow)) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (!ids.has(id)) plan.deletes.push({ table, id });
  }
  return plan;
}

export interface ApplyPlan<T> {
  /** Record da scrivere sul telefono (nuovi o cambiati da qualcun altro). */
  puts: { record: T; hash: string; by: string; isNew: boolean }[];
  /** Record da togliere dal telefono (tolti nella casa). */
  deletes: string[];
  /** Impronte da aggiornare nello stato condiviso. */
  shadowSet: Record<string, string>;
  shadowDelete: string[];
}

/**
 * Cosa fare con i documenti della casa appena arrivati.
 * - uguale al telefono: niente (si aggiorna solo lo stato condiviso);
 * - il telefono ha una modifica non ancora mandata: vince il telefono (la manda subito dopo);
 * - il telefono ha tolto il record e la modifica non è ancora partita: resta tolto;
 * - altrimenti si prende la versione della casa.
 * Con `authoritative` (elenco completo dal server, non dalla memoria) i record spariti dalla casa si tolgono anche dal telefono,
 * a meno che il telefono li abbia cambiati nel frattempo.
 */
export function planApply<T extends { id: string }>(
  table: HouseTable,
  remote: readonly RemoteDoc[],
  authoritative: boolean,
  local: readonly T[],
  shadow: Shadow,
  sanitize: (v: unknown) => T | null,
): ApplyPlan<T> {
  const plan: ApplyPlan<T> = { puts: [], deletes: [], shadowSet: {}, shadowDelete: [] };
  const localById = new Map(local.map((r) => [r.id, r]));
  const remoteIds = new Set<string>();
  for (const doc of remote) {
    remoteIds.add(doc.id);
    let record: T | null = null;
    try {
      record = sanitize({ ...(JSON.parse(doc.json) as object), id: doc.id });
    } catch {
      record = null;
    }
    if (!record) continue;
    const key = shadowKey(table, doc.id);
    const hash = recordHash(record);
    const mine = localById.get(doc.id);
    const mineHash = mine ? recordHash(mine) : null;
    const known = shadow[key];
    if (mineHash === hash) {
      if (known !== hash) plan.shadowSet[key] = hash;
      continue;
    }
    if (mine && mineHash !== known && known !== undefined) continue;
    if (!mine && known !== undefined) continue;
    plan.puts.push({ record, hash, by: doc.by, isNew: !mine });
    plan.shadowSet[key] = hash;
  }
  if (authoritative) {
    const prefix = `${table}/`;
    for (const [key, known] of Object.entries(shadow)) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (remoteIds.has(id)) continue;
      const mine = localById.get(id);
      if (!mine) plan.shadowDelete.push(key);
      else if (recordHash(mine) === known) {
        plan.deletes.push(id);
        plan.shadowDelete.push(key);
      }
    }
  }
  return plan;
}

// ---------- Avvisi delle modifiche degli altri ----------

export interface AppliedChange {
  table: HouseTable;
  added: { name: string; by: string }[];
  changed: number;
  removed: number;
}

const ADDED_TEXT: Record<HouseTable, [one: (n: string) => string, many: (k: number) => string]> = {
  shopping: [(n) => `ha aggiunto ${n} alla spesa`, (k) => `ha aggiunto ${k} cose alla spesa`],
  items: [(n) => `ha messo ${n} in dispensa`, (k) => `ha messo ${k} prodotti in dispensa`],
  meals: [(n) => `ha messo ${n} nel piano dei pasti`, (k) => `ha messo ${k} piatti nel piano dei pasti`],
};

const CHANGED_TEXT: Record<HouseTable, string> = {
  shopping: 'Lista della spesa aggiornata',
  items: 'Dispensa aggiornata',
  meals: 'Piano dei pasti aggiornato',
};

/** Il messaggio breve quando qualcun altro della casa cambia qualcosa (vuoto se non c'è niente da dire). */
export function changeSummary(changes: readonly AppliedChange[], names: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  for (const c of changes) {
    const byOthers = c.added;
    if (byOthers.length) {
      const authors = [...new Set(byOthers.map((a) => a.by))];
      const who = authors.length === 1 ? names.get(authors[0]!) || 'Qualcuno della casa' : 'Qualcuno della casa';
      const [one, many] = ADDED_TEXT[c.table];
      parts.push(`${who} ${byOthers.length === 1 ? one(byOthers[0]!.name) : many(byOthers.length)}`);
    } else if (c.changed || c.removed) {
      parts.push(CHANGED_TEXT[c.table]);
    }
  }
  return parts.length ? `🏠 ${parts.join(' · ')}` : '';
}

// ---------- Errori ----------

/** Testo semplice per gli errori di Firebase. `joining`: si stava entrando con un invito. */
export function houseErrorText(e: unknown, joining = false): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  const msg = e instanceof Error ? e.message : String(e);
  if (/operation-not-allowed|admin-restricted-operation/.test(code)) {
    return 'In Firebase l’accesso “Anonimo” non è attivo: aprilo in Authentication → Metodo di accesso e attivalo (passo 4).';
  }
  if (/api-key-not-valid|invalid-api-key/.test(code) || /API key not valid/i.test(msg)) {
    return 'La configurazione di Firebase non è giusta: ricopiala da Impostazioni progetto → Le tue app.';
  }
  if (/network-request-failed|unavailable|deadline-exceeded/.test(code) || /timeout|offline|network/i.test(msg)) {
    return 'Non riesco a raggiungere Firebase: controlla internet e riprova.';
  }
  if (/does not exist|NOT_FOUND/i.test(msg) || code === 'not-found') {
    return 'Nel progetto Firebase manca il database: crea “Firestore Database” (passo 2).';
  }
  if (code === 'permission-denied' || /permission/i.test(msg)) {
    return joining
      ? 'Invito non valido o casa non trovata: chiedi un invito nuovo.'
      : 'Firebase non dà il permesso: controlla di aver pubblicato le regole (passo 3), oppure non fai più parte di questa casa.';
  }
  return `Qualcosa non va con Firebase${code ? ` (${code})` : ''}. Riprova tra poco.`;
}
