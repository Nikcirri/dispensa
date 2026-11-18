// Google Gemini (chiave personale dell'utente): scelta dei modelli, gara tra modelli, errori.
// Solo funzioni pure: le richieste di rete sono in services/gemini.ts.
// Stessa logica dell'app Nutrizione (fino alla 0.9.9), già provata sul telefono dell'utente.

/** Toglie eventuali ```json … ``` e testo attorno, e restituisce l'oggetto JSON. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}


/** Per ogni modello, fino a quando non usarlo (millisecondi), dopo un limite raggiunto o se non esiste. */
export type ModelPauses = Record<string, number>;

// ---------- Modelli nuovi senza aggiornare l'app ----------

/** Un modello dell'elenco di Google (`models.list`). */
export interface ListedModel {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

/** Un modello che può leggere le foto e scrivere ricette; `lite` = della famiglia leggera (Flash-Lite). */
export interface ModelCandidate {
  id: string;
  lite: boolean;
}

/**
 * Nomi che Google tiene sempre puntati al Flash e al Flash-Lite più recenti: riserva se l'elenco non
 * arriva o se i modelli scritti nell'app spariscono.
 */
export const LATEST_ALIASES = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

/**
 * Nomi di Google: "gemini-" + versione + parole ("gemini-3.8-flash", "gemini-3.5-flash-lite",
 * "gemini-4-hydrogen"). Le copie datate o numerate ("-001", "-preview-05-20") hanno cifre dopo la versione
 * e restano fuori: sono doppioni di un modello già in elenco.
 */
const MODEL_ID = /^gemini-(\d+(?:\.\d+)?)-([a-z]+(?:-[a-z]+)*)$/;

/**
 * Parole dei modelli che non servono per leggere le foto o scrivere ricette (immagini, voce, video, ricerca…) o che non
 * sono gratuiti e sono lenti (Pro, Ultra).
 */
const NOT_FOR_MEALS = new Set([
  'pro', 'ultra', 'embedding', 'tts', 'image', 'imagen', 'veo', 'video', 'live', 'audio', 'native', 'speech',
  'dialog', 'realtime', 'music', 'lyria', 'robotics', 'computer', 'aqa', 'exp', 'thinking', 'learnlm',
  'customtools', 'nano', 'banana', 'search', 'deep', 'research', 'decision', 'omni', 'latest', 'vision',
]);

/** Dal nome si capisce se è un modello della famiglia leggera (Flash-Lite). */
export function isLiteId(id: string): boolean {
  return /(^|-)lite(-|$)/.test(id);
}

/**
 * I modelli dell’elenco di Google utili all’app, dal più nuovo. Non guarda la parola
 * "flash": da Gemini 4 Google usa nomi di elementi ("gemini-4-hydrogen"), quindi basta il numero di
 * versione. A pari versione prima lo stabile, poi la "preview" (se la stabile c'è, la preview è un doppione).
 * Quali sono davvero gratuiti con la chiave dell'utente lo dice poi Google (vedi `isPaidOnly`).
 */
export function rankModels(listed: readonly ListedModel[]): ModelCandidate[] {
  const found = listed
    .filter((m) => (m.supportedGenerationMethods ?? ['generateContent']).includes('generateContent'))
    .map((m) => {
      const id = m.name.replace(/^models\//, '');
      const match = MODEL_ID.exec(id);
      if (!match) return null;
      const words = match[2]!.split('-');
      if (words.some((w) => NOT_FOR_MEALS.has(w))) return null;
      const version = Number(match[1]);
      if (!Number.isFinite(version)) return null;
      const preview = words.includes('preview');
      const family = `${version}-${words.filter((w) => w !== 'preview').join('-')}`;
      const lite = words.includes('lite') || /\blite\b/i.test(m.displayName ?? '');
      return { id, version, preview, family, lite };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => b.version - a.version || Number(a.preview) - Number(b.preview));
  return found
    .filter((m, i) => found.findIndex((o) => o.family === m.family) === i)
    .map((m) => ({ id: m.id, lite: m.lite }));
}

/**
 * I modelli per una stima, dal migliore: i due migliori non leggeri e il miglior leggero tra quelli non in
 * pausa (limite raggiunto, non gratuito, sparito). Se sono tutti in pausa si provano comunque i primi.
 */
export function chooseModels(models: readonly string[], lite: readonly string[], pauses: ModelPauses, now: number): string[] {
  const ready = models.filter((m) => !((pauses[m] ?? 0) > now));
  const pool = ready.length ? ready : models;
  const main = pool.filter((m) => !lite.includes(m)).slice(0, 2);
  const light = pool.filter((m) => lite.includes(m)).slice(0, 1);
  return [...main, ...light];
}

/**
 * Google risponde "limite raggiunto" con limite 0 quando un modello non è compreso nel livello gratuito
 * (per esempio Gemini 4 Argon e Carbon): non si libera a mezzanotte, va lasciato stare.
 */
export function isPaidOnly(json: unknown): boolean {
  const err = (json as { error?: { message?: unknown; details?: unknown } } | null)?.error;
  if (!err) return false;
  const text = `${typeof err.message === 'string' ? err.message : ''} ${JSON.stringify(err.details ?? [])}`;
  return /limit:\s*0(?!\d)/i.test(text) || /"quotaValue"\s*:\s*"?0"?[,}]/.test(text);
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Un modello non gratuito si riprova dopo un mese (Google a volte lo apre al livello gratuito). */
export const PAID_RECHECK_MS = 30 * DAY;

/** Millisecondi fino alla prossima mezzanotte di Los Angeles (quando Google azzera i limiti giornalieri). */
export function msToPacificMidnight(now: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsed = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000;
  return Math.max(MINUTE, DAY - elapsed + MINUTE);
}

/**
 * Fino a quando mettere in pausa un modello dopo una risposta di errore (null = nessuna pausa).
 * Limite giornaliero: fino alla mezzanotte di Los Angeles. Limite al minuto: il tempo indicato da Google
 * (almeno 30 secondi). Modello inesistente: una settimana. Modello non gratuito: un mese.
 */
export function pauseUntil(status: number, json: unknown, now: number): number | null {
  const problem = geminiProblem(status, json);
  if (problem === 'model') return now + 7 * DAY;
  if (problem !== 'quota') return null;
  if (isPaidOnly(json)) return now + PAID_RECHECK_MS;
  const details = (json as { error?: { details?: Record<string, unknown>[] } })?.error?.details ?? [];
  const text = JSON.stringify(details);
  if (/PerDay/i.test(text)) return now + msToPacificMidnight(now);
  const delay = details.map((d) => (typeof d.retryDelay === 'string' ? parseFloat(d.retryDelay) : NaN)).find((n) => Number.isFinite(n));
  return now + Math.min(10 * MINUTE, Math.max(30_000, (delay ?? 60) * 1000));
}

/** Com'è andato un tentativo con un modello (per spiegare all'utente cosa non ha funzionato). */
export type AttemptOutcome = 'ok' | 'empty' | 'unreadable' | 'quota' | 'paid' | 'model' | 'error' | 'timeout' | 'network' | 'slower';

export interface AiAttempt {
  model: string;
  outcome: AttemptOutcome;
  /** Secondi dalla partenza dell'analisi alla risposta (o a quando è stato fermato). */
  seconds?: number;
  /** Dettaglio breve: codice d'errore, risposta troncata, formato più semplice… */
  note?: string;
}

/**
 * Quanto ragionamento chiedere. Il ragionamento minimo è il più veloce: lo accettano i Flash-Lite 3 e il
 * 3.5/3.6 Flash; il 3.7 e il 3.8 Flash e Gemini 4 Hydrogen no (rispondono con un errore). A tutti gli altri,
 * compresi i modelli che usciranno, "low", che finora tutti accettano.
 */
export function thinkingLevelFor(model: string): 'minimal' | 'low' {
  return /^gemini-3(?:\.\d+)?-flash-lite$|^gemini-3\.[56]-flash$/.test(model) ? 'minimal' : 'low';
}

/** "gemini-3.5-flash-lite" → "3.5 Flash-Lite". */
export function modelLabel(model: string): string {
  if (model === 'gemini-flash-latest') return 'Flash (il più recente)';
  if (model === 'gemini-flash-lite-latest') return 'Flash-Lite (il più recente)';
  return model
    .replace(/^gemini-/, '')
    .split('-')
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace('Flash Lite', 'Flash-Lite');
}

const OUTCOME_TEXT: Record<AttemptOutcome, string> = {
  ok: 'ok',
  empty: 'niente riconosciuto',
  unreadable: 'risposta non leggibile',
  quota: 'limite gratuito raggiunto',
  paid: 'non gratuito con la tua chiave',
  model: 'non disponibile',
  error: 'errore',
  timeout: 'nessuna risposta in tempo',
  network: 'nessuna connessione',
  slower: 'più lento di un altro',
};

// ---------- Più modelli a scaglioni ----------
//
// Con una foto i modelli Flash a volte ci mettono più di 45 secondi, il Flash-Lite una decina. Aspettarli
// uno dopo l'altro voleva dire minuti. Ora si parte dal migliore e, se tarda, si avvia anche il successivo:
// vince la prima risposta buona, ma un modello migliore ancora in corsa ha qualche secondo di vantaggio.

/**
 * Dopo quanto, senza risposta, si avvia anche il modello successivo. Il limite gratuito è per modello e
 * ogni richiesta avviata conta anche se poi non serve: si avvia un modello in più solo quando il migliore
 * tarda davvero (con le foto il 3.6 Flash risponde di solito in 4–11 s).
 */
export const STAGGER_MS = 14_000;
/** Con una risposta buona di un modello più leggero, quanto si aspetta ancora quelli migliori (stimano meglio). */
export const GRACE_MS = 10_000;
/**
 * Oltre questo tempo dalla partenza non si concede più vantaggio: un modello migliore ancora zitto dopo
 * 35 s di solito è bloccato (server di Google sovraccarichi). Il 18/11 una stima di sola descrizione aveva
 * la risposta del Flash-Lite a 33 s ma aspettava Hydrogen fino a 43 s, inutilmente.
 */
export const GRACE_END_MS = 35_000;
/**
 * Un modello è "lento con le foto" solo se è rimasto senza rispondere almeno questo tempo. Prima bastava
 * essere superati da un altro: in pochi giri tutti i modelli diventavano "lenti" e partivano insieme a ogni
 * foto, consumando il limite gratuito tre volte più in fretta.
 */
export const SLOW_AFTER_MS = 20_000;

/** Vero se un modello va segnato lento: non ha risposto (o è andato oltre il tempo) dopo almeno `SLOW_AFTER_MS`. */
export function wasSlow(outcome: AttemptOutcome | null, waitedMs: number): boolean {
  if (outcome === 'timeout') return true;
  return outcome === null && waitedMs >= SLOW_AFTER_MS;
}
/** Tempo massimo per tutta l'analisi. */
export const OVERALL_MS = 75_000;
/** Se nessuno ha risposto in tempo e restano almeno questi millisecondi, si riprova una volta il più veloce. */
export const RETRY_MIN_LEFT_MS = 20_000;

/** Come è finita la richiesta a un modello: null = ancora in corso. */
export type RaceKind = 'ok' | 'empty' | 'fail' | 'stop';

export interface RaceState {
  /** Un elemento per modello avviato, in ordine dal migliore. */
  results: readonly (RaceKind | null)[];
  /** Modelli disponibili in tutto. */
  total: number;
  /** Il modello avviato per ultimo è stato lento con le foto di recente: il successivo parte subito. */
  lastIsSlow: boolean;
  sinceLastStart: number;
  /** Da quanto è arrivata la prima risposta buona (null = nessuna). */
  sinceFirstOk: number | null;
  elapsed: number;
  /** Tempo massimo di tutta la richiesta (di solito `OVERALL_MS`; le ricette ne hanno di più). */
  overallMs?: number;
  /** Dopo quanto avviare il modello successivo (di solito `STAGGER_MS`; le ricette scrivono di più e aspettano di più). */
  staggerMs?: number;
  /** Oltre quando non si aspetta più un modello migliore (di solito `GRACE_END_MS`). */
  graceEndMs?: number;
}

export type RaceAction = { type: 'start' } | { type: 'wait' } | { type: 'use'; index: number } | { type: 'stop'; index: number } | { type: 'finish' };

/** Cosa fare adesso nella gara tra i modelli (funzione pura, vedi `analyzeMeal`). */
export function raceStep(s: RaceState): RaceAction {
  const overall = s.overallMs ?? OVERALL_MS;
  const graceEnd = s.graceEndMs ?? GRACE_END_MS;
  const stop = s.results.indexOf('stop');
  if (stop >= 0) return { type: 'stop', index: stop };
  const ok = s.results.indexOf('ok');
  if (ok >= 0) {
    const betterPending = s.results.slice(0, ok).some((r) => r === null);
    if (!betterPending || (s.sinceFirstOk ?? 0) >= GRACE_MS || s.elapsed >= graceEnd || s.elapsed >= overall) {
      return { type: 'use', index: ok };
    }
    return { type: 'wait' };
  }
  const pending = s.results.filter((r) => r === null).length;
  const canStart = s.results.length < s.total && s.elapsed < overall;
  if (canStart && (pending === 0 || s.lastIsSlow || s.sinceLastStart >= (s.staggerMs ?? STAGGER_MS))) return { type: 'start' };
  if (pending === 0 || s.elapsed >= overall) return { type: 'finish' };
  return { type: 'wait' };
}

/** Modelli lenti con le foto: modello → fino a quando (millisecondi). */
export type SlowModels = Record<string, number>;
/** Per quanto un modello lento con le foto non ha più il vantaggio di partire da solo. */
export const SLOW_FOR_MS = 24 * 60 * 60 * 1000;

/** Riga breve con i tentativi fatti, es. "3.8 Flash: limite gratuito raggiunto · 3.6 Flash: niente riconosciuto". */
export function describeAttempts(attempts: AiAttempt[]): string {
  return attempts
    .map((a) => {
      const extra = [a.note, a.seconds !== undefined ? `${a.seconds} s` : undefined].filter(Boolean).join(', ');
      return `${modelLabel(a.model)}: ${OUTCOME_TEXT[a.outcome]}${extra ? ` (${extra})` : ''}`;
    })
    .join(' · ');
}

/**
 * Perché una risposta arrivata non ha il contenuto atteso (da `finishReason` di Gemini): troncata, bloccata, vuota.
 * Undefined se è finita normalmente.
 */
export function finishNote(json: unknown): string | undefined {
  const c = (json as { candidates?: { finishReason?: unknown }[] } | null)?.candidates?.[0];
  if (!c) return 'vuota';
  const reason = typeof c.finishReason === 'string' ? c.finishReason : '';
  if (!reason || reason === 'STOP') return undefined;
  if (reason === 'MAX_TOKENS') return 'troncata';
  if (/SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(reason)) return 'bloccata';
  return reason.toLowerCase();
}

/**
 * Controllo veloce di una foto rimpicciolita (pixel RGBA): vero se è praticamente tutta nera
 * o tutta di un colore, cioè se la fotocamera non ha dato un'immagine vera.
 */
export function looksBlank(rgba: ArrayLike<number>): boolean {
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    const y = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
    sum += y;
    sumSq += y * y;
    n++;
  }
  if (!n) return true;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  return sd < 2.5 || (mean < 10 && sd < 6);
}

/** Messaggio durante l'attesa, in base ai secondi passati. */
// ---------- Risposta dell'API di Gemini ----------

/** Testo della risposta (senza le parti di "ragionamento"). */
export function geminiText(json: unknown): string {
  const c = (json as { candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] } }[] })?.candidates?.[0];
  const parts = c?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p.text === 'string' && p.thought !== true)
    .map((p) => p.text as string)
    .join('');
}

