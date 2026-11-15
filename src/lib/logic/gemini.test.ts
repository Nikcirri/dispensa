import { describe, expect, it } from 'vitest';
import {
  describeAttempts,
  extractJson,
  geminiProblem,
  geminiText,
  GRACE_MS,
  isTimeoutError,
  LATEST_ALIASES,
  looksBlank,
  looksLikeGeminiKey,
  modelLabel,
  modelsToTry,
  msToPacificMidnight,
  OVERALL_MS,
  pauseUntil,
  pickModels,
  raceStep,
  STAGGER_MS,
  thinkingLevelFor,
  wasSlow,
} from './gemini';

describe('Gemini: risposta', () => {
  it('legge il JSON anche dentro ``` e il testo senza il ragionamento', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('niente')).toBeNull();
    const json = { candidates: [{ content: { parts: [{ text: 'pensiero', thought: true }, { text: '{"ok":1}' }] } }] };
    expect(geminiText(json)).toBe('{"ok":1}');
  });

  it('riconosce le foto nere o vuote', () => {
    const black = new Uint8ClampedArray(24 * 24 * 4);
    expect(looksBlank(black)).toBe(true);
    const noisy = new Uint8ClampedArray(24 * 24 * 4).map((_, i) => (i * 37) % 255);
    expect(looksBlank(noisy)).toBe(false);
  });

  it('riconosce gli errori di Gemini', () => {
    expect(geminiProblem(400, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } })).toBe('key');
    expect(geminiProblem(429, { error: { message: 'Resource has been exhausted' } })).toBe('quota');
    expect(geminiProblem(404, { error: { message: 'models/x is not found' } })).toBe('model');
    expect(geminiProblem(400, { error: { message: 'User location is not supported for the API use.' } })).toBe('region');
    expect(geminiProblem(500, {})).toBe('other');
  });

  it('forma delle chiavi', () => {
    expect(looksLikeGeminiKey('AIzaSyD-abcdefghijklmnopqrstuvwxyz012345')).toBe(true);
    expect(looksLikeGeminiKey('AQ.Ab8RN6Jxl6OdplEKqxwlbG2IZ7PNmYabcdefghijkl')).toBe(true);
    expect(looksLikeGeminiKey('sk-123')).toBe(false);
    expect(looksLikeGeminiKey('projects/355147696887')).toBe(false);
  });
});

describe('AI: velocità', () => {
  it('usa sempre il modello migliore disponibile, saltando quelli in pausa', () => {
    const models = ['a', 'b', 'c'];
    const now = 1_000_000;
    expect(modelsToTry(models, {}, now)).toEqual(['a', 'b', 'c']);
    expect(modelsToTry(models, { a: now + 5000 }, now)).toEqual(['b', 'c']);
    // La pausa finita non conta più: il migliore torna primo.
    expect(modelsToTry(models, { a: now - 1 }, now)).toEqual(['a', 'b', 'c']);
    // Tutti in pausa: si provano comunque.
    expect(modelsToTry(models, { a: now + 1, b: now + 1, c: now + 1 }, now)).toEqual(['a', 'b', 'c']);
  });
  it('pausa giusta dopo un errore', () => {
    const now = Date.UTC(2026, 10, 10, 20, 0, 0); // 12:00 a Los Angeles
    const day = { error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } };
    expect(pauseUntil(429, day, now)).toBe(now + 12 * 3600_000 + 60_000);
    const minute = { error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '42s' }] } };
    expect(pauseUntil(429, minute, now)).toBe(now + 42_000);
    expect(pauseUntil(429, { error: { code: 429 } }, now)).toBe(now + 60_000);
    expect(pauseUntil(404, { error: { code: 404 } }, now)).toBe(now + 7 * 24 * 3600_000);
    expect(pauseUntil(400, { error: { code: 400, message: 'bad' } }, now)).toBeNull();
  });
  it('mezzanotte di Los Angeles', () => {
    expect(msToPacificMidnight(Date.UTC(2026, 10, 10, 7, 59, 0))).toBe(2 * 60_000); // 23:59 a LA: 1 minuto + 1 di margine
    expect(msToPacificMidnight(Date.UTC(2026, 6, 10, 7, 0, 0))).toBe(24 * 3600_000 + 60_000); // 00:00 in estate (UTC-7)
  });
  it('nomi dei modelli', () => {
    expect(modelLabel('gemini-3.5-flash-lite')).toBe('3.5 Flash-Lite');
    expect(modelLabel('gemini-3.8-flash')).toBe('3.8 Flash');
  });
});

