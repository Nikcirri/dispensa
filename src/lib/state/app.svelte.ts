// Stato principale dell'app: impostazioni, scheda aperta, dati della dispensa, fogli aperti, azioni comuni.
import { db } from '../db';
import { reportError } from '../errors';
import { addDays, todayKey } from '../logic/dates';
import { applyDraft, itemFromDraft, type ProductDraft } from '../logic/drafts';
import { mealsToRelink, type Meal, type MealSlot } from '../logic/meals';
import type { Recipe } from '../logic/recipes';
import { defaultSettings } from '../logic/settings';
import { widgetData } from '../logic/widget';
import { tapFeedback } from '../platform';
import {
  addShopping,
  allItems,
  allShopping,
  getAiKey,
  loadSettings,
  mealsBetween,
  pruneMeals,
  saveMeals,
  recentTemplates,
  removeItem,
  saveItem,
  saveSettings,
  undoRemoval,
  updateItem,
} from '../repo';
import { rescheduleExpiryNotifications } from '../services/notifications';
import { pushWidgets } from '../services/widgets';
import type { Item, Outcome, Settings, ShoppingItem, Template } from '../types';
import { showToast, showUndoToast } from './ui.svelte';

export type Tab = 'dispensa' | 'ricette' | 'aggiungi' | 'pasti' | 'spesa';

export const app = $state({
  ready: false,
  settings: defaultSettings() as Settings,
  tab: 'dispensa' as Tab,
  today: todayKey(),
  items: [] as Item[],
  shopping: [] as ShoppingItem[],
  templates: [] as Template[],
  /** Piano dei pasti (dagli ultimi mesi in avanti). */
  meals: [] as Meal[],
  aiKey: '',
});

/** Pasti tenuti in memoria e nel database: i più vecchi si cancellano da soli. */
export const MEALS_KEEP_DAYS = 120;

/** Un pasto nuovo per quel giorno, oppure uno già nel piano da guardare o cambiare. */
export type MealRequest = { mode: 'new'; date: string; slot: MealSlot } | { mode: 'edit'; id: string };

/** Scegliere giorno e pasto: per mettere una ricetta nel piano o spostare un pasto. */
export type PlanRequest = { recipe: Recipe } | { mealId: string };

/** "Com'è andata?": aggiornare la dispensa dopo aver cucinato una ricetta o un pasto del piano. */
export interface CookedRequest {
  /** La ricetta (null per un pasto scritto a mano senza ingredienti). */
  recipe: Recipe | null;
  title: string;
  /** Il pasto del piano da segnare fatto. */
  mealId: string | null;
}

/** Scrivere una ricetta propria, modificarne una, o scegliere gli ingredienti di un pasto del piano. */
export type EditRecipeRequest = { mode: 'new' } | { mode: 'edit'; recipe: Recipe } | { mode: 'meal'; mealId: string };

export interface ProductRequest {
  /** `new`: prodotto nuovo; `edit`: modifica di uno in dispensa. */
  mode: 'new' | 'edit';
  draft: ProductDraft;
  itemId?: string;
  /** Frase sopra il modulo (es. cosa non si leggeva nella foto). */
  hint?: string;
  /** Dopo il salvataggio si toglie dalla spesa questa riga (prodotto comprato). */
  shoppingId?: string;
  /** Chi ha letto la foto (modello di Gemini e secondi). */
  aiInfo?: string;
}

export const sheets = $state({
  product: null as ProductRequest | null,
  multi: null as { drafts: ProductDraft[]; note: string; shoppingIds?: string[]; aiInfo?: string } | null,
  settings: false,
  stats: false,
  aiKey: false,
  recipe: null as Recipe | null,
  /** Il pasto del piano da cui è stata aperta la ricetta (con "L'ho cucinata" si segna fatto). */
  recipeMealId: null as string | null,
  cooked: null as CookedRequest | null,
  editRecipe: null as EditRecipeRequest | null,
  meal: null as MealRequest | null,
  plan: null as PlanRequest | null,
  planAi: false,
});

/** Chiude tutti i fogli (per esempio quando si apre l'app da una notifica). */
export function closeAllSheets(): void {
  sheets.product = null;
  sheets.multi = null;
  sheets.settings = false;
  sheets.stats = false;
  sheets.aiKey = false;
  sheets.recipe = null;
  sheets.recipeMealId = null;
  sheets.cooked = null;
  sheets.editRecipe = null;
  sheets.meal = null;
  sheets.plan = null;
  sheets.planAi = false;
}

export function anySheetOpen(): boolean {
  return !!(
    sheets.product ||
    sheets.multi ||
    sheets.settings ||
    sheets.stats ||
    sheets.aiKey ||
    sheets.recipe ||
    sheets.cooked ||
    sheets.editRecipe ||
    sheets.meal ||
    sheets.plan ||
    sheets.planAi
  );
}

/** Apre una ricetta; `mealId` se viene dal piano dei pasti. */
export function openRecipe(recipe: Recipe, mealId: string | null = null): void {
  sheets.recipeMealId = mealId;
  sheets.recipe = recipe;
}

export async function initApp(): Promise<void> {
  app.settings = await loadSettings(db);
  app.aiKey = await getAiKey(db);
  await pruneMeals(db, addDays(app.today, -MEALS_KEEP_DAYS)).catch(() => 0);
  await Promise.all([reloadItems(false), reloadShopping(), reloadTemplates(), loadMeals()]);
  await relinkMeals();
  app.ready = true;
  scheduleNotifications();
  syncWidgets();
}