export type GeminiProblem = 'key' | 'quota' | 'model' | 'blocked' | 'region' | 'timeout' | 'network' | 'other';

/**
 * Vero se la richiesta è caduta perché Gemini non ha risposto in tempo (e non perché manca la rete).
 * Sul telefono l'errore arriva da Android ("timeout", "Read timed out"), nel browser è un AbortError.
 */
export function isTimeoutError(e: unknown): boolean {
  const err = e as { name?: unknown; message?: unknown } | null;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return true;
  const message = typeof err?.message === 'string' ? err.message : typeof e === 'string' ? e : '';
  return /time[ds]?[ -]?out/i.test(message);
}

/** Che tipo di errore ha restituito Gemini. */
export function geminiProblem(status: number, json: unknown): GeminiProblem {
  const err = (json as { error?: { message?: unknown; status?: unknown; details?: { reason?: unknown }[] } })?.error;
  const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  const reasons = (err?.details ?? []).map((d) => String(d?.reason ?? '')).join(' ');
  if (status === 429) return 'quota';
  if (/API_KEY_INVALID|API_KEY_EXPIRED/.test(reasons) || message.includes('api key')) return 'key';
  if (status === 401 || status === 403) return message.includes('location') || message.includes('region') ? 'region' : 'key';
  if (status === 404) return 'model';
  if (message.includes('location is not supported') || message.includes('user location')) return 'region';
  const block = (json as { promptFeedback?: { blockReason?: unknown } })?.promptFeedback?.blockReason;
  if (block) return 'blocked';
  return 'other';
}

