package com.nikcirri.dispensa.widgets;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Tocco su un prodotto del widget "Spesa": lo spunta (o toglie la spunta) e ridisegna il widget subito.
 * La modifica resta in attesa (WidgetStore) finché l'app non la prende e la salva; se l'app è aperta in sottofondo
 * la avvisa subito. Non è raggiungibile da altre app (exported="false" nel manifest): ci arrivano solo i tocchi del widget.
 */
public class ShoppingToggleReceiver extends BroadcastReceiver {

    static final String ACTION_TOGGLE = "com.nikcirri.dispensa.widget.TOGGLE_SHOPPING";
    static final String EXTRA_ID = "id";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_TOGGLE.equals(intent.getAction())) return;
        Context app = context.getApplicationContext();
        WidgetStore.toggleShopping(app, intent.getStringExtra(EXTRA_ID));
        ShoppingWidget.updateAll(app);
        WidgetsPlugin.shoppingChanged();
    }
}