async function loadMeals(): Promise<void> {
  app.meals = await mealsBetween(db, addDays(app.today, -MEALS_KEEP_DAYS), '9999-12-31');
}

/** Ricarica il piano dei pasti (e aggiorna i widget). */
export async function reloadMeals(): Promise<void> {
  await loadMeals();
  await relinkMeals();
  syncWidgets();
}

/**
 * I pasti ancora da fare si ricollegano alla dispensa: gli ingredienti "da comprare" che ora ci sono
 * non mancano più (e risultano "In programma"), quelli finiti e ricomprati tornano collegati.
 */
async function relinkMeals(): Promise<void> {
  const changed = mealsToRelink($state.snapshot(app.meals) as Meal[], app.items, app.today);
  if (!changed.length) return;
  try {
    await saveMeals(db, changed);
    await loadMeals();
  } catch {
    // Si riprova alla prossima modifica: intanto i conti si fanno lo stesso con la dispensa di adesso.
  }
}

/** "Trascina in giù per aggiornare": rilegge tutto dal telefono e rimette in pari pasti, avvisi e widget. */
export async function refreshAll(): Promise<void> {
  tickToday();
  await Promise.all([reloadItems(false), reloadShopping(), reloadTemplates(), loadMeals()]);
  await relinkMeals();
  scheduleNotifications();
  lastWidget = '';
  syncWidgets();
}

// ---------- Widget ----------

let widgetTimer: ReturnType<typeof setTimeout> | undefined;
let lastWidget = '';

/** Passa ai widget della schermata Home i prodotti e i pasti, poco dopo l'ultima modifica. */
export function syncWidgets(): void {
  clearTimeout(widgetTimer);
  widgetTimer = setTimeout(() => {
    if (!app.ready || !app.settings.onboarded) return;
    const data = widgetData($state.snapshot(app.items) as Item[], $state.snapshot(app.meals) as Meal[], app.today);
    const key = JSON.stringify(data);
    if (key === lastWidget) return;
    lastWidget = key;
    pushWidgets(data).catch(() => {
      // I widget sono un extra: se l'invio non riesce si riprova alla prossima modifica.
      lastWidget = '';
    });
  }, 800);
}

export async function updateSettings(change: (s: Settings) => void): Promise<void> {
  change(app.settings);
  await saveSettings(db, app.settings);
}

/** A mezzanotte "oggi" cambia (colori e testi si aggiornano). */
export function tickToday(): void {
  const now = todayKey();
  if (now !== app.today) {
    app.today = now;
    syncWidgets();
  }
}

// ---------- Avvisi ----------

let notifyTimer: ReturnType<typeof setTimeout> | undefined;

/** Rifà gli avvisi delle scadenze poco dopo l'ultima modifica. */
export function scheduleNotifications(): void {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    rescheduleExpiryNotifications($state.snapshot(app.items) as Item[], $state.snapshot(app.settings) as Settings).catch((e: unknown) =>
      console.warn('Avvisi non programmati', e),
    );
  }, 1200);
}

// ---------- Dati ----------

export async function reloadItems(reschedule = true): Promise<void> {
  app.items = await allItems(db);
  if (reschedule) scheduleNotifications();
  if (app.ready) await relinkMeals();
  syncWidgets();
}

export async function reloadShopping(): Promise<void> {
  app.shopping = await allShopping(db);
}

export async function reloadTemplates(): Promise<void> {
  app.templates = await recentTemplates(db, 16);
}

/** Salva i prodotti nuovi confermati. */
export async function addDrafts(drafts: ProductDraft[]): Promise<Item[]> {
  const now = new Date().toISOString();
  const saved: Item[] = [];
  for (const d of drafts) {
    const item = itemFromDraft(d, now);
    await saveItem(db, item, app.today);
    saved.push(item);
  }
  await Promise.all([reloadItems(), reloadTemplates()]);
  return saved;
}

/** Salva le modifiche a un prodotto in dispensa. */
export async function saveEdit(id: string, draft: ProductDraft): Promise<void> {
  const current = app.items.find((i) => i.id === id);
  if (!current) return;
  await saveItem(db, applyDraft($state.snapshot(current) as Item, draft, new Date().toISOString()), app.today);
  await Promise.all([reloadItems(), reloadTemplates()]);
}

export async function changeItem(id: string, change: Partial<Item>): Promise<void> {
  await updateItem(db, id, change);
  await reloadItems();
}

const OUTCOME_TEXT: Record<Outcome, string> = { consumato: 'finito', buttato: 'buttato' };

/** Toglie un prodotto (finito o buttato) con "Annulla". */
export async function finishItem(item: Item, outcome: Outcome): Promise<void> {
  try {
    void tapFeedback(outcome === 'consumato' ? 'medium' : 'light');
    const removal = await removeItem(db, $state.snapshot(item) as Item, outcome, app.today);
    await reloadItems();
    showUndoToast(`${item.name}: ${OUTCOME_TEXT[outcome]}`, async () => {
      await undoRemoval(db, removal);
      await reloadItems();
    });
  } catch (e) {
    reportError(e);
  }
}

/** Mette un prodotto in cima alla spesa. */
export async function addToShopping(name: string, note = ''): Promise<void> {
  try {
    const existed = await addShopping(db, name, note);
    await reloadShopping();
    void tapFeedback();
    showToast(existed ? `${name} è già nella spesa: l’ho messo in cima` : `${name} aggiunto in cima alla spesa`);
  } catch (e) {
    reportError(e);
  }
}

export function hasAiKey(): boolean {
  return app.aiKey.trim().length > 0;
}
