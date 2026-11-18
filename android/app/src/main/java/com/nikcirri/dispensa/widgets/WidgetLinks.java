package com.nikcirri.dispensa.widgets;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import com.nikcirri.dispensa.MainActivity;

/**
 * I tocchi sui widget che aprono l'app: sulla Dispensa, sulla fotocamera (il + dei prodotti)
 * oppure sul piano dei Pasti. WidgetsPlugin legge l'azione e avvisa l'app.
 */
final class WidgetLinks {

    static final String ACTION_PANTRY = "com.nikcirri.dispensa.widget.OPEN_PANTRY";
    static final String ACTION_ADD = "com.nikcirri.dispensa.widget.ADD";
    static final String ACTION_MEALS = "com.nikcirri.dispensa.widget.OPEN_MEALS";

    private WidgetLinks() {}

    /** Apre l'app sulla scheda dell'azione (una delle tre sopra). */
    static PendingIntent openApp(Context context, String action) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.setAction(action);
        int requestCode = ACTION_ADD.equals(action) ? 2 : ACTION_MEALS.equals(action) ? 3 : 1;
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Il nome che l'app conosce per l'azione di questo intent; null se l'intent non arriva da un widget. */
    static String appAction(Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PANTRY.equals(action)) return "dispensa";
        if (ACTION_ADD.equals(action)) return "aggiungi";
        if (ACTION_MEALS.equals(action)) return "pasti";
        return null;
    }
}
