package com.nikcirri.dispensa.widgets;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * Ridisegna i widget quando cambia il giorno (i giorni alle scadenze e "oggi/domani" dei pasti si spostano).
 * Non è raggiungibile da altre app (exported="false" nel manifest): solo da questa app e da Android.
 */
public class WidgetRefreshReceiver extends BroadcastReceiver {

    /** Giorno cambiato (sveglia normale). */
    static final String ACTION_REFRESH = "com.nikcirri.dispensa.widget.REFRESH";
    /** Lo stesso, con la sveglia che suona anche a telefono fermo da ore. */
    static final String ACTION_REFRESH_IDLE = "com.nikcirri.dispensa.widget.REFRESH_IDLE";

    private static final long TEN_MINUTES = 10 * 60 * 1000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        // Mezzanotte passata, oppure ora o fuso orario cambiati.
        refreshAll(context);
    }

    /** Ridisegna tutti i widget e prepara la sveglia della prossima mezzanotte. */
    static void refreshAll(Context context) {
        ProductsWidget.updateAll(context);
        MealsWidget.updateAll(context);
        scheduleMidnight(context);
    }

    private static PendingIntent pending(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, WidgetRefreshReceiver.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * Prepara l'aggiornamento dei widget per la prossima mezzanotte (sveglie non esatte: nessun permesso in più).
     * Due sveglie, come nell'app Nutrizione: una normale entro dieci minuti da mezzanotte e una che suona
     * anche a telefono fermo da ore. In più Android ridisegna i widget ogni 30 minuti (updatePeriodMillis).
     * Senza widget sulla schermata Home le sveglie si spengono.
     */
    static void scheduleMidnight(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent refresh = pending(context, ACTION_REFRESH, 0);
        PendingIntent refreshIdle = pending(context, ACTION_REFRESH_IDLE, 1);
        if (ProductsWidget.ids(context).length == 0 && MealsWidget.ids(context).length == 0) {
            alarms.cancel(refresh);
            alarms.cancel(refreshIdle);
            return;
        }
        long midnight = LocalDate.now().plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
        alarms.setWindow(AlarmManager.RTC_WAKEUP, midnight + 1000L, TEN_MINUTES, refresh);
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, midnight + 5000L, refreshIdle);
    }
}
