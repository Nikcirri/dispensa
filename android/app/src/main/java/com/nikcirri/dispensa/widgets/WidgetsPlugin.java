package com.nikcirri.dispensa.widgets;

import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Collega l'app ai widget della schermata Home:
 * - `setData`: l'app manda i prodotti da usare presto e i pasti in programma, e i widget si ridisegnano;
 * - evento `widgetAction`: avvisa l'app quando viene aperta toccando un widget.
 */
@CapacitorPlugin(name = "Widgets")
public class WidgetsPlugin extends Plugin {

    @Override
    public void load() {
        // A ogni apertura dell'app i widget si rimettono in pari (giorno giusto, sveglie di mezzanotte attive).
        WidgetRefreshReceiver.refreshAll(getContext().getApplicationContext());
    }

    /** Capacitor chiama questo metodo sia all'avvio dell'app sia quando l'app già aperta riceve un nuovo intent. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String action = WidgetLinks.appAction(intent);
        if (action == null) return;
        // App riaperta dalle app recenti: l'intent è quello vecchio, il widget non è stato toccato adesso.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        // Segnato come già gestito, così non si ripete.
        intent.setAction(Intent.ACTION_MAIN);
        JSObject data = new JSObject();
        data.put("action", action);
        // "true": se l'app si sta ancora avviando, l'avviso resta in attesa finché non è pronta ad ascoltarlo.
        notifyListeners("widgetAction", data, true);
    }

    @PluginMethod
    public void setData(PluginCall call) {
        Context context = getContext().getApplicationContext();
        if (!WidgetStore.save(context, call.getData())) {
            call.reject("Dati del widget non validi");
            return;
        }
        ProductsWidget.updateAll(context);
        MealsWidget.updateAll(context);
        call.resolve();
    }
}
