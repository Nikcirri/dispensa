"""Prova di uso quotidiano (dopo `npm run build`): una giornata tipo con controlli su quello che si vede.

- prodotti comprati di nuovo: si sommano a quelli che ci sono, niente doppioni;
- ricette (proposte e salvate) sempre collegate alla dispensa di adesso: un prodotto finito risulta da comprare,
  ricomprato torna presente;
- una ricetta nel piano: i suoi prodotti sono "In programma"; cucinata dal pallino aggiorna la dispensa
  e conta i prodotti salvati dallo spreco;
- un piatto scritto a mano con un ingrediente da comprare: comprato non manca più;
- i dati restano dopo aver chiuso e riaperto l'app; "trascina in giù" aggiorna.

Uso: python3 tests/daily.py [larghezza]   (screenshot in tests/screenshots/daily-*)
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import RECIPES, SHOTS, WIDTH, gemini_reply, serve  # noqa: E402


def main():
    httpd = serve()
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": WIDTH, "height": 800}, device_scale_factor=2, locale="it-IT")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)

        def route(r):
            if "/models?" in r.request.url:
                r.fulfill(status=200, content_type="application/json", body=json.dumps({"models": [{"name": "models/gemini-3.8-flash", "supportedGenerationMethods": ["generateContent"]}]}))
                return
            body = r.request.post_data or ""
            if "Rispondi solo: ok" in body:
                r.fulfill(status=200, content_type="application/json", body=json.dumps({"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}))
            else:
                r.fulfill(status=200, content_type="application/json", body=gemini_reply(RECIPES))

        page.route("https://generativelanguage.googleapis.com/**", route)
        # Controllo aggiornamenti: nessuna versione nuova (senza andare davvero su GitHub).
        page.route("https://api.github.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"tag_name": "v0.0.1", "body": "", "assets": []})))

        def tab(name):
            page.click(f"nav button:has-text('{name}')")
            page.wait_for_timeout(250)

        def shot(name):
            page.wait_for_timeout(250)
            page.screenshot(path=f"{SHOTS}/daily-{name}.png")

        def search(text):
            page.fill("input[placeholder='Cerca in dispensa…']", text)
            page.wait_for_timeout(250)

        def rows(name):
            """Quante schede prodotto con questo nome ci sono nella Dispensa (dopo la ricerca)."""
            return page.locator(f"article.item .name:text-is('{name}')").count()

        def buy(names):
            """Spesa: scrive i prodotti, li spunta tutti e li mette in dispensa."""
            tab("Spesa")
            page.fill("input[placeholder^='Aggiungi:']", ", ".join(names))
            page.keyboard.press("Enter")
            for n in names:
                page.click(f"button.tick[aria-label='Preso: {n}']")
            page.click("text=Metti in dispensa")
            page.wait_for_selector("text=Controlla dove va ogni prodotto")
            page.locator("button.btn-primary:has-text('Aggiungi')").click()
            page.wait_for_selector("text=in dispensa")
            page.wait_for_timeout(400)

        page.goto(url)
        page.click("text=Inizia con qualche prodotto di prova")
        page.wait_for_selector("text=Oggi e domani")

        # Chiave di Gemini (finta) dalle Impostazioni.
        page.click("button[aria-label='Impostazioni']")
        page.fill("input[type=password]", "AQ.Ab8RN6Jxl6OdplEKqxwlbG2IZ7PNmYabcdefghijkl")
        page.click("text=Salva la chiave")
        page.wait_for_selector("text=Gemini è collegato")
        page.click("button[aria-label='Chiudi']")
        page.wait_for_timeout(400)

        # 1) Uova e zucchine comprate di nuovo: si sommano, niente doppioni.
        buy(["Uova", "Zucchine"])
        assert page.locator("text=c’erano già: sommati").count() > 0, "il messaggio deve dire che erano già in dispensa"
        tab("Dispensa")
        search("uova")
        assert rows("Uova") == 1, f"Uova: una sola scheda, non {rows('Uova')}"
        assert page.locator("article.item:has-text('Uova') >> text=2 pz").count() == 1, "Uova: quantità sommata (2 pz)"
        shot("01-sommati")
        search("")

        # 2) Ricette proposte: un prodotto finito risulta da comprare, ricomprato torna presente.
        tab("Ricette")
        page.click("text=Genera ricette")
        page.wait_for_selector("text=Frittata di zucchine e mozzarella")
        card = page.locator("article.recipe:has-text('Frittata di zucchine e mozzarella')")
        assert card.locator("text=Mozzarella").count() > 0
        tab("Dispensa")
        search("mozzarella")
        page.locator("article.item:has-text('Mozzarella') button:has-text('Finito')").click()
        page.wait_for_timeout(700)
        search("")
        tab("Ricette")
        missing = card.locator(".missing").inner_text()
        assert "Mozzarella" in missing, f"mozzarella finita: deve risultare da comprare ({missing})"
        shot("02-finita")
        buy(["Mozzarella fior di latte"])
        tab("Ricette")
        missing = card.locator(".missing").inner_text()
        assert "Mozzarella" not in missing, f"mozzarella ricomprata: non deve mancare ({missing})"
        assert card.locator(".use.gone").count() == 0, "nessun ingrediente barrato dopo averlo ricomprato"
        shot("03-ricomprata")

        # 3) Salvata col cuore: anche tra le salvate resta collegata alla dispensa.
        card.locator("button[aria-label='Salva la ricetta']").click()
        page.click("button[aria-label='Ricette salvate e tue']")
        saved = page.locator("article.recipe:has-text('Frittata di zucchine e mozzarella')")
        assert saved.locator(".use.gone").count() == 0

        # 4) Nel piano: i prodotti sono "In programma"; cucinata dal pallino aggiorna la dispensa.
        saved.locator("button[aria-label='Metti nel piano dei pasti']").click()
        page.wait_for_selector("text=Quando la cucini?")
        page.locator("button.slot.suggested").click()
        page.wait_for_timeout(500)
        tab("Dispensa")
        search("mozzarella")
        assert page.locator("article.item:has-text('Mozzarella') >> text=In programma:").count() == 1, "mozzarella in programma"
        shot("04-in-programma")
        search("")
        tab("Pasti")
        page.locator("button.tick[aria-label='Cucinato: Frittata di zucchine e mozzarella']").click()
        page.wait_for_selector("text=Com’è andata?")
        assert page.locator(".list li").count() == 3, "Com'è andata: i tre prodotti della ricetta"
        shot("05-com-e-andata")
        page.click("text=Aggiorna la dispensa")
        page.wait_for_selector("text=dallo spreco")
        page.wait_for_timeout(500)
        salvati = page.locator(".stat-line:has-text('Prodotti salvati') strong").inner_text()
        assert int(salvati) >= 1, f"i prodotti in scadenza cucinati contano come salvati ({salvati})"
        shot("06-cucinata")

        # 5) Piatto scritto a mano con un ingrediente da comprare: comprato non manca più.
        page.locator("button.add-meal").first.click()
        page.fill("input[placeholder^='Cosa cucini?']", "insalata di pomodori")
        page.keyboard.press("Enter")
        page.wait_for_selector("text=Insalata di pomodori")
        page.click("text=Insalata di pomodori")
        page.click("text=Scegli gli ingredienti")
        page.fill("input[placeholder='Es. basilico, panna']", "pomodori")
        page.keyboard.press("Enter")
        page.locator("button.btn-primary:has-text('Salva')").click()
        page.wait_for_selector("text=Li metto nella lista della spesa?")
        page.get_by_role("button", name="No", exact=True).click()
        page.wait_for_timeout(500)
        page.locator("button[aria-label='Chiudi']").last.click()
        page.wait_for_timeout(400)
        assert "Pomodori" in " ".join(page.locator(".hint").all_inner_texts())
        buy(["Pomodori"])
        tab("Pasti")
        hints = " ".join(page.locator(".hint").all_inner_texts())
        assert "Pomodori" not in hints, f"pomodori comprati: non devono mancare ({hints})"

        # 6) Chiusa e riaperta: tutto resta; "trascina in giù" aggiorna.
        page.reload()
        page.wait_for_selector("nav")
        tab("Pasti")
        assert page.locator("button.tick.on[aria-label='Da fare: Frittata di zucchine e mozzarella']").count() == 1, "il pasto cucinato resta fatto"
        tab("Dispensa")
        names = page.locator("article.item .name").all_inner_texts()
        assert len(names) == len(set(names)), f"nessun doppione in dispensa: {names}"
        page.evaluate("""() => {
          const main = document.querySelector('main');
          main.scrollTo(0, 0);
          const t = (y) => new Touch({ identifier: 1, target: main, clientX: 180, clientY: y });
          main.dispatchEvent(new TouchEvent('touchstart', { touches: [t(150)], bubbles: true }));
          main.dispatchEvent(new TouchEvent('touchmove', { touches: [t(400)], bubbles: true }));
          main.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
        }""")
        page.wait_for_selector("text=Aggiornato ✓")
        shot("07-fine")
        browser.close()
    httpd.shutdown()
    bad = [e for e in errors if "favicon" not in e]
    if bad:
        print("\n".join(bad))
        sys.exit(1)
    print(f"OK ({WIDTH}px): giornata tipo superata")


if __name__ == "__main__":
    main()
