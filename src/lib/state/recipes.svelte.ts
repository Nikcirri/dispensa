// Stato della scheda "Cosa cucino?": filtri, ricette proposte, preferite. Resta quando si cambia scheda.
import { db } from '../db';
import { errorText } from '../errors';
import type { AiProgress } from '../logic/gemini';
import { DEFAULT_FILTERS, sortRecipes, wantsOnlyExpiring, withSteps, type Recipe, type RecipeFilters } from '../logic/recipes';
import { tapFeedback } from '../platform';
import { getLastRecipes, getLastRecipesNote, saveRecipe, savedRecipes, setLastRecipes, unsaveRecipe, updateMeal } from '../repo';
import { suggestRecipes, writeSteps } from '../services/ai';
import { AiError } from '../services/gemini';
import { app, reloadMeals, sheets, updateSettings } from './app.svelte';
import { showToast } from './ui.svelte';

export const recipes = $state({
  loaded: false,
  list: [] as Recipe[],
  saved: [] as Recipe[],
  filters: { ...DEFAULT_FILTERS } as RecipeFilters,
  loading: false,
  seconds: 0,
  error: null as string | null,
  /** Riga tecnica dei tentativi (sotto l'errore o sotto le ricette). */
  detail: '',
  view: 'nuove' as 'nuove' | 'salvate',
  /** Cosa sta facendo l'IA (modelli al lavoro), mentre aspetta. */
  progress: null as AiProgress | null,
  /** Modello che ha scritto le ultime ricette e in quanti secondi. */
  usedModel: '',
  usedSeconds: 0,
  /** Frase dell'IA sulle ultime ricette (es. una richiesta che non ha potuto rispettare). */
  note: '',
  /** Le ultime ricette sono state chieste "solo con prodotti in scadenza". */
  askedOnlyExpiring: false,
});

export async function loadRecipes(): Promise<void> {
  if (recipes.loaded) return;
  const [last, saved, note] = await Promise.all([getLastRecipes(db), savedRecipes(db), getLastRecipesNote(db)]);
  recipes.list = last;
  recipes.note = note.text;
  recipes.askedOnlyExpiring = note.onlyExpiring;
  recipes.saved = saved;
  const r = app.settings.recipes;
  recipes.filters = { ...DEFAULT_FILTERS, servings: r.servings, vegetarian: r.vegetarian, lactoseFree: r.lactoseFree };
  recipes.loaded = true;
}

