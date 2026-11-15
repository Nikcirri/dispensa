// Avvisi delle scadenze: una notifica al giorno (all'ora scelta) solo nei giorni in cui qualcosa scade
// oggi o domani. Si programmano i prossimi 14 giorni e si rifanno a ogni modifica della dispensa.
import type { Item } from '../types';
import { addDays, dateKey, keyToDate } from './dates';
import { effectiveExpiry } from './expiry';
import { joinNames } from './text';

export const NOTIFY_BASE_ID = 2000;
export const NOTIFY_DAYS = 14;

export interface PlannedNotification {
  id: number;
  at: Date;
  title: string;
  body: string;
}

/** Tutti gli id che l'app può usare per gli avvisi (per cancellarli). */
export function allNotificationIds(): number[] {
  return Array.from({ length: NOTIFY_DAYS }, (_, i) => NOTIFY_BASE_ID + i);
}

export function planExpiryNotifications(items: readonly Item[], now: Date, hour: number, minute: number): PlannedNotification[] {
  const today = dateKey(now);
  const byDay = new Map<string, string[]>();
  for (const i of items) {
    const e = effectiveExpiry(i);
    if (!e) continue;
    const arr = byDay.get(e) ?? [];
    arr.push(i.name);
    byDay.set(e, arr);
  }
  const out: PlannedNotification[] = [];
  for (let d = 0; d < NOTIFY_DAYS; d++) {
    const day = addDays(today, d);
    const at = keyToDate(day, hour, minute);
    if (at.getTime() <= now.getTime() + 60_000) continue;
    const todayNames = byDay.get(day) ?? [];
    const tomorrowNames = byDay.get(addDays(day, 1)) ?? [];
    if (!todayNames.length && !tomorrowNames.length) continue;
    let title: string;
    let body: string;
    if (todayNames.length) {
      title = `${todayNames.length === 1 ? 'Scade oggi' : 'Scadono oggi'}: ${joinNames(todayNames)}`;
      body = tomorrowNames.length
        ? `Domani: ${joinNames(tomorrowNames)}. Tocca per un’idea di ricetta.`
        : 'Tocca per vedere cosa cucinare e non sprecarlo.';
    } else {
      title = `${tomorrowNames.length === 1 ? 'Domani scade' : 'Domani scadono'}: ${joinNames(tomorrowNames)}`;
      body = 'Tocca per un’idea di ricetta con quello che hai.';
    }
    out.push({ id: NOTIFY_BASE_ID + d, at, title, body });
  }
  return out;
}
