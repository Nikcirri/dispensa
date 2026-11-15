// Stato della scheda "Cosa cucino?": filtri, ricette proposte, preferite. Resta quando si cambia scheda.
import { db } from '../db';
import { errorText } from '../errors';
import { DEFAULT_FILTERS, sortRecipes, type Recipe, type RecipeFilters } from '../logic/recipes';
import { tapFeedback } from '../platform';
import { getLastRecipes, saveRecipe, savedRecipes, setLastRecipes, unsaveRecipe } from '../repo';
import { suggestRecipes } from '../services/ai';
import { AiError } from '../services/gemini';
import { app, updateSettings } from './app.svelte';
import { showToast } from './ui.svelte';

export const recipes = $state({
  loaded: false,
  list: [] as Recipe[],
  saved: [] as Recipe[],
  filters: { ...DEFAULT_FILTERS } as RecipeFilters,
  loading: false,
  seconds: 0,
  error: null as string | null,
  /** Riga tecnica dei tentativi (sotto l'errore). */
  detail: '',
  view: 'nuove' as 'nuove' | 'salvate',
});

export async function loadRecipes(): Promise<void> {
  if (recipes.loaded) return;
  const [last, saved] = await Promise.all([getLastRecipes(db), savedRecipes(db)]);
  recipes.list = last;
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
  recipes.view = 'nuove';
  const t0 = Date.now();
  timer = setInterval(() => (recipes.seconds = Math.round((Date.now() - t0) / 1000)), 1000);
  void tapFeedback();
  try {
    const avoid = more ? recipes.list.map((r) => r.title) : [];
    const res = await suggestRecipes(app.aiKey, $state.snapshot(app.items), $state.snapshot(recipes.filters), {
      staples: app.settings.recipes.staples,
      glutenFree: app.settings.recipes.glutenFree,
      avoid,
    });
    recipes.list = sortRecipes(res.value, app.items, app.today);
    await setLastRecipes(db, $state.snapshot(recipes.list));
  } catch (e) {
    recipes.error = e instanceof Error ? e.message : `Qualcosa è andato storto (${errorText(e)}).`;
    recipes.detail = e instanceof AiError ? e.detail : '';
  } finally {
    clearInterval(timer);
    recipes.loading = false;
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
