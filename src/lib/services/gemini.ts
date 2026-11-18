// Richieste a Google Gemini (chiave personale dell'utente, presa da Google AI Studio).
// Stesso metodo dell'app Nutrizione (fino alla 0.9.9): prima il fetch della WebView, di riserva
// CapacitorHttp; più modelli "a scaglioni" (parte il migliore, se tarda si avvia anche il successivo);
// pause sui limiti gratuiti; modelli nuovi presi da soli dall'elenco di Google.
import { CapacitorHttp } from '@capacitor/core';
import { db } from '../db';
import { UserError } from '../errors';
import {
  chooseModels,
  describeAttempts,
  finishNote,
  geminiProblem,
  geminiText,
  isLiteId,
  isPaidOnly,
  isTimeoutError,
  LATEST_ALIASES,
  OVERALL_MS,
  PAID_RECHECK_MS,
  pauseUntil,
  problemMessage,
  raceStep,
  rankModels,
  RETRY_MIN_LEFT_MS,
  SLOW_FOR_MS,
  thinkingLevelFor,
  wasSlow,
  type AiAttempt,
  type AiProgress,
  type AttemptOutcome,
  type GeminiProblem,
  type ListedModel,
  type ModelCandidate,
  type ModelPauses,
  type RaceKind,
  type SlowModels,
} from '../logic/gemini';
import { isNative } from '../platform';
import { getModelPauses, setModelPauses } from '../repo';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
/**
 * Riserva se l'elenco dei modelli di Google non arriva (dal migliore al più leggero). Di solito i modelli
 * arrivano dall'elenco di Google (vedi `modelsFor`): quando Google ne pubblica uno nuovo l'app lo usa da sola.
 */
const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
/** Modelli scelti dall'elenco di Google, riletto una volta al giorno. */
const MODELS_KEY = 'aiModels';
const MODELS_REFRESH_MS = 24 * 60 * 60 * 1000;
/** Cambia quando cambia il modo di scegliere: le scelte salvate prima si rifanno. */
const MODELS_FORMAT = 2;
/** Quanti modelli tenere di riserva (oltre a quelli della gara) per quando i primi finiscono il limite. */
const KEEP_MAIN = 4;
const KEEP_LITE = 2;
/** Dopo un blocco della richiesta completa, per un giorno si usa subito quella leggera. */
const LIGHT_KEY = 'aiLightUntil';
const LIGHT_FOR_MS = 24 * 60 * 60 * 1000;
/** Modelli lenti (vedi `SlowModels`): con le foto e con il solo testo (ricette) si tengono separati. */
const SLOW_KEY = 'aiSlowWithPhoto';
const SLOW_TEXT_KEY = 'aiSlowText';
const SEED = 20261115;

/** Esito della prova di un modello con la chiave dell'utente: gratuito o no. */
interface FreeCheck {
  free: boolean;
  at: number;
}

export interface ModelInfo {
  /** Dal migliore al più leggero, senza quelli non gratuiti. */
  models: string[];
  /** Quali sono della famiglia leggera (Flash-Lite). */
  lite: string[];
  /** Non gratuiti con questa chiave (non usati). */
  paid: string[];
  /** Vero se arrivano dall'elenco di Google; falso se è l'elenco scritto nell'app. */
  fromList: boolean;
  at: number;
  checks: Record<string, FreeCheck>;
  format: number;
}

class NetProblem extends Error {
  constructor(readonly kind: 'timeout' | 'network') {
    super(kind);
  }
}

