// Richieste a Google Gemini (chiave personale dell'utente, presa da Google AI Studio).
// Stesso metodo dell'app Nutrizione: prima il fetch della WebView, di riserva CapacitorHttp; più modelli
// "a scaglioni" (parte il migliore, se tarda si avvia anche il successivo); pause sui limiti gratuiti.
import { CapacitorHttp } from '@capacitor/core';
import { db } from '../db';
import { UserError } from '../errors';
import {
  describeAttempts,
  geminiProblem,
  geminiText,
  isTimeoutError,
  LATEST_ALIASES,
  modelsToTry,
  OVERALL_MS,
  pauseUntil,
  pickModels,
  problemMessage,
  raceStep,
  RETRY_MIN_LEFT_MS,
  SLOW_FOR_MS,
  thinkingLevelFor,
  wasSlow,
  type AiAttempt,
  type AttemptOutcome,
  type GeminiProblem,
  type ListedModel,
  type ModelPauses,
  type RaceKind,
  type SlowModels,
} from '../logic/gemini';
import { isNative } from '../platform';
import { getModelPauses, setModelPauses } from '../repo';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Riserva se l'elenco dei modelli di Google non arriva (dal migliore al più leggero). */
const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const MODELS_KEY = 'aiModels';
const MODELS_REFRESH_MS = 24 * 60 * 60 * 1000;
const LIGHT_KEY = 'aiLightUntil';
const LIGHT_FOR_MS = 24 * 60 * 60 * 1000;
const SLOW_KEY = 'aiSlowWithPhoto';
const SEED = 20261115;