export function problemMessage(p: GeminiProblem): string {
  switch (p) {
    case 'key':
      return 'Gemini non accetta la chiave. Ricopiala tutta da aistudio.google.com/apikey e incollala di nuovo nelle Impostazioni.';
    case 'quota':
      return 'Hai raggiunto il limite gratuito di Gemini per adesso. Riprova tra qualche minuto o domani.';
    case 'region':
      return 'Gemini non è disponibile da dove ti trovi in questo momento.';
    case 'blocked':
      return 'Gemini non ha voluto rispondere a questa richiesta. Prova con un’altra foto o cambia le richieste.';
    case 'model':
      return 'Il modello di Gemini non è disponibile. Aggiorna l’app o riprova più tardi.';
    case 'timeout':
      return 'Gemini non ha risposto in tempo. Riprova tra poco: di solito la seconda volta va.';
    case 'network':
      return 'Non riesco a contattare Gemini. Controlla la connessione e riprova.';
    default:
      return 'Gemini non ha risposto. Riprova tra poco.';
  }
}

/** Le chiavi di Google AI Studio iniziano con "AQ." (nuove, da maggio 2026) o "AIza" (vecchie). */
export function looksLikeGeminiKey(key: string): boolean {
  const k = key.trim();
  return /^AIza[0-9A-Za-z_-]{30,}$/.test(k) || /^AQ\.[0-9A-Za-z_.-]{20,}$/.test(k);
}

