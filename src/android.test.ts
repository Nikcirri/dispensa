// Controlli sul progetto Android che il computer non può provare davvero.
// I widget non si vedono nei test: questi controlli evitano gli errori che sul telefono darebbero
// "Impossibile caricare il widget" (viste non ammesse, nomi sbagliati, colori o file mancanti).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const RES = '../android/app/src/main/res';
const WIDGET_JAVA = '../android/app/src/main/java/com/nikcirri/dispensa/widgets';
/** Le sole viste che Android accetta dentro un widget (RemoteViews). */
const REMOTE_VIEWS = ['LinearLayout', 'FrameLayout', 'RelativeLayout', 'TextView', 'ImageView', 'ProgressBar'];
const WIDGETS = ['products', 'meals'];
const LAYOUTS = [
  'widget_products',
  'widget_product_row',
  'widget_products_preview',
  'widget_meals',
  'widget_meal_day',
  'widget_meal_row',
  'widget_meals_preview',
];

describe('permessi', () => {
  it('l’app chiede solo internet, fotocamera e installazione degli aggiornamenti', () => {
    const manifest = read('../android/app/src/main/AndroidManifest.xml');
    const perms = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(perms).toEqual(['android.permission.CAMERA', 'android.permission.INTERNET', 'android.permission.REQUEST_INSTALL_PACKAGES']);
  });
});

describe('widget della schermata Home', () => {
  const manifest = read('../android/app/src/main/AndroidManifest.xml');

  it('il manifest dichiara i due widget e il ricevitore del cambio di giorno (non raggiungibile da altre app)', () => {
    expect(manifest).toContain('android:name=".widgets.ProductsWidget"');
    expect(manifest).toContain('android:name=".widgets.MealsWidget"');
    expect(manifest).toMatch(/android:name="\.widgets\.WidgetRefreshReceiver"\s+android:exported="false"/);
    for (const w of WIDGETS) expect(manifest).toContain(`android:resource="@xml/widget_${w}_info"`);
    expect(read('../android/app/src/main/java/com/nikcirri/dispensa/MainActivity.java')).toContain('registerPlugin(WidgetsPlugin.class)');
  });

  it('ogni widget ha descrizione, layout e anteprima, e si ridisegna ogni 30 minuti', () => {
    for (const w of WIDGETS) {
      const info = read(`${RES}/xml/widget_${w}_info.xml`);
      expect(info).toContain(`android:initialLayout="@layout/widget_${w}"`);
      expect(info).toContain(`android:previewLayout="@layout/widget_${w}_preview"`);
      expect(info).toContain('android:updatePeriodMillis="1800000"');
    }
    for (const l of LAYOUTS) expect(existsSync(new URL(`${RES}/layout/${l}.xml`, import.meta.url)), l).toBe(true);
  });

  it('i layout usano solo viste ammesse nei widget', () => {
    for (const l of LAYOUTS) {
      const xml = read(`${RES}/layout/${l}.xml`).replace(/<!--[\s\S]*?-->/g, '');
      const tags = [...xml.matchAll(/<([A-Za-z.]+)[\s>/]/g)].map((m) => m[1]!).filter((t) => t !== 'xml');
      expect(tags.filter((t) => !REMOTE_VIEWS.includes(t)), l).toEqual([]);
    }
    for (const w of WIDGETS) expect(read(`${RES}/layout/widget_${w}.xml`)).toContain('android:id="@android:id/background"');
  });

  it('il codice Java usa solo nomi che esistono nelle risorse', () => {
    const dir = new URL(WIDGET_JAVA + '/', import.meta.url);
    const java = readdirSync(dir)
      .filter((f) => f.endsWith('.java'))
      .map((f) => readFileSync(new URL(f, dir), 'utf8'))
      .join('\n');
    const layouts = LAYOUTS.map((l) => read(`${RES}/layout/${l}.xml`)).join('\n');
    const strings = read(`${RES}/values/strings.xml`);
    const missing: string[] = [];
    for (const [, kind, name] of java.matchAll(/(?<![.\w])R\.(id|string|layout|plurals)\.(\w+)/g)) {
      const ok =
        kind === 'id'
          ? layouts.includes(`android:id="@+id/${name}"`)
          : kind === 'string'
            ? strings.includes(`<string name="${name}">`)
            : kind === 'plurals'
              ? strings.includes(`<plurals name="${name}">`)
              : existsSync(new URL(`${RES}/layout/${name}.xml`, import.meta.url));
      if (!ok) missing.push(`R.${kind}.${name}`);
    }
    expect(missing).toEqual([]);
  });

  it('colori, stili, misure e disegni usati dai widget esistono (anche nel tema scuro)', () => {
    const files = [
      ...LAYOUTS.map((l) => `${RES}/layout/${l}.xml`),
      ...WIDGETS.map((w) => `${RES}/xml/widget_${w}_info.xml`),
      ...readdirSync(new URL(`${RES}/drawable/`, import.meta.url))
        .filter((f) => f.startsWith('widget'))
        .map((f) => `${RES}/drawable/${f}`),
    ];
    const all = files.map(read).join('\n');
    const colors = read(`${RES}/values/colors.xml`);
    const night = read(`${RES}/values-night/colors.xml`);
    const strings = read(`${RES}/values/strings.xml`);
    const missing: string[] = [];
    for (const [, name] of all.matchAll(/@color\/(\w+)/g)) {
      if (!colors.includes(`<color name="${name}">`) || !night.includes(`<color name="${name}">`)) missing.push(`color/${name}`);
    }
    for (const [, name] of all.matchAll(/@drawable\/(\w+)/g)) {
      if (!existsSync(new URL(`${RES}/drawable/${name}.xml`, import.meta.url))) missing.push(`drawable/${name}`);
    }
    for (const [, name] of all.matchAll(/@string\/(\w+)/g)) {
      if (!strings.includes(`<string name="${name}">`)) missing.push(`string/${name}`);
    }
    for (const [, name] of all.matchAll(/@style\/(\w+)/g)) {
      if (!read(`${RES}/values/styles.xml`).includes(`<style name="${name}"`)) missing.push(`style/${name}`);
    }
    for (const [, name] of all.matchAll(/(?<!android:)@dimen\/(\w+)/g)) {
      if (!read(`${RES}/values/dimens.xml`).includes(`<dimen name="${name}">`) || !read(`${RES}/values-v31/dimens.xml`).includes(`<dimen name="${name}">`)) missing.push(`dimen/${name}`);
    }
    expect(missing).toEqual([]);
  });

  it('le azioni dei widget sono quelle che l’app conosce', () => {
    const links = read(`${WIDGET_JAVA}/WidgetLinks.java`);
    const actions = [...links.matchAll(/return "(\w+)";/g)].map((m) => m[1]).sort();
    expect(actions).toEqual(['aggiungi', 'dispensa', 'pasti']);
    expect(read('./lib/services/widgets.ts')).toContain("export type WidgetAction = 'dispensa' | 'aggiungi' | 'pasti';");
  });
});