export interface ModelInfo {
  models: string[];
  fromList: boolean;
  at: number;
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

async function savedModelInfo(): Promise<ModelInfo | null> {
  const v = (await db.kv.get(MODELS_KEY).catch(() => undefined))?.value as Partial<ModelInfo> | undefined;
  if (!v || !Array.isArray(v.models) || !v.models.every((m) => typeof m === 'string') || !v.models.length || typeof v.at !== 'number') return null;
  return { models: v.models, fromList: v.fromList === true, at: v.at };
}

/** I modelli da usare: elenco di Google riletto una volta al giorno (i modelli nuovi arrivano da soli). */
export async function modelsFor(key: string, force = false): Promise<ModelInfo> {
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
  const fromList = listed !== null && pickModels(listed, []).length > 0;
  const info: ModelInfo = { models: fromList ? pickModels(listed, MODELS) : [...MODELS, ...LATEST_ALIASES], fromList, at: Date.now() };
  await db.kv.put({ key: MODELS_KEY, value: info }).catch(() => undefined);
  return info;
}

type Mode = 'full' | 'light' | 'bare';

interface Image {
  base64: string;
  mime: string;
}

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

async function getSlowModels(): Promise<SlowModels> {
  const v = (await db.kv.get(SLOW_KEY).catch(() => undefined))?.value;
  const out: SlowModels = {};
  if (typeof v === 'object' && v !== null) {
    for (const [k, until] of Object.entries(v as Record<string, unknown>)) if (typeof until === 'number' && until > Date.now()) out[k] = until;
  }
  return out;
}

function saveSlowModels(slow: SlowModels): void {
  void db.kv.put({ key: SLOW_KEY, value: slow }).catch(() => undefined);
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
}

export interface GeminiResult<T> {
  value: T;
  model: string;
  /** Riga tecnica sui tentativi (vuota se il primo modello ha risposto subito). */
  detail: string;
}

type ModelResult<T> =
  | { kind: 'ok' | 'empty'; value: T; outcome: AttemptOutcome }
  | { kind: 'fail' | 'stop'; outcome: AttemptOutcome; problem: GeminiProblem; unreadable?: boolean };

/** Chiede a Gemini, dal modello migliore disponibile in giù. Lancia AiError se nessuno risponde. */
export async function runGemini<T>(key: string, task: GeminiTask<T>): Promise<GeminiResult<T>> {
  const fullTimeout = task.fullTimeoutMs ?? 30_000;
  const otherTimeout = task.timeoutMs ?? 45_000;
  const overall = task.overallMs ?? OVERALL_MS;
  const pauses: ModelPauses = await getModelPauses(db).catch(() => ({}));
  const models = modelsToTry((await modelsFor(key)).models, pauses, Date.now());
  const slow = task.image ? await getSlowModels() : {};
  const mode: Mode = (await lightPreferred()) ? 'light' : 'full';
  const savePauses = () => void setModelPauses(db, pauses).catch(() => undefined);
  const t0 = Date.now();
  const deadline = t0 + overall;

  async function runModel(model: string, signal: AbortSignal): Promise<ModelResult<T>> {
    const url = `${BASE}/models/${model}:generateContent`;
    const limit = () => Math.max(1000, Math.min(mode === 'full' ? fullTimeout : otherTimeout, deadline - Date.now()));
    let res: HttpResult;
    try {
      res = await request('POST', url, key, body(task.prompt, task.image, mode, model, task.schema), limit(), signal);
      if (res.status === 400 && geminiProblem(res.status, res.data) === 'other') {
        res = await request('POST', url, key, body(task.prompt, task.image, 'bare', model, task.schema), limit(), signal);
      }
      if (res.status >= 500 && deadline - Date.now() > 10_000 && !signal.aborted) {
        await new Promise((r) => setTimeout(r, 1500));
        res = await request('POST', url, key, body(task.prompt, task.image, mode, model, task.schema), limit(), signal);
      }
    } catch (e) {
      if (!(e instanceof NetProblem)) throw e;
      if (e.kind === 'timeout' && mode === 'full' && !signal.aborted) preferLight();
      return e.kind === 'network' ? { kind: 'stop', outcome: 'network', problem: 'network' } : { kind: 'fail', outcome: 'timeout', problem: 'timeout' };
    }
    if (res.status < 200 || res.status >= 300) {
      const problem = geminiProblem(res.status, res.data);
      const until = pauseUntil(res.status, res.data, Date.now());
      if (until !== null) {
        pauses[model] = until;
        savePauses();
      }
      const outcome: AttemptOutcome = problem === 'quota' ? 'quota' : problem === 'model' ? 'model' : 'error';
      const stop = problem === 'key' || problem === 'region' || problem === 'blocked';
      return { kind: stop ? 'stop' : 'fail', outcome, problem };
    }
    if (pauses[model]) {
      delete pauses[model];
      savePauses();
    }
    const text = geminiText(res.data);
    if (!text && geminiProblem(res.status, res.data) === 'blocked') return { kind: 'stop', outcome: 'error', problem: 'blocked' };
    const value = task.parse(text);
    if (value === null) return { kind: 'fail', outcome: 'unreadable', problem: 'other', unreadable: true };
    if (task.isEmpty(value)) return { kind: 'empty', value, outcome: 'empty' };
    return { kind: 'ok', value, outcome: 'ok' };
  }

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

  let outcome: { type: 'use' | 'stop'; index: number } | { type: 'finish' };
  for (;;) {
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
    if (step.type === 'finish' && !retried && queue.length && now - t0 <= overall - RETRY_MIN_LEFT_MS && runs.some((r) => r.result?.outcome === 'timeout')) {
      retried = true;
      queue.push(queue[queue.length - 1]!);
      continue;
    }
    outcome = step;
    break;
  }

  for (const r of runs) if (!r.result) r.ctrl.abort();
  if (runs.some((r) => r.result?.outcome === 'model')) void db.kv.delete(MODELS_KEY).catch(() => undefined);

  if (task.image) {
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
    if (changed) saveSlowModels(slow);
  }

  const attempts: AiAttempt[] = runs.map((r) => ({
    model: r.model,
    outcome: r.result?.outcome ?? (outcome.type === 'use' ? 'slower' : 'timeout'),
    ...(r.result ? { seconds: Math.round((r.doneAt - t0) / 1000) } : {}),
  }));
  const detail = describeAttempts(attempts);
  if (outcome.type === 'use') {
    const r = runs[outcome.index]!.result as { value: T };
    return { value: r.value, model: runs[outcome.index]!.model, detail: attempts.length > 1 ? detail : '' };
  }
  if (outcome.type === 'stop') {
    const r = runs[outcome.index]!.result as { problem: GeminiProblem };
    throw new AiError(problemMessage(r.problem), detail);
  }
  const empty = runs.find((r) => r.result?.kind === 'empty');
  if (empty?.result && 'value' in empty.result) return { value: empty.result.value, model: empty.model, detail };
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
  return problem === 'quota' ? 'ok' : 'error';
}
