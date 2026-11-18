// Le funzioni IA dell'app: leggere una foto, proporre ricette e programmare i pasti.
import { todayKey } from '../logic/dates';
import type { AiProgress } from '../logic/gemini';
import { buildPlanPrompt, parsePlan, PLAN_SCHEMA, type PlanOptions, type PlanResult, type PlanSlot } from '../logic/plan';
import {
  buildRecipePrompt,
  buildStepsPrompt,
  parseRecipes,
  parseSteps,
  RECIPES_SCHEMA,
  STEPS_SCHEMA,
  type Recipe,
  type RecipeFilters,
  type RecipeResult,
  type StepsResult,
} from '../logic/recipes';
import { buildScanPrompt, parseScan, SCAN_SCHEMA, type ScanMode, type ScanResult } from '../logic/scan';
import type { Item } from '../types';
import { runGemini, type GeminiResult } from './gemini';

export async function scanPhoto(
  key: string,
  image: { base64: string; mime: string },
  mode: ScanMode,
  productName = '',
  onProgress?: (p: AiProgress) => void,
): Promise<GeminiResult<ScanResult>> {
  const today = todayKey();
  return runGemini(key, {
    prompt: buildScanPrompt(mode, today, productName),
    image,
    schema: SCAN_SCHEMA,
    parse: (text) => parseScan(text, today),
    isEmpty: (r) => r.products.length === 0 || (mode === 'data' && !r.products.some((p) => p.expiry && !p.expiryEstimated)),
    // Con tanti prodotti (o uno scontrino lungo) la risposta è più lunga.
    fullTimeoutMs: mode === 'multi' ? 45_000 : 30_000,
    timeoutMs: mode === 'multi' ? 60_000 : 45_000,
    overallMs: mode === 'multi' ? 100_000 : 75_000,
    onProgress,
  });
}

export async function suggestRecipes(
  key: string,
  items: readonly Item[],
  filters: RecipeFilters,
  options: { staples: readonly string[]; glutenFree: boolean; avoid?: readonly string[] },
  onProgress?: (p: AiProgress) => void,
): Promise<GeminiResult<RecipeResult>> {
  const today = todayKey();
  const { prompt, refs } = buildRecipePrompt(items, today, filters, options);
  return runGemini(key, {
    prompt,
    image: null,
    schema: RECIPES_SCHEMA,
    parse: (text) => parseRecipes(text, refs, filters.servings, new Date().toISOString()),
    isEmpty: (r) => r.recipes.length === 0,
    fullTimeoutMs: 50_000,
    timeoutMs: 60_000,
    overallMs: 110_000,
    // Scrivere 3 ricette richiede di solito 10–25 s: il secondo modello parte solo se il primo tarda davvero.
    staggerMs: 35_000,
    onProgress,
  });
}

export async function planMeals(
  key: string,
  items: readonly Item[],
  slots: readonly PlanSlot[],
  options: PlanOptions,
  onProgress?: (p: AiProgress) => void,
): Promise<GeminiResult<PlanResult>> {
  const today = todayKey();
  const { prompt, refs } = buildPlanPrompt(items, today, slots, options);
  return runGemini(key, {
    prompt,
    image: null,
    schema: PLAN_SCHEMA,
    parse: (text) => parsePlan(text, refs, slots, options.servings, new Date().toISOString()),
    isEmpty: (r) => r.proposals.length === 0,
    // Risposta corta (senza procedimento): tempi poco più larghi di quelli delle ricette.
    fullTimeoutMs: 50_000,
    timeoutMs: 60_000,
    overallMs: 120_000,
    staggerMs: 25_000,
    onProgress,
  });
}

/** Il procedimento di un piatto che non ce l'ha ancora (piatti del piano, ricette scritte senza). */
export async function writeSteps(key: string, recipe: Recipe, onProgress?: (p: AiProgress) => void): Promise<GeminiResult<StepsResult>> {
  return runGemini(key, {
    prompt: buildStepsPrompt(recipe),
    image: null,
    schema: STEPS_SCHEMA,
    parse: parseSteps,
    isEmpty: (r) => r.steps.length === 0,
    fullTimeoutMs: 30_000,
    timeoutMs: 40_000,
    overallMs: 75_000,
    staggerMs: 15_000,
    onProgress,
  });
}
