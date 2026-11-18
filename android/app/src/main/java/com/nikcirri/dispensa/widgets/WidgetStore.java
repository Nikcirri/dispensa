package com.nikcirri.dispensa.widgets;

import android.content.Context;
import android.content.SharedPreferences;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * I dati dei widget, salvati sul telefono: l'app li manda (WidgetsPlugin) a ogni modifica.
 * Le date restano date: i giorni che mancano si contano qui al momento di disegnare,
 * così a mezzanotte i widget restano giusti anche ad app chiusa.
 */
final class WidgetStore {

    private static final String PREFS = "dispensa_widgets";
    private static final String KEY = "data";
    static final int MAX_PRODUCTS = 12;
    static final int MAX_MEALS = 40;

    private WidgetStore() {}

    static final class Product {
        String name;
        String emoji;
        /** Data che conta, oppure null se il prodotto non ha scadenza. */
        LocalDate expiry;
        /** "Preferibilmente entro": oltre la data non è un allarme. */
        boolean tmc;
    }

    static final class Meal {
        LocalDate date;
        boolean lunch;
        String title;
        String emoji;
        boolean done;
    }

    static final class Data {
        /** false finché l'app non ha mai mandato i dati (prima apertura non fatta). */
        boolean known;
        int total;
        final List<Product> products = new ArrayList<>();
        final List<Meal> meals = new ArrayList<>();
    }

    static LocalDate today() {
        return LocalDate.now();
    }

    static LocalDate parseDate(String s) {
        if (s == null || !s.matches("\\d{4}-\\d{2}-\\d{2}")) return null;
        try {
            return LocalDate.parse(s);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /** Giorni da oggi alla data (negativi se è passata). */
    static long daysUntil(LocalDate date) {
        return ChronoUnit.DAYS.between(today(), date);
    }

    private static String clip(String s, int max) {
        if (s == null) return "";
        String t = s.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    /**
     * Controlla e salva i dati mandati dall'app. Si tengono solo i campi conosciuti, accorciati.
     * Restituisce false se i dati non hanno la forma giusta.
     */
    static boolean save(Context context, JSONObject in) {
        try {
            JSONArray products = in.optJSONArray("products");
            JSONArray meals = in.optJSONArray("meals");
            if (products == null || meals == null) return false;
            JSONObject out = new JSONObject();
            out.put("total", Math.max(0, in.optInt("total", products.length())));
            JSONArray p = new JSONArray();
            for (int i = 0; i < products.length() && p.length() < MAX_PRODUCTS; i++) {
                JSONObject src = products.optJSONObject(i);
                if (src == null) continue;
                String name = clip(src.optString("name", ""), 60);
                if (name.isEmpty()) continue;
                JSONObject o = new JSONObject();
                o.put("name", name);
                o.put("emoji", clip(src.optString("emoji", ""), 16));
                LocalDate expiry = parseDate(src.optString("expiry", ""));
                o.put("expiry", expiry == null ? "" : expiry.toString());
                o.put("kind", "tmc".equals(src.optString("kind")) ? "tmc" : "scadenza");
                p.put(o);
            }
            out.put("products", p);
            JSONArray m = new JSONArray();
            for (int i = 0; i < meals.length() && m.length() < MAX_MEALS; i++) {
                JSONObject src = meals.optJSONObject(i);
                if (src == null) continue;
                LocalDate date = parseDate(src.optString("date", ""));
                String slot = src.optString("slot", "");
                String title = clip(src.optString("title", ""), 80);
                if (date == null || title.isEmpty() || !("pranzo".equals(slot) || "cena".equals(slot))) continue;
                JSONObject o = new JSONObject();
                o.put("date", date.toString());
                o.put("slot", slot);
                o.put("title", title);
                o.put("emoji", clip(src.optString("emoji", ""), 16));
                o.put("done", src.optBoolean("done", false));
                m.put(o);
            }
            out.put("meals", m);
            prefs(context).edit().putString(KEY, out.toString()).apply();
            return true;
        } catch (JSONException e) {
            return false;
        }
    }

    static Data load(Context context) {
        Data data = new Data();
        String raw = prefs(context).getString(KEY, null);
        if (raw == null) return data;
        try {
            JSONObject in = new JSONObject(raw);
            data.known = true;
            data.total = in.optInt("total", 0);
            JSONArray products = in.optJSONArray("products");
            for (int i = 0; products != null && i < products.length(); i++) {
                JSONObject o = products.optJSONObject(i);
                if (o == null) continue;
                Product p = new Product();
                p.name = o.optString("name", "");
                p.emoji = o.optString("emoji", "");
                p.expiry = parseDate(o.optString("expiry", ""));
                p.tmc = "tmc".equals(o.optString("kind"));
                data.products.add(p);
            }
            JSONArray meals = in.optJSONArray("meals");
            for (int i = 0; meals != null && i < meals.length(); i++) {
                JSONObject o = meals.optJSONObject(i);
                if (o == null) continue;
                Meal m = new Meal();
                m.date = parseDate(o.optString("date", ""));
                if (m.date == null) continue;
                m.lunch = "pranzo".equals(o.optString("slot"));
                m.title = o.optString("title", "");
                m.emoji = o.optString("emoji", "");
                m.done = o.optBoolean("done", false);
                data.meals.add(m);
            }
        } catch (JSONException e) {
            return new Data();
        }
        return data;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
