// Dati per i widget della schermata Home: i prodotti da usare presto, i pasti in programma e la lista della spesa.
// Il telefono conta da solo i giorni che mancano (così a mezzanotte i widget restano giusti anche ad app chiusa).
import type { Item, ShoppingItem } from '../types';
import { effectiveExpiry } from './expiry';
import { widgetMeals, type Meal, type MealSlot } from './meals';
import { sortItems } from './pantry';
import { detailText, sortShopping } from './shopping';

export interface WidgetProduct {
  name: string;
  emoji: string;
  /** Data che conta (AAAA-MM-GG) oppure "" se il prodotto non ha scadenza. */
  expiry: string;
  /** "tmc" = preferibilmente entro: oltre la data non è un allarme. */
  kind: 'scadenza' | 'tmc';
}

export interface WidgetMeal {
  date: string;
  slot: MealSlot;
  title: string;
  emoji: string;
  done: boolean;
}

export interface WidgetShopping {
  id: string;
  name: string;
  emoji: string;
  /** Nota e specifiche in una riga ("1 kg · 2 × penne rigate"), oppure "". */
  details: string;
  done: boolean;
}

export interface WidgetData {
  today: string;
  /** Prodotti in dispensa, chi scade prima per primo (al massimo 12). */
  products: WidgetProduct[];
  /** Quanti prodotti ci sono in tutto. */
  total: number;
  meals: WidgetMeal[];
  /** Lista della spesa come nell'app: prima da comprare, poi nel carrello (al massimo 30). */
  shopping: WidgetShopping[];
}

export const WIDGET_MAX_PRODUCTS = 12;
export const WIDGET_MAX_SHOPPING = 30;

export function widgetShopping(list: readonly ShoppingItem[]): WidgetShopping[] {
  return sortShopping(list)
    .slice(0, WIDGET_MAX_SHOPPING)
    .map((s) => ({
      id: s.id,
      name: s.name.slice(0, 60),
      emoji: s.emoji || '🛒',
      details: [s.note.trim(), ...(s.details ?? []).map(detailText)].filter(Boolean).join(' · ').slice(0, 160),
      done: s.done,
    }));
}

export function widgetData(items: readonly Item[], meals: readonly Meal[], shopping: readonly ShoppingItem[], today: string): WidgetData {
  const products = sortItems(items, 'scadenza')
    .slice(0, WIDGET_MAX_PRODUCTS)
    .map((i) => ({ name: i.name.slice(0, 60), emoji: i.emoji || '🛒', expiry: effectiveExpiry(i) ?? '', kind: i.expiryKind }));
  return { today, products, total: items.length, meals: widgetMeals(meals, today), shopping: widgetShopping(shopping) };
}

export interface WidgetShoppingChange {
  id: string;
  done: boolean;
}

/** Le spunte fatte nel widget che cambiano davvero qualcosa (prodotti ancora in lista, con la spunta diversa). */
export function shoppingChangesToApply(list: readonly ShoppingItem[], changes: readonly WidgetShoppingChange[]): WidgetShoppingChange[] {
  const byId = new Map(list.map((s) => [s.id, s]));
  return changes.filter((c) => {
    const s = byId.get(c.id);
    return s !== undefined && s.done !== c.done;
  });
}