interface HttpResult {
  status: number;
  data: unknown;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function viaFetch(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<HttpResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const stop = () => ctrl.abort();
  signal?.addEventListener('abort', stop);
  try {
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    return { status: res.status, data: safeJson(await res.text()) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

async function request(method: 'GET' | 'POST', url: string, key: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<HttpResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new UserError('Sei offline: collegati a internet e riprova.');
  }
  const headers: Record<string, string> = { 'x-goog-api-key': key, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Prima il fetch della WebView (Gemini accetta richieste dal browser): con una foto il ponte nativo di
  // CapacitorHttp era lentissimo. Il ponte resta di riserva.
  try {
    return await viaFetch(method, url, headers, body, timeoutMs, signal);
  } catch (e) {
    if (e instanceof UserError) throw e;
    if (isTimeoutError(e) || !isNative() || signal?.aborted) throw new NetProblem(isTimeoutError(e) ? 'timeout' : 'network');
  }
  try {
    const res = await CapacitorHttp.request({ method, url, headers, data: body, connectTimeout: 15_000, readTimeout: timeoutMs, responseType: 'json' });
    return { status: res.status, data: typeof res.data === 'string' ? safeJson(res.data) : res.data };
  } catch (e) {
    throw new NetProblem(isTimeoutError(e) ? 'timeout' : 'network');
  }
}

// ---------- Modelli: scelti da soli dall'elenco di Google ----------

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((m) => typeof m === 'string');

async function savedModelInfo(): Promise<ModelInfo | null> {
  const v = (await db.kv.get(MODELS_KEY).catch(() => undefined))?.value as Partial<ModelInfo> | undefined;
  if (!v || v.format !== MODELS_FORMAT || !isStrings(v.models) || !v.models.length || !isStrings(v.lite) || !isStrings(v.paid)) return null;
  if (typeof v.at !== 'number' || typeof v.checks !== 'object' || v.checks === null) return null;
  return { models: v.models, lite: v.lite, paid: v.paid, fromList: v.fromList === true, at: v.at, checks: v.checks, format: MODELS_FORMAT };
}

/**
 * Prova minuscola per sapere se un modello è gratuito con questa chiave: vero se risponde, falso se Google
 * dice che non è nel livello gratuito (limite 0, non consuma niente), null se non si capisce (limite del
 * giorno finito, rete, errore): in quel caso lo si tiene e lo si riprova un'altra volta.
 */
async function isFreeModel(key: string, model: string): Promise<boolean | null> {
  try {
    const res = await request(
      'POST',
      `${BASE}/models/${model}:generateContent`,
      key,
      { contents: [{ role: 'user', parts: [{ text: 'Rispondi solo: ok' }] }], generationConfig: { maxOutputTokens: 32 } },
      15_000,
    );
    if (res.status >= 200 && res.status < 300) return true;
    if (res.status === 429 && isPaidOnly(res.data)) return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Prova i modelli nuovi dal migliore, solo finché ne servono (2 normali e 1 leggero gratuiti): costa al
 * massimo una richiesta per ogni modello nuovo, una volta sola. Quelli non gratuiti si riprovano dopo un mese.
 */
async function checkNewModels(key: string, candidates: readonly ModelCandidate[], checks: Record<string, FreeCheck>): Promise<void> {
  const now = Date.now();
  for (const [lite, want] of [
    [false, 2],
    [true, 1],
  ] as const) {
    let usable = 0;
    for (const c of candidates.filter((m) => m.lite === lite)) {
      if (usable >= want) break;
      const known = checks[c.id];
      if (!known || (!known.free && now - known.at >= PAID_RECHECK_MS)) {
        const free = await isFreeModel(key, c.id);
        if (free !== null) checks[c.id] = { free, at: now };
      }
      if (checks[c.id]?.free !== false) usable++;
    }
  }
}

let loading: Promise<ModelInfo> | null = null;

/**
 * I modelli da usare. Una volta al giorno (o subito se un modello è sparito) si chiede a Google l'elenco
 * dei modelli: funziona anche con la chiave gratuita e non consuma il limite. Si scelgono per numero di
 * versione, non per nome, così arrivano da soli anche i modelli con nomi nuovi ("4 Hydrogen"); i nuovi si
 * provano una volta per sapere se sono gratuiti. Se l'elenco non arriva si tiene quello dell'ultima volta,
 * altrimenti quelli scritti nell'app più i nomi "sempre aggiornati" di Google.
 */
export function modelsFor(key: string, force = false): Promise<ModelInfo> {
  loading ??= loadModels(key, force).finally(() => (loading = null));
  return loading;
}

async function loadModels(key: string, force: boolean): Promise<ModelInfo> {
  const saved = await savedModelInfo();
  if (saved && !force && Date.now() - saved.at < MODELS_REFRESH_MS) return saved;
  let listed: ListedModel[] | null = null;
  try {
    const res = await request('GET', `${BASE}/models?pageSize=1000`, key, undefined, 15_000);
    const models = (res.data as { models?: unknown } | null)?.models;
    if (res.status >= 200 && res.status < 300 && Array.isArray(models)) listed = models as ListedModel[];
  } catch {
    listed = null;
  }
  if (!listed && saved) return saved;
  const ranked = listed ? rankModels(listed) : [];
  const checks: Record<string, FreeCheck> = {};
  for (const c of ranked) if (saved?.checks[c.id]) checks[c.id] = saved.checks[c.id]!;
  if (ranked.length) await checkNewModels(key, ranked, checks);
  const paid = ranked.filter((c) => checks[c.id]?.free === false).map((c) => c.id);
  const usable = ranked.filter((c) => !paid.includes(c.id));
  const fromList = usable.length > 0;
  const chosen: ModelCandidate[] = fromList
    ? [...usable.filter((c) => !c.lite).slice(0, KEEP_MAIN), ...usable.filter((c) => c.lite).slice(0, KEEP_LITE)]
    : [...MODELS, ...LATEST_ALIASES].map((id) => ({ id, lite: isLiteId(id) }));
  const info: ModelInfo = {
    models: chosen.map((c) => c.id),
    lite: chosen.filter((c) => c.lite).map((c) => c.id),
    paid,
    fromList,
    at: Date.now(),
    checks,
    format: MODELS_FORMAT,
  };
  await db.kv.put({ key: MODELS_KEY, value: info }).catch(() => undefined);
  return info;
}

/** I modelli che userebbe adesso una richiesta (senza quelli in pausa) e quelli non gratuiti: per le Impostazioni. */
export async function modelsInUse(key: string): Promise<{ models: string[]; paid: string[]; fromList: boolean }> {
  const info = await modelsFor(key);
  const pauses: ModelPauses = await getModelPauses(db).catch(() => ({}));
  return { models: chooseModels(info.models, info.lite, pauses, Date.now()), paid: info.paid, fromList: info.fromList };
}

/** Un modello è sparito: alla prossima richiesta si rilegge l'elenco (tenendo le prove già fatte). */
async function expireModels(): Promise<void> {
  const saved = await savedModelInfo();
  if (saved) await db.kv.put({ key: MODELS_KEY, value: { ...saved, at: 0 } }).catch(() => undefined);
}

// ---------- Richiesta ----------

type Mode = 'full' | 'light' | 'bare';

interface Image {
  base64: string;
  mime: string;
}

/**
 * - `full`: risposta con forma imposta (schema) e ragionamento indicato: la più precisa;
 * - `light`: senza schema (a volte lo schema fa bloccare Gemini);
 * - `bare`: né schema né ragionamento (per i modelli che rifiutano le impostazioni).
 */
function body(prompt: string, image: Image | null, mode: Mode, model: string, schema: object): unknown {
  const parts: unknown[] = [];
  if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.base64 } });
  parts.push({ text: prompt });
  const generationConfig: Record<string, unknown> = { responseMimeType: 'application/json', seed: SEED };
  if (mode !== 'bare') generationConfig.thinkingConfig = { thinkingLevel: thinkingLevelFor(model) };
  if (mode === 'full') generationConfig.responseJsonSchema = schema;
  return { contents: [{ role: 'user', parts }], generationConfig };
}

async function lightPreferred(): Promise<boolean> {
  const row = await db.kv.get(LIGHT_KEY).catch(() => undefined);
  return typeof row?.value === 'number' && row.value > Date.now();
}

function preferLight(): void {
  void db.kv.put({ key: LIGHT_KEY, value: Date.now() + LIGHT_FOR_MS }).catch(() => undefined);
}

async function getSlowModels(key: string): Promise<SlowModels> {
  const v = (await db.kv.get(key).catch(() => undefined))?.value;
  const out: SlowModels = {};
  if (typeof v === 'object' && v !== null) {
    for (const [k, until] of Object.entries(v as Record<string, unknown>)) if (typeof until === 'number' && until > Date.now()) out[k] = until;
  }
  return out;
}

function saveSlowModels(key: string, slow: SlowModels): void {
  void db.kv.put({ key, value: slow }).catch(() => undefined);
}

/** Errore dell'IA con, in più, una riga tecnica breve su cosa è successo con ogni modello. */
export class AiError extends UserError {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

export interface GeminiTask<T> {
  prompt: string;
  image: Image | null;
  schema: object;
  /** Legge il testo della risposta (null = non si capisce). */
  parse: (text: string) => T | null;
  /** Vero se la risposta è valida ma vuota (es. nessun prodotto riconosciuto): si prova il modello successivo. */
  isEmpty: (value: T) => boolean;
  /** Tempo massimo per una richiesta "completa" (di solito 30 s; le ricette scrivono di più). */
  fullTimeoutMs?: number;
  /** Tempo massimo per le altre richieste. */
  timeoutMs?: number;
  /** Tempo massimo di tutto. */
  overallMs?: number;
  /** Dopo quanto, senza risposta, avviare anche il modello successivo. */
  staggerMs?: number;
  /** Oltre quando non si aspetta più un modello migliore se uno più leggero ha già risposto. */
  graceEndMs?: number;
  /** Chiamata più volte al secondo con lo stato dei modelli (per mostrare cosa sta facendo l'IA). */
  onProgress?: (p: AiProgress) => void;
}

export interface GeminiResult<T> {
  value: T;
  model: string;
  /** Riga tecnica sui tentativi (vuota se il primo modello ha risposto subito). */
  detail: string;
  /** Secondi dall'inizio della richiesta. */
  seconds: number;
}

type ModelResult<T> = (
  | { kind: 'ok' | 'empty'; value: T; outcome: AttemptOutcome }
  | { kind: 'fail' | 'stop'; outcome: AttemptOutcome; problem: GeminiProblem; unreadable?: boolean }
) & { note?: string };

/** Chiede a Gemini, dal modello migliore disponibile in giù. Lancia AiError se nessuno risponde. */
export async function runGemini<T>(key: string, task: GeminiTask<T>): Promise<GeminiResult<T>> {
  const fullTimeout = task.fullTimeoutMs ?? 30_000;
  const otherTimeout = task.timeoutMs ?? 45_000;
  const overall = task.overallMs ?? OVERALL_MS;
  const pauses: ModelPauses = await getModelPauses(db).catch(() => ({}));
  const info = await modelsFor(key);
  const models = chooseModels(info.models, info.lite, pauses, Date.now());
  const slowKey = task.image ? SLOW_KEY : SLOW_TEXT_KEY;
  const slow = await getSlowModels(slowKey);
  const mode: Mode = (await lightPreferred()) ? 'light' : 'full';
  const savePauses = () => void setModelPauses(db, pauses).catch(() => undefined);
  const t0 = Date.now();
  const deadline = t0 + overall;

  async function runModel(model: string, signal: AbortSignal): Promise<ModelResult<T>> {
    const url = `${BASE}/models/${model}:generateContent`;
    const limit = () => Math.max(1000, Math.min(mode === 'full' ? fullTimeout : otherTimeout, deadline - Date.now()));
    let res: HttpResult;
    const notes: string[] = [];
    try {
      let used: Mode = mode;
      res = await request('POST', url, key, body(task.prompt, task.image, used, model, task.schema), limit(), signal);
      // Il modello non accetta qualche impostazione (errore 400): si toglie prima la forma imposta della
      // risposta e solo dopo il ragionamento. Senza ragionamento indicato i modelli nuovi ragionano "alto",
      // che è lentissimo: per questo non si salta subito al formato più semplice.
      for (const simpler of mode === 'full' ? (['light', 'bare'] as const) : mode === 'light' ? (['bare'] as const) : []) {
        if (!(res.status === 400 && geminiProblem(res.status, res.data) === 'other') || signal.aborted) break;
        used = simpler;
        res = await request('POST', url, key, body(task.prompt, task.image, used, model, task.schema), limit(), signal);
      }
      if (used !== mode) notes.push(used === 'bare' ? 'formato semplice' : 'senza schema');
      // Errore momentaneo dei server di Google (500, 503 "sovraccarico"): si riprova una volta lo stesso modello.
      if (res.status >= 500 && deadline - Date.now() > 10_000 && !signal.aborted) {
        notes.push(`riprovato dopo errore ${res.status}`);
        await new Promise((r) => setTimeout(r, 1500));
        res = await request('POST', url, key, body(task.prompt, task.image, used, model, task.schema), limit(), signal);
      }
    } catch (e) {
      if (!(e instanceof NetProblem)) throw e;
      // Il formato completo a volte fa bloccare Gemini: per un giorno si chiede in modo leggero.
      if (e.kind === 'timeout' && mode === 'full' && !signal.aborted) preferLight();
      const note = notes.join(', ') || undefined;
      return e.kind === 'network'
        ? { kind: 'stop', outcome: 'network', problem: 'network', note }
        : { kind: 'fail', outcome: 'timeout', problem: 'timeout', note };
    }
    if (res.status < 200 || res.status >= 300) {
      const problem = geminiProblem(res.status, res.data);
      const until = pauseUntil(res.status, res.data, Date.now());
      if (until !== null) {
        pauses[model] = until;
        savePauses();
      }
      const outcome: AttemptOutcome = problem === 'quota' ? (isPaidOnly(res.data) ? 'paid' : 'quota') : problem === 'model' ? 'model' : 'error';
      // Chiave sbagliata, zona non servita, contenuto bloccato: inutile provare altri modelli.
      const stop = problem === 'key' || problem === 'region' || problem === 'blocked';
      if (outcome === 'error' && !notes.some((n) => n.includes(String(res.status)))) notes.push(String(res.status));
      return { kind: stop ? 'stop' : 'fail', outcome, problem, note: notes.join(', ') || undefined };
    }
    if (pauses[model]) {
      delete pauses[model];
      savePauses();
    }
    const finish = finishNote(res.data);
    if (finish) notes.push(finish);
    const note = notes.join(', ') || undefined;
    const text = geminiText(res.data);
    if (!text && geminiProblem(res.status, res.data) === 'blocked') return { kind: 'stop', outcome: 'error', problem: 'blocked', note };
    const value = task.parse(text);
    if (value === null) return { kind: 'fail', outcome: 'unreadable', problem: 'other', unreadable: true, note };
    if (task.isEmpty(value)) return { kind: 'empty', value, outcome: 'empty', note };
    return { kind: 'ok', value, outcome: 'ok', note };
  }

  // Gara a scaglioni (regole in `raceStep`): si parte dal migliore e, se tarda, si avvia anche il successivo.
  const runs: { model: string; ctrl: AbortController; result: ModelResult<T> | null; startedAt: number; doneAt: number }[] = [];
  const queue = [...models];
  let retried = false;
  let firstOkAt: number | null = null;
  let wake: () => void = () => undefined;
  const start = () => {
    const model = queue[runs.length]!;
    const run = { model, ctrl: new AbortController(), result: null as ModelResult<T> | null, startedAt: Date.now(), doneAt: 0 };
    runs.push(run);
    void runModel(model, run.ctrl.signal)
      .catch((e: unknown): ModelResult<T> => ({ kind: 'stop', outcome: 'error', problem: e instanceof UserError ? 'network' : 'other' }))
      .then((r) => {
        run.result = r;
        run.doneAt = Date.now();
        if (r.kind === 'ok' && firstOkAt === null) firstOkAt = Date.now();
        wake();
      });
  };

  const emit = () => {
    if (!task.onProgress) return;
    const now = Date.now();
    task.onProgress({
      attempts: runs.map((r) => ({
        model: r.model,
        status: r.result ? r.result.outcome : 'running',
        seconds: Math.round(((r.result ? r.doneAt : now) - r.startedAt) / 1000),
        ...(r.result?.note ? { note: r.result.note } : {}),
      })),
      seconds: Math.round((now - t0) / 1000),
    });
  };
  emit();

  let outcome: { type: 'use' | 'stop'; index: number } | { type: 'finish' };
  for (;;) {
    emit();
    const now = Date.now();
    const last = runs[runs.length - 1];
    const step = raceStep({
      results: runs.map((r): RaceKind | null => r.result?.kind ?? null),
      total: queue.length,
      lastIsSlow: last !== undefined && last.model in slow,
      sinceLastStart: last ? now - last.startedAt : 0,
      sinceFirstOk: firstOkAt === null ? null : now - firstOkAt,
      elapsed: now - t0,
      overallMs: overall,
      staggerMs: task.staggerMs,
      graceEndMs: task.graceEndMs,
    });
    if (step.type === 'start') {
      start();
      continue;
    }
    if (step.type === 'wait') {
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 500);
      });
      continue;
    }
    // Tutti senza risposta in tempo e resta abbastanza tempo: un secondo tentativo con il modello più leggero.
    if (step.type === 'finish' && !retried && queue.length && now - t0 <= overall - RETRY_MIN_LEFT_MS && runs.some((r) => r.result?.outcome === 'timeout')) {
      retried = true;
      queue.push(queue[queue.length - 1]!);
      continue;
    }
    outcome = step;
    break;
  }

  // Le richieste ancora in corso non servono più.
  for (const r of runs) if (!r.result) r.ctrl.abort();
  // Un modello è sparito (Google l'ha spento): la prossima volta si rilegge subito l'elenco.
  if (runs.some((r) => r.result?.outcome === 'model')) void expireModels().catch(() => undefined);

  // Chi non ha risposto per almeno 20 s parte senza vantaggio per un giorno (foto e testo tenuti separati);
  // chi ha risposto bene lo riprende.
  let changed = false;
  for (const r of runs) {
    if (wasSlow(r.result?.outcome ?? null, (r.result ? r.doneAt : Date.now()) - r.startedAt)) {
      slow[r.model] = Date.now() + SLOW_FOR_MS;
      changed = true;
    } else if (r.result?.kind === 'ok' && r.model in slow) {
      delete slow[r.model];
      changed = true;
    }
  }
  if (changed) saveSlowModels(slowKey, slow);

  const stoppedAt = Date.now();
  const attempts: AiAttempt[] = runs.map((r) => ({
    model: r.model,
    outcome: r.result?.outcome ?? (outcome.type === 'use' ? 'slower' : 'timeout'),
    // Anche per chi è stato fermato: quanto lo si è aspettato.
    seconds: Math.round(((r.result ? r.doneAt : stoppedAt) - t0) / 1000),
    ...(r.result?.note ? { note: r.result.note } : {}),
  }));
  const detail = describeAttempts(attempts);
  const seconds = Math.round((stoppedAt - t0) / 1000);
  if (outcome.type === 'use') {
    const r = runs[outcome.index]!.result as { value: T };
    return { value: r.value, model: runs[outcome.index]!.model, detail: attempts.length > 1 ? detail : '', seconds };
  }
  if (outcome.type === 'stop') {
    const r = runs[outcome.index]!.result as { problem: GeminiProblem };
    throw new AiError(problemMessage(r.problem), detail);
  }
  const empty = runs.find((r) => r.result?.kind === 'empty');
  if (empty?.result && 'value' in empty.result) return { value: empty.result.value, model: empty.model, detail, seconds };
  const results = runs.map((r) => r.result);
  if (results.some((r) => r && 'unreadable' in r && r.unreadable)) {
    throw new AiError('Gemini ha risposto in modo incompleto. Riprova: di solito la seconda volta va.', detail);
  }
  const problems = results.map((r) => (r && 'problem' in r ? r.problem : 'timeout'));
  const lastProblem: GeminiProblem = problems.includes('timeout') ? 'timeout' : (problems[problems.length - 1] ?? 'other');
  throw new AiError(problemMessage(lastProblem), detail);
}

export type KeyCheck = 'ok' | 'invalid' | 'error';

/** Controlla che la chiave funzioni con una richiesta minuscola al modello più leggero. */
export async function checkKey(key: string): Promise<KeyCheck> {
  const model = MODELS[MODELS.length - 1];
  let res: HttpResult;
  try {
    res = await request(
      'POST',
      `${BASE}/models/${model}:generateContent`,
      key,
      { contents: [{ role: 'user', parts: [{ text: 'Rispondi solo: ok' }] }], generationConfig: { maxOutputTokens: 5 } },
      30_000,
    );
  } catch (e) {
    if (e instanceof NetProblem) throw new UserError(problemMessage(e.kind));
    throw e;
  }
  if (res.status >= 200 && res.status < 300) return 'ok';
  const problem = geminiProblem(res.status, res.data);
  if (problem === 'key') return 'invalid';
  if (problem === 'region') throw new UserError(problemMessage('region'));
  // Limite raggiunto o modello non disponibile: la chiave in sé va bene.
  return problem === 'quota' ? 'ok' : 'error';
}