// ---------- Avanzamento in tempo reale (da mostrare mentre l'IA lavora) ----------

/** Stato di un modello mentre la richiesta è in corso. */
export type LiveStatus = 'running' | AttemptOutcome;

export interface LiveAttempt {
  model: string;
  status: LiveStatus;
  /** Secondi da quando è partito questo modello. */
  seconds: number;
  note?: string;
}

export interface AiProgress {
  attempts: LiveAttempt[];
  /** Secondi dall'inizio della richiesta. */
  seconds: number;
}

/** "al lavoro…", "ha risposto ✓", "limite gratuito raggiunto"… */
export function liveStatusText(s: LiveStatus): string {
  if (s === 'running') return 'al lavoro…';
  if (s === 'ok') return 'ha risposto ✓';
  return OUTCOME_TEXT[s];
}

/** Una frase su cosa sta succedendo adesso (quale modello lavora e perché ne parte un altro). */
export function progressHeadline(p: AiProgress | null): string {
  const attempts = p?.attempts ?? [];
  if (!attempts.length) return 'Scelgo il modello di Gemini…';
  const running = attempts.filter((a) => a.status === 'running');
  const ok = attempts.find((a) => a.status === 'ok');
  const failed = attempts.filter((a) => a.status !== 'running' && a.status !== 'ok' && a.status !== 'slower');
  const first = running[0];
  if (ok && first) return `${modelLabel(ok.model)} ha risposto: aspetto qualche secondo ${modelLabel(first.model)}, di solito più preciso`;
  if (running.length >= 2) return `${modelLabel(running[0]!.model)} ci mette un po’: chiedo anche a ${modelLabel(running[running.length - 1]!.model)}`;
  if (first && failed.length) {
    const f = failed[failed.length - 1]!;
    return `${modelLabel(f.model)}: ${OUTCOME_TEXT[f.status as AttemptOutcome]}. Provo con ${modelLabel(first.model)}`;
  }
  if (first) return `Gemini ${modelLabel(first.model)} sta lavorando`;
  return 'Quasi fatto…';
}

/** "Fatto da Gemini 3.8 Flash in 9 s". */
export function usedModelText(model: string, seconds: number): string {
  return `Fatto da Gemini ${modelLabel(model)} in ${seconds < 1 ? 'meno di un secondo' : `${seconds} s`}`;
}
