package com.nikcirri.dispensa.widgets;

import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;
import org.json.JSONObject;

/**
 * Collega l'app ai widget della schermata Home:
 * - `setData`: l'app manda i prodotti da usare presto, i pasti in programma e la lista della spesa, e i widget si ridisegnano;
 * - `takeShoppingChanges`: le spunte fatte nel widget "Spesa", che l'app salva;
 * - evento `widgetAction`: avvisa l'app quando viene aperta toccando un widget;
 * - evento `shoppingChanged`: un prodotto è stato spuntato nel widget mentre l'app era aperta in sottofondo.
 */
@CapacitorPlugin(name = "Widgets")
public class WidgetsPlugin extends Plugin {

    /** Il plugin dell'app aperta (null se l'app non c'è): serve al widget della spesa per avvisarla. */
    private static volatile WidgetsPlugin active;

    @Override
    public void load() {
        active = this;
        // A ogni apertura dell'app i widget si rimettono in pari (giorno giusto, sveglie di mezzanotte attive).
        WidgetRefreshReceiver.refreshAll(getContext().getApplicationContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (active == this) active = null;
        super.handleOnDestroy();
    }

    /** Spunta fatta nel widget "Spesa": se l'app è aperta (anche in sottofondo) la prende subito. */
    static void shoppingChanged() {
        WidgetsPlugin plugin = active;
        if (plugin != null) plugin.notifyListeners("shoppingChanged", new JSObject());
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
        ShoppingWidget.updateAll(context);
        call.resolve();
    }

    @PluginMethod
    public void takeShoppingChanges(PluginCall call) {
        JSONObject pending = WidgetStore.takeShoppingPending(getContext().getApplicationContext());
        JSArray changes = new JSArray();
        Iterator<String> keys = pending.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            JSObject change = new JSObject();
            change.put("id", id);
            change.put("done", pending.optBoolean(id));
            changes.put(change);
        }
        JSObject result = new JSObject();
        result.put("changes", changes);
        call.resolve(result);
    }
}
