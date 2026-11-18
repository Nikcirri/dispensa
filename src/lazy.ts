// Parti dell'app caricate solo quando servono: all'apertura il telefono legge meno codice e la Dispensa
// compare prima. Poco dopo, quando il telefono è libero, `preloadAll` le prepara tutte.

export const load = {
  onboarding: () => import('./views/Onboarding.svelte'),
  aggiungi: () => import('./views/Aggiungi.svelte'),
  ricette: () => import('./views/Ricette.svelte'),
  pasti: () => import('./views/Pasti.svelte'),
  spesa: () => import('./views/Spesa.svelte'),
  product: () => import('./views/sheets/ProductSheet.svelte'),
  multi: () => import('./views/sheets/MultiSheet.svelte'),
  settings: () => import('./views/sheets/SettingsSheet.svelte'),
  stats: () => import('./views/sheets/StatsSheet.svelte'),
  aiKey: () => import('./views/sheets/AiKeySheet.svelte'),
  recipe: () => import('./views/sheets/RecipeSheet.svelte'),
  cooked: () => import('./views/sheets/CookedSheet.svelte'),
  meal: () => import('./views/sheets/MealSheet.svelte'),
  plan: () => import('./views/sheets/PlanSheet.svelte'),
  planAi: () => import('./views/sheets/PlanAiSheet.svelte'),
  editRecipe: () => import('./views/sheets/RecipeEditSheet.svelte'),
};

/** Prepara in anticipo tutte le parti, quando il telefono non ha altro da fare. */
export function preloadAll(): void {
  const run = () => {
    for (const fn of Object.values(load)) void fn().catch(() => undefined);
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2500 });
  else setTimeout(run, 1500);
}
