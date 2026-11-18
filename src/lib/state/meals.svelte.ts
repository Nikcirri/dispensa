// Stato del piano dei pasti: tutti i pasti (sono pochi: due al giorno), la settimana mostrata
// e la richiesta "Programma con l'IA".
import { db } from '../db';
import { errorText, reportError } from '../errors';
import type { AiProgress } from '../logic/gemini';
import { freeSlots, mealFromRecipe, mealFromText, weekStart, type Meal, type MealSlot } from '../logic/meals';
import { planSlots, type PlanProposal, type PlanSlot } from '../logic/plan';
import type { Recipe } from '../logic/recipes';
import { plural } from '../logic/text';
import { tapFeedback } from '../platform';
import { addShopping, deleteMeal, saveMeals, updateMeal } from '../repo';
import { planMeals } from '../services/ai';
import { AiError } from '../services/gemini';
import { app, reloadMeals, reloadShopping } from './app.svelte';
import { recipes } from './recipes.svelte';
import { showToast, showUndoToast } from './ui.svelte';

export const plan = $state({
  /** Lunedì della settimana mostrata. */
  week: weekStart(app.today),
});

export async function addMeals(list: Meal[]): Promise<void> {
  try {
    await saveMeals(db, list);
    await reloadMeals();
    void tapFeedback('medium');
  } catch (e) {
    reportError(e);
  }
}

export async function addRecipeMeal(recipe: Recipe, date: string, slot: MealSlot): Promise<Meal> {
  const meal = mealFromRecipe(recipe, date, slot, new Date().toISOString());
  await addMeals([meal]);
  return meal;
}

export async function addTextMeal(text: string, date: string, slot: MealSlot): Promise<void> {
  if (!text.trim()) return;
  await addMeals([mealFromText(text, date, slot, new Date().toISOString())]);
}

export async function changeMeal(id: string, change: Partial<Omit<Meal, 'id'>>): Promise<void> {
  try {
    await updateMeal(db, id, change);
    await reloadMeals();
  } catch (e) {
    reportError(e);
  }
}

export async function toggleMealDone(meal: Meal): Promise<void> {
  void tapFeedback(meal.done ? 'light' : 'medium');
  await changeMeal(meal.id, { done: !meal.done });
}

/** Toglie un pasto dal piano, con "Annulla". */
export async function removeMeal(meal: Meal): Promise<void> {
  try {
    const copy = $state.snapshot(meal) as Meal;
    await deleteMeal(db, meal.id);
    await reloadMeals();
    showUndoToast(`${meal.title}: tolto dal piano`, async () => {
      await saveMeals(db, [copy]);
      await reloadMeals();
    });
  } catch (e) {
    reportError(e);
  }
}

/** Mette nella lista della spesa gli ingredienti che mancano. */
export async function addMissingToShopping(list: readonly { name: string; amount: string }[]): Promise<void> {
  if (!list.length) return;
  try {
    for (const m of [...list].reverse()) await addShopping(db, m.name, m.amount);
    await reloadShopping();
    void tapFeedback();
    showToast(`${plural(list.length, 'ingrediente aggiunto', 'ingredienti aggiunti')} alla spesa`);
  } catch (e) {
    reportError(e);
  }
}

// ---------- Programma con l'IA ----------

export interface PlanChoice extends PlanProposal {
  keep: boolean;
}

export const planAi = $state({
  loading: false,
  seconds: 0,
  progress: null as AiProgress | null,
  error: null as string | null,
  detail: '',
  proposals: [] as PlanChoice[],
  note: '',
  usedModel: '',
  usedSeconds: 0,
  /** Opzioni scelte nel foglio (restano per la volta dopo, finché l'app è aperta). */
  slots: ['pranzo', 'cena'] as MealSlot[],
  days: 3,
  onlyPantry: false,
  extra: '',
});

/** I pasti liberi che l'IA riempirà con le opzioni scelte. */
export function planTargets(): PlanSlot[] {
  const from = plan.week > app.today ? plan.week : app.today;
  return planSlots(freeSlots(app.meals, from, planAi.days, planAi.slots, app.today, new Date().getHours()));
}

let timer: ReturnType<typeof setInterval> | undefined;

export async function generatePlan(): Promise<void> {
  if (planAi.loading) return;
  const slots = planTargets();
  if (!slots.length) {
    planAi.error = 'Questi pasti sono già tutti in programma. Scegli più giorni o anche gli altri pasti.';
    return;
  }
  planAi.loading = true;
  planAi.error = null;
  planAi.detail = '';
  planAi.proposals = [];
  planAi.note = '';
  planAi.progress = null;
  planAi.seconds = 0;
  const t0 = Date.now();
  clearInterval(timer);
  timer = setInterval(() => (planAi.seconds = Math.round((Date.now() - t0) / 1000)), 1000);
  try {
    const f = recipes.filters;
    const res = await planMeals(
      app.aiKey,
      $state.snapshot(app.items),
      slots,
      {
        servings: f.servings,
        vegetarian: f.vegetarian,
        lactoseFree: f.lactoseFree,
        glutenFree: app.settings.recipes.glutenFree,
        onlyPantry: planAi.onlyPantry,
        staples: app.settings.recipes.staples,
        extra: planAi.extra,
      },
      (p) => (planAi.progress = p),
    );
    planAi.proposals = res.value.proposals.map((p) => ({ ...p, keep: true }));
    planAi.note = res.value.note;
    planAi.usedModel = res.model;
    planAi.usedSeconds = res.seconds;
    planAi.detail = res.detail;
    void tapFeedback('medium');
  } catch (e) {
    planAi.error = e instanceof AiError ? e.message : `Non riesco a preparare il piano (${errorText(e)}).`;
    planAi.detail = e instanceof AiError ? e.detail : '';
  } finally {
    clearInterval(timer);
    planAi.loading = false;
    planAi.progress = null;
  }
}

/** Mette nel piano le proposte scelte. Restituisce quante. */
export async function acceptPlan(): Promise<number> {
  const now = new Date().toISOString();
  const chosen = planAi.proposals.filter((p) => p.keep);
  const list = chosen.map((p) => mealFromRecipe($state.snapshot(p.recipe) as Recipe, p.slot.date, p.slot.slot, now));
  if (!list.length) return 0;
  await addMeals(list);
  planAi.proposals = [];
  planAi.note = '';
  return list.length;
}
