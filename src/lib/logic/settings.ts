// Impostazioni: valori iniziali e lettura sicura (da memoria o da backup).
import type { Settings } from '../types';
import { DEFAULT_STAPLES } from './recipes';

export function defaultSettings(): Settings {
  return {
    onboarded: false,
    notify: { enabled: true, hour: 18, minute: 0 },
    recipes: { servings: 2, vegetarian: false, lactoseFree: false, glutenFree: false, staples: [...DEFAULT_STAPLES] },
    updates: { lastCheck: null, latestVersion: null, apkUrl: null, pageUrl: null },
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const int = (v: unknown, min: number, max: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);

export function sanitizeSettings(v: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(v)) return d;
  const n = isObj(v.notify) ? v.notify : {};
  const r = isObj(v.recipes) ? v.recipes : {};
  const u = isObj(v.updates) ? v.updates : {};
  const staples = Array.isArray(r.staples)
    ? r.staples.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 30)
    : d.recipes.staples;
  return {
    onboarded: bool(v.onboarded, d.onboarded),
    notify: {
      enabled: bool(n.enabled, d.notify.enabled),
      hour: int(n.hour, 0, 23, d.notify.hour),
      minute: int(n.minute, 0, 59, d.notify.minute),
    },
    recipes: {
      servings: int(r.servings, 1, 12, d.recipes.servings),
      vegetarian: bool(r.vegetarian, false),
      lactoseFree: bool(r.lactoseFree, false),
      glutenFree: bool(r.glutenFree, false),
      staples,
    },
    updates: {
      lastCheck: strOrNull(u.lastCheck),
      latestVersion: strOrNull(u.latestVersion),
      apkUrl: strOrNull(u.apkUrl),
      pageUrl: strOrNull(u.pageUrl),
    },
  };
}
