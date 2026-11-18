package com.nikcirri.dispensa.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.util.ArrayMap;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import com.nikcirri.dispensa.R;
import java.util.Map;

/**
 * Widget "Dispensa" della schermata Home: i prodotti in ordine di scadenza, con il bollino colorato
 * (rosso oggi e domani, arancione entro 5 giorni, verde più avanti, ambra per un "preferibilmente entro" passato).
 * Più è alto, più prodotti mostra. Toccandolo si apre la Dispensa; il + apre la fotocamera per aggiungere.
 */
public class ProductsWidget extends AppWidgetProvider {

    private static final float MIN_DP = 40f;
    /** Altezze (dp) per cui si prepara un disegno: la schermata Home sceglie quello giusto. */
    private static final float[] HEIGHTS = {100f, 130f, 160f, 190f, 220f, 250f, 280f, 310f, 340f, 370f};
    /** Spazio dell'intestazione e di una riga (dp), per sapere quante righe ci stanno. */
    private static final float HEADER_DP = 66f;
    private static final float ROW_DP = 31f;
    /** Giorni entro cui il bollino è arancione (come ORANGE_MAX_DAYS nell'app). */
    private static final long ORANGE_MAX_DAYS = 5;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id);
        WidgetRefreshReceiver.scheduleMidnight(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        render(context, manager, id);
    }

    @Override
    public void onDisabled(Context context) {
        WidgetRefreshReceiver.scheduleMidnight(context);
    }

    static int[] ids(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        return manager == null ? new int[0] : manager.getAppWidgetIds(new ComponentName(context, ProductsWidget.class));
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        for (int id : ids(context)) render(context, manager, id);
    }

    static int rowsFor(float heightDp) {
        int rows = (int) Math.floor((heightDp - HEADER_DP) / ROW_DP);
        return Math.max(1, Math.min(WidgetStore.MAX_PRODUCTS, rows));
    }

    private static void render(Context context, AppWidgetManager manager, int id) {
        WidgetStore.Data data = WidgetStore.load(context);
        RemoteViews views;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Map<SizeF, RemoteViews> sizes = new ArrayMap<>();
            for (float h : HEIGHTS) sizes.put(new SizeF(MIN_DP, h), build(context, data, rowsFor(h)));
            views = new RemoteViews(sizes);
        } else {
            Bundle options = manager.getAppWidgetOptions(id);
            int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            views = build(context, data, rowsFor(height > 0 ? height : 160f));
        }
        manager.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context context, WidgetStore.Data data, int rows) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_products);
        views.removeAllViews(R.id.prod_rows);

        int urgent = 0;
        for (WidgetStore.Product p : data.products) {
            if (p.expiry == null) continue;
            long d = WidgetStore.daysUntil(p.expiry);
            if (d <= 1 && !(p.tmc && d < 0)) urgent++;
        }
        String subtitle;
        if (!data.known) subtitle = "";
        else if (urgent > 0) subtitle = context.getResources().getQuantityString(R.plurals.widget_products_urgent, urgent, urgent);
        else subtitle = context.getResources().getQuantityString(R.plurals.widget_products_total, data.total, data.total);
        views.setTextViewText(R.id.prod_subtitle, subtitle);
        views.setViewVisibility(R.id.prod_subtitle, subtitle.isEmpty() ? View.GONE : View.VISIBLE);

        int shown = Math.min(rows, data.products.size());
        // Se non ci stanno tutti, l'ultima riga dice quanti altri ce ne sono.
        int more = data.total - shown;
        if (more > 0 && shown == rows && shown > 1) {
            shown--;
            more = data.total - shown;
        }
        for (int i = 0; i < shown; i++) views.addView(R.id.prod_rows, row(context, data.products.get(i)));
        if (more > 0 && shown > 0) {
            views.setTextViewText(R.id.prod_more, context.getString(R.string.widget_products_more, more));
            views.setViewVisibility(R.id.prod_more, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.prod_more, View.GONE);
        }

        if (shown == 0) {
            views.setTextViewText(R.id.prod_empty, context.getString(data.known ? R.string.widget_products_empty : R.string.widget_open_app));
            views.setViewVisibility(R.id.prod_empty, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.prod_empty, View.GONE);
        }

        views.setOnClickPendingIntent(android.R.id.background, WidgetLinks.openApp(context, WidgetLinks.ACTION_PANTRY));
        views.setOnClickPendingIntent(R.id.prod_add, WidgetLinks.openApp(context, WidgetLinks.ACTION_ADD));
        return views;
    }

    /** Una riga: icona, nome e bollino (uno dei cinque colori preparati nel disegno, gli altri nascosti). */
    private static RemoteViews row(Context context, WidgetStore.Product p) {
        RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_product_row);
        row.setTextViewText(R.id.row_emoji, p.emoji.isEmpty() ? "🛒" : p.emoji);
        row.setTextViewText(R.id.row_name, p.name);
        int[] badges = {R.id.badge_red, R.id.badge_amber, R.id.badge_green, R.id.badge_grey, R.id.badge_expired};
        for (int b : badges) row.setViewVisibility(b, View.GONE);
        int badge;
        String text;
        if (p.expiry == null) {
            badge = R.id.badge_grey;
            text = context.getString(R.string.widget_badge_none);
        } else {
            long d = WidgetStore.daysUntil(p.expiry);
            text = badgeText(context, d, p.tmc);
            if (d < 0) badge = p.tmc ? R.id.badge_amber : R.id.badge_expired;
            else if (d <= 1) badge = R.id.badge_red;
            else if (d <= ORANGE_MAX_DAYS) badge = R.id.badge_amber;
            else badge = R.id.badge_green;
        }
        row.setTextViewText(badge, text);
        row.setViewVisibility(badge, View.VISIBLE);
        return row;
    }

    /** Lo stesso testo del bollino nell'app ("Oggi", "Domani", "3 giorni", "2 sett.", "5 mesi"…). */
    static String badgeText(Context context, long days, boolean tmc) {
        if (days < 0) return context.getString(tmc ? R.string.widget_badge_tmc_past : R.string.widget_badge_expired);
        if (days == 0) return context.getString(R.string.widget_badge_today);
        if (days == 1) return context.getString(R.string.widget_badge_tomorrow);
        if (days < 14) return context.getString(R.string.widget_badge_days, days);
        if (days < 60) return context.getString(R.string.widget_badge_weeks, Math.round(days / 7.0));
        if (days < 730) return context.getString(R.string.widget_badge_months, Math.round(days / 30.4));
        return context.getString(R.string.widget_badge_years, Math.round(days / 365.0));
    }
}