describe('AI: nessuna risposta in tempo', () => {
  it('riconosce quando Gemini non ha risposto in tempo', () => {
    expect(isTimeoutError(new Error('timeout'))).toBe(true);
    expect(isTimeoutError(new Error('Read timed out'))).toBe(true);
    expect(isTimeoutError(new Error('failed to connect to generativelanguage.googleapis.com after 15000ms: Timed out'))).toBe(true);
    expect(isTimeoutError(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))).toBe(true);
    // Senza rete non è un "tempo scaduto".
    expect(isTimeoutError(new Error('Unable to resolve host "generativelanguage.googleapis.com"'))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });

  it('lo scrive nella riga dei tentativi', () => {
    expect(describeAttempts([{ model: 'gemini-3.8-flash', outcome: 'timeout' }, { model: 'gemini-3.6-flash', outcome: 'ok' }])).toBe(
      '3.8 Flash: nessuna risposta in tempo · 3.6 Flash: ok',
    );
  });
});


describe('AI: più modelli a scaglioni', () => {
  const base = { total: 3, lastIsSlow: false, sinceLastStart: 0, sinceFirstOk: null, elapsed: 0 };
  it('si parte dal migliore e, se tarda, si avvia il successivo', () => {
    expect(raceStep({ ...base, results: [] })).toEqual({ type: 'start' });
    expect(raceStep({ ...base, results: [null], sinceLastStart: 3000, elapsed: 3000 })).toEqual({ type: 'wait' });
    expect(raceStep({ ...base, results: [null], sinceLastStart: STAGGER_MS, elapsed: STAGGER_MS })).toEqual({ type: 'start' });
    // Limite finito o errore: il successivo parte subito.
    expect(raceStep({ ...base, results: ['fail'], sinceLastStart: 500, elapsed: 500 })).toEqual({ type: 'start' });
    // Un modello lento con le foto non ha vantaggio.
    expect(raceStep({ ...base, results: [null], lastIsSlow: true })).toEqual({ type: 'start' });
  });

  it('vince la prima risposta buona, ma il migliore ha qualche secondo di vantaggio', () => {
    expect(raceStep({ ...base, results: ['ok', null] })).toEqual({ type: 'use', index: 0 });
    expect(raceStep({ ...base, results: [null, null, 'ok'], sinceFirstOk: 1000, elapsed: 20000 })).toEqual({ type: 'wait' });
    expect(raceStep({ ...base, results: [null, null, 'ok'], sinceFirstOk: GRACE_MS, elapsed: 25000 })).toEqual({ type: 'use', index: 2 });
    expect(raceStep({ ...base, results: ['fail', 'ok', null], sinceFirstOk: 0 })).toEqual({ type: 'use', index: 1 });
  });

  it('chiave sbagliata: ci si ferma; tutti finiti o tempo scaduto: si chiude', () => {
    expect(raceStep({ ...base, results: [null, 'stop'] })).toEqual({ type: 'stop', index: 1 });
    expect(raceStep({ ...base, results: ['fail', 'empty', 'fail'] })).toEqual({ type: 'finish' });
    expect(raceStep({ ...base, results: [null, null, null], elapsed: OVERALL_MS })).toEqual({ type: 'finish' });
    expect(raceStep({ ...base, total: 1, results: [null], sinceLastStart: 30000, elapsed: 30000 })).toEqual({ type: 'wait' });
  });
});

