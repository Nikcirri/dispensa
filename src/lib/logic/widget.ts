// Dati per i widget della schermata Home: i prodotti da usare presto e i pasti in programma.
// Il telefono conta da solo i giorni che mancano (così a mezzanotte i widget restano giusti anche ad app chiusa).
import type { Item } from '../types';
import { effectiveExpiry } from './expiry';
import { widgetMeals, type Meal, type MealSlot } from './meals';
import { sortItems } from './pantry';

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

export interface WidgetData {
  today: string;
  /** Prodotti in dispensa, chi scade prima per primo (al massimo 12). */
  products: WidgetProduct[];
  /** Quanti prodotti ci sono in tutto. */
  total: number;
  meals: WidgetMeal[];
}

export const WIDGET_MAX_PRODUCTS = 12;

export function widgetData(items: readonly Item[], meals: readonly Meal[], today: string): WidgetData {
  const products = sortItems(items, 'scadenza')
    .slice(0, WIDGET_MAX_PRODUCTS)
    .map((i) => ({ name: i.name.slice(0, 60), emoji: i.emoji || '🛒', expiry: effectiveExpiry(i) ?? '', kind: i.expiryKind }));
  return { today, products, total: items.length, meals: widgetMeals(meals, today) };
}
