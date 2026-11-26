package com.nikcirri.dispensa.widgets;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import com.nikcirri.dispensa.MainActivity;

/**
 * I tocchi sui widget: quelli che aprono l'app (Dispensa, fotocamera, Pasti, Spesa, Spesa per scrivere),
 * che WidgetsPlugin passa all'app, e la spunta di un prodotto della spesa (ShoppingToggleReceiver, senza aprire l'app).
 */
final class WidgetLinks {

    static final String ACTION_PANTRY = "com.nikcirri.dispensa.widget.OPEN_PANTRY";
    static final String ACTION_ADD = "com.nikcirri.dispensa.widget.ADD";
    static final String ACTION_MEALS = "com.nikcirri.dispensa.widget.OPEN_MEALS";
    static final String ACTION_SHOPPING = "com.nikcirri.dispensa.widget.OPEN_SHOPPING";
    static final String ACTION_SHOPPING_ADD = "com.nikcirri.dispensa.widget.ADD_SHOPPING";

    private WidgetLinks() {}

    /** Apre l'app sulla scheda dell'azione (una di quelle sopra). */
    static PendingIntent openApp(Context context, String action) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.setAction(action);
        int requestCode;
        if (ACTION_ADD.equals(action)) requestCode = 2;
        else if (ACTION_MEALS.equals(action)) requestCode = 3;
        else if (ACTION_SHOPPING.equals(action)) requestCode = 4;
        else if (ACTION_SHOPPING_ADD.equals(action)) requestCode = 5;
        else requestCode = 1;
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Spunta un prodotto della spesa senza aprire l'app (ogni prodotto ha il suo tocco, distinto dall'indirizzo). */
    static PendingIntent toggleShopping(Context context, String id) {
        Intent intent = new Intent(context, ShoppingToggleReceiver.class);
        intent.setAction(ShoppingToggleReceiver.ACTION_TOGGLE);
        intent.setData(Uri.parse("dispensa-widget://spesa/" + Uri.encode(id)));
        intent.putExtra(ShoppingToggleReceiver.EXTRA_ID, id);
        return PendingIntent.getBroadcast(context, 100 + (id.hashCode() & 0xffff), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Il nome che l'app conosce per l'azione di questo intent; null se l'intent non arriva da un widget. */
    static String appAction(Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PANTRY.equals(action)) return "dispensa";
        if (ACTION_ADD.equals(action)) return "aggiungi";
        if (ACTION_MEALS.equals(action)) return "pasti";
        if (ACTION_SHOPPING.equals(action)) return "spesa";
        if (ACTION_SHOPPING_ADD.equals(action)) return "scrivi-spesa";
        return null;
    }
}