describe('Gemini: tempo massimo diverso per le ricette', () => {
  it('con più tempo a disposizione si continua ad aspettare', () => {
    const base = { total: 2, lastIsSlow: false, sinceLastStart: 0, sinceFirstOk: null };
    expect(raceStep({ ...base, results: [null, null], elapsed: OVERALL_MS })).toEqual({ type: 'finish' });
    expect(raceStep({ ...base, results: [null, null], elapsed: OVERALL_MS, overallMs: OVERALL_MS + 30_000 })).toEqual({ type: 'wait' });
  });
});

describe('AI: quanto ragionamento chiedere', () => {
  it('minimo dove è accettato (più veloce), basso sui Flash più nuovi', () => {
    expect(thinkingLevelFor('gemini-3.5-flash-lite')).toBe('minimal');
    expect(thinkingLevelFor('gemini-3.6-flash')).toBe('minimal');
    expect(thinkingLevelFor('gemini-3.8-flash')).toBe('low');
    expect(thinkingLevelFor('gemini-4-flash')).toBe('low');
  });

  it('i secondi nella riga dei tentativi', () => {
    expect(describeAttempts([{ model: 'gemini-3.8-flash', outcome: 'slower' }, { model: 'gemini-3.5-flash-lite', outcome: 'ok', seconds: 12 }])).toBe(
      '3.8 Flash: più lento di un altro · 3.5 Flash-Lite: ok (12 s)',
    );
  });
});

describe('AI: modelli lenti con le foto', () => {
  it('lento solo chi è rimasto senza risposta a lungo, non chi è stato superato', () => {
    expect(wasSlow('timeout', 3000)).toBe(true);
    expect(wasSlow(null, 25_000)).toBe(true);
    // Superato da un modello più veloce dopo pochi secondi: non è lento.
    expect(wasSlow(null, 6_000)).toBe(false);
    expect(wasSlow('ok', 30_000)).toBe(false);
    expect(wasSlow('quota', 1_000)).toBe(false);
  });
});

describe('AI: modelli nuovi senza aggiornare l’app', () => {
  const FALLBACK = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
  const gen = (name: string) => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent', 'countTokens'] });
  it('prende i due Flash più nuovi e il Flash-Lite più nuovo', () => {
    const listed = [
      gen('gemini-3.5-flash'),
      gen('gemini-3.8-flash'),
      gen('gemini-3.6-flash'),
      gen('gemini-3.5-flash-lite'),
      gen('gemini-3.7-flash-lite'),
      gen('gemini-3.8-flash-image'),
      gen('gemini-3.8-pro'),
      gen('gemini-flash-latest'),
      { name: 'models/gemini-4-flash-live', supportedGenerationMethods: ['bidiGenerateContent'] },
      { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
    ];
    expect(pickModels(listed, FALLBACK)).toEqual(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.7-flash-lite']);
  });

  it('quando esce un modello nuovo lo usa da sola; a pari versione solo quello stabile', () => {
    const listed = [gen('gemini-3.8-flash'), gen('gemini-4-flash-preview'), gen('gemini-4-flash'), gen('gemini-3.5-flash-lite')];
    expect(pickModels(listed, FALLBACK)).toEqual(['gemini-4-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });

  it('se di una versione esiste solo la preview, usa la preview', () => {
    const listed = [gen('gemini-3.8-flash'), gen('gemini-4-flash-preview'), gen('gemini-4-flash-lite-preview')];
    expect(pickModels(listed, FALLBACK)).toEqual(['gemini-4-flash-preview', 'gemini-3.8-flash', 'gemini-4-flash-lite-preview']);
  });

  it('senza elenco (o con nomi che non riconosce) usa quelli scritti nell’app', () => {
    expect(pickModels(null, FALLBACK)).toEqual(FALLBACK);
    expect(pickModels([gen('gemini-nuovo-nome')], FALLBACK)).toEqual(FALLBACK);
    expect(LATEST_ALIASES).toContain('gemini-flash-latest');
  });
});
