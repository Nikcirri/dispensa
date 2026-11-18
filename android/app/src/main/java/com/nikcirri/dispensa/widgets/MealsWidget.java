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
import java.time.LocalDate;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Widget "Pasti" della schermata Home: pranzo e cena di oggi (e di domani, se è abbastanza alto).
 * I pasti già cucinati hanno la spunta. Toccandolo si apre il piano dei Pasti.
 */
public class MealsWidget extends AppWidgetProvider {

    private static final float MIN_DP = 40f;
    /** Da queste altezze (dp) si mostrano 2 e 3 giorni. */
    private static final float TWO_DAYS_DP = 170f;
    private static final float THREE_DAYS_DP = 270f;
    private static final Locale IT = Locale.ITALIAN;

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
        return manager == null ? new int[0] : manager.getAppWidgetIds(new ComponentName(context, MealsWidget.class));
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        for (int id : ids(context)) render(context, manager, id);
    }

    private static int daysFor(float heightDp) {
        if (heightDp >= THREE_DAYS_DP) return 3;
        if (heightDp >= TWO_DAYS_DP) return 2;
        return 1;
    }

    private static void render(Context context, AppWidgetManager manager, int id) {
        WidgetStore.Data data = WidgetStore.load(context);
        RemoteViews views;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Map<SizeF, RemoteViews> sizes = new ArrayMap<>();
            sizes.put(new SizeF(MIN_DP, MIN_DP), build(context, data, 1));
            sizes.put(new SizeF(MIN_DP, TWO_DAYS_DP), build(context, data, 2));
            sizes.put(new SizeF(MIN_DP, THREE_DAYS_DP), build(context, data, 3));
            views = new RemoteViews(sizes);
        } else {
            Bundle options = manager.getAppWidgetOptions(id);
            int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            views = build(context, data, daysFor(height > 0 ? height : 120f));
        }
        manager.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context context, WidgetStore.Data data, int days) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_meals);
        views.removeAllViews(R.id.meal_rows);
        LocalDate today = WidgetStore.today();
        boolean any = false;
        if (data.known) {
            for (int i = 0; i < days; i++) {
                LocalDate date = today.plusDays(i);
                RemoteViews day = new RemoteViews(context.getPackageName(), R.layout.widget_meal_day);
                day.setTextViewText(R.id.day_title, dayTitle(context, date, i));
                views.addView(R.id.meal_rows, day);
                any |= addSlot(context, views, data.meals, date, true);
                any |= addSlot(context, views, data.meals, date, false);
            }
        }
        if (!data.known) {
            views.setTextViewText(R.id.meal_hint, context.getString(R.string.widget_open_app));
            views.setViewVisibility(R.id.meal_hint, View.VISIBLE);
        } else if (!any) {
            views.setTextViewText(R.id.meal_hint, context.getString(R.string.widget_meals_empty));
            views.setViewVisibility(R.id.meal_hint, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.meal_hint, View.GONE);
        }
        views.setOnClickPendingIntent(android.R.id.background, WidgetLinks.openApp(context, WidgetLinks.ACTION_MEALS));
        views.setOnClickPendingIntent(R.id.meal_open, WidgetLinks.openApp(context, WidgetLinks.ACTION_MEALS));
        return views;
    }

    /** "Oggi · mercoledì 18", "Domani · giovedì 19", "Venerdì 20". */
    private static String dayTitle(Context context, LocalDate date, int offset) {
        String weekday = date.getDayOfWeek().getDisplayName(TextStyle.FULL, IT);
        String day = weekday + " " + date.getDayOfMonth();
        if (offset == 0) return context.getString(R.string.widget_meals_today, day);
        if (offset == 1) return context.getString(R.string.widget_meals_tomorrow, day);
        return Character.toUpperCase(day.charAt(0)) + day.substring(1);
    }

    /** Una riga per il pranzo o la cena: i piatti in programma, oppure "—". Restituisce true se c'è qualcosa. */
    private static boolean addSlot(Context context, RemoteViews views, List<WidgetStore.Meal> meals, LocalDate date, boolean lunch) {
        List<String> titles = new ArrayList<>();
        boolean allDone = true;
        for (WidgetStore.Meal m : meals) {
            if (!m.date.equals(date) || m.lunch != lunch) continue;
            titles.add((m.emoji.isEmpty() ? "" : m.emoji + " ") + m.title);
            allDone &= m.done;
        }
        RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_meal_row);
        row.setTextViewText(R.id.meal_slot, context.getString(lunch ? R.string.widget_meals_lunch : R.string.widget_meals_dinner));
        if (titles.isEmpty()) {
            row.setViewVisibility(R.id.meal_title, View.GONE);
            row.setTextViewText(R.id.meal_title_muted, "—");
            row.setViewVisibility(R.id.meal_title_muted, View.VISIBLE);
        } else if (allDone) {
            row.setViewVisibility(R.id.meal_title, View.GONE);
            row.setTextViewText(R.id.meal_title_muted, "✓ " + String.join(" · ", titles));
            row.setViewVisibility(R.id.meal_title_muted, View.VISIBLE);
        } else {
            row.setViewVisibility(R.id.meal_title_muted, View.GONE);
            row.setTextViewText(R.id.meal_title, String.join(" · ", titles));
            row.setViewVisibility(R.id.meal_title, View.VISIBLE);
        }
        views.addView(R.id.meal_rows, row);
        return !titles.isEmpty();
    }
}
