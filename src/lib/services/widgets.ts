// Collegamento al plugin Android "Widgets" (android/app/src/main/java/.../widgets/WidgetsPlugin.java):
// - passa ai widget i prodotti da usare presto, i pasti in programma e la lista della spesa;
// - prende le spunte fatte nel widget della spesa;
// - avvisa quando l'app viene aperta toccando un widget.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { WidgetData, WidgetShoppingChange } from '../logic/widget';
import { isNative } from '../platform';

/** Cosa è stato toccato: il widget dei prodotti, il suo +, il widget dei pasti, quello della spesa o il suo +. */
export type WidgetAction = 'dispensa' | 'aggiungi' | 'pasti' | 'spesa' | 'scrivi-spesa';

const ACTIONS: readonly string[] = ['dispensa', 'aggiungi', 'pasti', 'spesa', 'scrivi-spesa'];

interface WidgetsPlugin {
  setData(data: WidgetData): Promise<void>;
  takeShoppingChanges(): Promise<{ changes: WidgetShoppingChange[] }>;
  addListener(event: 'widgetAction', handler: (e: { action: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'shoppingChanged', handler: () => void): Promise<PluginListenerHandle>;
}

const Widgets = registerPlugin<WidgetsPlugin>('Widgets');

/** Aggiorna i widget (solo nell'app Android). */
export async function pushWidgets(data: WidgetData): Promise<void> {
  if (!isNative()) return;
  await Widgets.setData(data);
}

/**
 * Chiama `handler` quando l'app viene aperta da un widget.
 * Se il tocco è arrivato prima (app ancora chiusa), Android lo consegna appena ci si mette in ascolto.
 */
export function onWidgetAction(handler: (action: WidgetAction) => void): void {
  if (!isNative()) return;
  void Widgets.addListener('widgetAction', (e) => {
    if (ACTIONS.includes(e.action)) handler(e.action as WidgetAction);
  }).catch(() => undefined);
}

/** Le spunte fatte nel widget della spesa dall'ultima volta (poi il widget le dimentica: le salva l'app). */
export async function takeShoppingChanges(): Promise<WidgetShoppingChange[]> {
  if (!isNative()) return [];
  const res = await Widgets.takeShoppingChanges();
  return (res.changes ?? []).filter((c) => typeof c.id === 'string' && typeof c.done === 'boolean');
}

/** Chiama `handler` quando si spunta qualcosa nel widget della spesa mentre l'app è aperta in sottofondo. */
export function onWidgetShoppingChanged(handler: () => void): void {
  if (!isNative()) return;
  void Widgets.addListener('shoppingChanged', handler).catch(() => undefined);
}
