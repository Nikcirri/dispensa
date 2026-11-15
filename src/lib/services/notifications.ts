// Avvisi delle scadenze (notifiche locali, programmate sul telefono: funzionano anche ad app chiusa).
import { LocalNotifications } from '@capacitor/local-notifications';
import { allNotificationIds, planExpiryNotifications } from '../logic/notify';
import { isNative } from '../platform';
import type { Item, Settings } from '../types';

const CHANNEL_ID = 'scadenze';
let channelReady = false;

async function ensureChannel(): Promise<void> {
  if (channelReady) return;
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Scadenze',
    description: 'Avviso quando un prodotto scade oggi o domani',
    importance: 4,
    visibility: 1,
  });
  channelReady = true;
}

export async function notificationsAllowed(): Promise<boolean> {
  if (!isNative()) return false;
  return (await LocalNotifications.checkPermissions()).display === 'granted';
}

/** Chiede il permesso (Android 13+). true se le notifiche si possono mostrare. */
export async function askNotificationPermission(): Promise<boolean> {
  if (!isNative()) return false;
  const current = await LocalNotifications.checkPermissions();
  if (current.display === 'granted') return true;
  const asked = await LocalNotifications.requestPermissions();
  return asked.display === 'granted';
}

/** Rifà gli avvisi dei prossimi 14 giorni (si chiama a ogni modifica della dispensa). */
export async function rescheduleExpiryNotifications(items: readonly Item[], settings: Settings): Promise<void> {
  if (!isNative()) return;
  await LocalNotifications.cancel({ notifications: allNotificationIds().map((id) => ({ id })) });
  if (!settings.notify.enabled) return;
  if (!(await notificationsAllowed())) return;
  const plan = planExpiryNotifications(items, new Date(), settings.notify.hour, settings.notify.minute);
  if (!plan.length) return;
  await ensureChannel();
  await LocalNotifications.schedule({
    notifications: plan.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      schedule: { at: p.at, allowWhileIdle: true },
      channelId: CHANNEL_ID,
    })),
  });
}

/** Tocco sulla notifica: l'app si apre (il chiamante porta alla scheda giusta). */
export function onNotificationTap(handler: () => void): void {
  if (!isNative()) return;
  void LocalNotifications.addListener('localNotificationActionPerformed', () => handler());
}
