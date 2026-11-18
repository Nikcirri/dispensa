// Collegamento al plugin Android "Widgets" (android/app/src/main/java/.../widgets/WidgetsPlugin.java):
// - passa ai widget i prodotti da usare presto e i pasti in programma;
// - avvisa quando l'app viene aperta toccando un widget.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { WidgetData } from '../logic/widget';
import { isNative } from '../platform';

/** Cosa è stato toccato: il widget dei prodotti, il suo +, oppure il widget dei pasti. */
export type WidgetAction = 'dispensa' | 'aggiungi' | 'pasti';

interface WidgetsPlugin {
  setData(data: WidgetData): Promise<void>;
  addListener(event: 'widgetAction', handler: (e: { action: string }) => void): Promise<PluginListenerHandle>;
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
    if (e.action === 'dispensa' || e.action === 'aggiungi' || e.action === 'pasti') handler(e.action);
  }).catch(() => undefined);
}
