package com.nikcirri.dispensa.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.util.ArrayMap;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import com.nikcirri.dispensa.R;
import java.util.Map;

/**
 * Widget "Spesa" della schermata Home: la lista della spesa, prima quello da comprare e poi quello già nel carrello.
 * Toccando un prodotto si spunta (o si toglie la spunta) senza aprire l'app: l'app lo saprà appena si apre
 * (ShoppingToggleReceiver, WidgetsPlugin.takeShoppingChanges). Il + apre la Spesa per scrivere, il resto apre la Spesa.
 */
public class ShoppingWidget extends AppWidgetProvider {

    private static final float MIN_DP = 40f;
    /** Altezze (dp) per cui si prepara un disegno: la schermata Home sceglie quello giusto. */
    private static final float[] HEIGHTS = {100f, 130f, 160f, 190f, 220f, 250f, 280f, 310f, 340f, 370f, 400f, 430f};
    /** Spazio dell'intestazione e di una riga (dp), per sapere quante righe ci stanno. */
    private static final float HEADER_DP = 66f;
    private static final float ROW_DP = 36f;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        render(context, manager, id);
    }

    static int[] ids(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        return manager == null ? new int[0] : manager.getAppWidgetIds(new ComponentName(context, ShoppingWidget.class));
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        for (int id : ids(context)) render(context, manager, id);
    }

    static int rowsFor(float heightDp) {
        int rows = (int) Math.floor((heightDp - HEADER_DP) / ROW_DP);
        return Math.max(1, Math.min(WidgetStore.MAX_SHOPPING, rows));
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
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_shopping);
        views.removeAllViews(R.id.shop_rows);

        int todo = 0;
        for (WidgetStore.ShopItem s : data.shopping) if (!s.done) todo++;
        int total = data.shopping.size();
        String subtitle;
        if (!data.known || total == 0) subtitle = "";
        else if (todo == 0) subtitle = context.getString(R.string.widget_shopping_all_done);
        else subtitle = context.getResources().getQuantityString(R.plurals.widget_shopping_todo, todo, todo);
        views.setTextViewText(R.id.shop_subtitle, subtitle);
        views.setViewVisibility(R.id.shop_subtitle, subtitle.isEmpty() ? View.GONE : View.VISIBLE);

        int shown = Math.min(rows, total);
        // Se non ci stanno tutti, l'ultima riga dice quanti altri ce ne sono.
        int more = total - shown;
        if (more > 0 && shown == rows && shown > 1) {
            shown--;
            more = total - shown;
        }
        for (int i = 0; i < shown; i++) views.addView(R.id.shop_rows, row(context, data.shopping.get(i)));
        if (more > 0 && shown > 0) {
            views.setTextViewText(R.id.shop_more, context.getString(R.string.widget_shopping_more, more));
            views.setViewVisibility(R.id.shop_more, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.shop_more, View.GONE);
        }

        if (shown == 0) {
            views.setTextViewText(R.id.shop_empty, context.getString(data.known ? R.string.widget_shopping_empty : R.string.widget_open_app));
            views.setViewVisibility(R.id.shop_empty, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.shop_empty, View.GONE);
        }

        views.setOnClickPendingIntent(android.R.id.background, WidgetLinks.openApp(context, WidgetLinks.ACTION_SHOPPING));
        views.setOnClickPendingIntent(R.id.shop_add, WidgetLinks.openApp(context, WidgetLinks.ACTION_SHOPPING_ADD));
        return views;
    }

    /** Una riga: cerchio da spuntare, icona, nome (barrato se già nel carrello) e specifiche. Toccandola si spunta. */
    private static RemoteViews row(Context context, WidgetStore.ShopItem s) {
        RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_shopping_row);
        row.setViewVisibility(R.id.shop_check_on, s.done ? View.VISIBLE : View.GONE);
        row.setViewVisibility(R.id.shop_check_off, s.done ? View.GONE : View.VISIBLE);
        row.setTextViewText(R.id.shop_emoji, s.emoji.isEmpty() ? "🛒" : s.emoji);
        if (s.done) {
            SpannableString name = new SpannableString(s.name);
            name.setSpan(new StrikethroughSpan(), 0, name.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            row.setTextViewText(R.id.shop_name_done, name);
            row.setViewVisibility(R.id.shop_name_done, View.VISIBLE);
            row.setViewVisibility(R.id.shop_name, View.GONE);
        } else {
            row.setTextViewText(R.id.shop_name, s.name);
            row.setViewVisibility(R.id.shop_name, View.VISIBLE);
            row.setViewVisibility(R.id.shop_name_done, View.GONE);
        }
        row.setTextViewText(R.id.shop_details, s.details);
        row.setViewVisibility(R.id.shop_details, s.details.isEmpty() ? View.GONE : View.VISIBLE);
        row.setContentDescription(R.id.shop_row, context.getString(s.done ? R.string.widget_shopping_untick : R.string.widget_shopping_tick, s.name));
        row.setOnClickPendingIntent(R.id.shop_row, WidgetLinks.toggleShopping(context, s.id));
        return row;
    }
}