/** Vegetariano e senza lattosio restano scelti anche le volte dopo; anche il numero di persone. */
export function rememberFilters(): void {
  const f = recipes.filters;
  void updateSettings((s) => {
    s.recipes.vegetarian = f.vegetarian;
    s.recipes.lactoseFree = f.lactoseFree;
    s.recipes.servings = f.servings;
  });
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Chiede 3 ricette all'IA. `more`: altre idee diverse da quelle già viste. */
export async function generateRecipes(more = false): Promise<void> {
  if (recipes.loading || !app.aiKey) return;
  recipes.loading = true;
  recipes.error = null;
  recipes.detail = '';
  recipes.seconds = 0;
  recipes.progress = null;
  recipes.view = 'nuove';
  const t0 = Date.now();
  timer = setInterval(() => (recipes.seconds = Math.round((Date.now() - t0) / 1000)), 1000);
  void tapFeedback();
  try {
    const avoid = more ? recipes.list.map((r) => r.title) : [];
    const filters = $state.snapshot(recipes.filters) as RecipeFilters;
    const res = await suggestRecipes(
      app.aiKey,
      $state.snapshot(app.items),
      filters,
      { staples: app.settings.recipes.staples, glutenFree: app.settings.recipes.glutenFree, avoid },
      (p) => (recipes.progress = p),
    );
    recipes.list = sortRecipes(res.value.recipes, app.items, app.today);
    recipes.note = res.value.note;
    recipes.askedOnlyExpiring = wantsOnlyExpiring(filters);
    recipes.usedModel = res.model;
    recipes.usedSeconds = res.seconds;
    recipes.detail = res.detail;
    await setLastRecipes(db, $state.snapshot(recipes.list), { text: recipes.note, onlyExpiring: recipes.askedOnlyExpiring });
  } catch (e) {
    recipes.error = e instanceof Error ? e.message : `Qualcosa è andato storto (${errorText(e)}).`;
    recipes.detail = e instanceof AiError ? e.detail : '';
  } finally {
    clearInterval(timer);
    recipes.loading = false;
    recipes.progress = null;
  }
}

export function isSaved(id: string): boolean {
  return recipes.saved.some((r) => r.id === id);
}

export async function toggleSaved(r: Recipe): Promise<void> {
  if (isSaved(r.id)) {
    await unsaveRecipe(db, r.id);
    recipes.saved = recipes.saved.filter((x) => x.id !== r.id);
    showToast('Tolta dalle ricette salvate');
  } else {
    await saveRecipe(db, $state.snapshot(r) as Recipe);
    recipes.saved = [r, ...recipes.saved];
    void tapFeedback();
    showToast('Ricetta salvata ❤️');
  }
}

// ---------- Ricette scritte da chi usa l'app e procedimento scritto dopo ----------

/** Aggiorna una ricetta ovunque si trovi: ultime idee, salvate, pasti del piano, foglio aperto. */
export async function updateRecipeEverywhere(r: Recipe): Promise<void> {
  const copy = JSON.parse(JSON.stringify($state.snapshot(r))) as Recipe;
  if (recipes.list.some((x) => x.id === r.id)) {
    recipes.list = recipes.list.map((x) => (x.id === r.id ? copy : x));
    await setLastRecipes(db, $state.snapshot(recipes.list) as Recipe[], { text: recipes.note, onlyExpiring: recipes.askedOnlyExpiring });
  }
  if (isSaved(r.id)) {
    await saveRecipe(db, copy);
    recipes.saved = recipes.saved.map((x) => (x.id === r.id ? copy : x));
  }
  const meals = app.meals.filter((m) => m.recipe?.id === r.id);
  for (const m of meals) await updateMeal(db, m.id, { recipe: copy, title: copy.title, emoji: copy.emoji });
  if (meals.length) await reloadMeals();
  if (sheets.recipe?.id === r.id) sheets.recipe = copy;
}

/** Salva (o aggiorna) una ricetta scritta da chi usa l'app tra le ricette salvate. */
export async function saveUserRecipe(r: Recipe): Promise<void> {
  const copy = JSON.parse(JSON.stringify($state.snapshot(r))) as Recipe;
  await saveRecipe(db, copy);
  recipes.saved = isSaved(r.id) ? recipes.saved.map((x) => (x.id === r.id ? copy : x)) : [copy, ...recipes.saved];
  await updateRecipeEverywhere(copy);
}

export const stepsAi = $state({
  /** Id della ricetta di cui si sta scrivendo il procedimento ("" se nessuna). */
  recipeId: '',
  progress: null as AiProgress | null,
  seconds: 0,
  error: null as string | null,
  detail: '',
});

let stepsTimer: ReturnType<typeof setInterval> | undefined;

/** Chiede all'IA il procedimento di un piatto che non ce l'ha e lo salva ovunque. */
export async function generateSteps(recipe: Recipe): Promise<void> {
  if (stepsAi.recipeId) return;
  stepsAi.recipeId = recipe.id;
  stepsAi.error = null;
  stepsAi.detail = '';
  stepsAi.progress = null;
  stepsAi.seconds = 0;
  const t0 = Date.now();
  clearInterval(stepsTimer);
  stepsTimer = setInterval(() => (stepsAi.seconds = Math.round((Date.now() - t0) / 1000)), 1000);
  try {
    const base = $state.snapshot(recipe) as Recipe;
    const res = await writeSteps(app.aiKey, base, (p) => (stepsAi.progress = p));
    await updateRecipeEverywhere(withSteps(base, res.value));
    void tapFeedback();
  } catch (e) {
    stepsAi.error = e instanceof AiError ? e.message : `Non riesco a scrivere il procedimento (${errorText(e)}).`;
    stepsAi.detail = e instanceof AiError ? e.detail : '';
  } finally {
    clearInterval(stepsTimer);
    stepsAi.recipeId = '';
    stepsAi.progress = null;
  }
}
