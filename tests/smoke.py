"""Prova completa in Chrome (dopo `npm run build`): onboarding, dispensa, fotocamera finta, foto letta
dall'IA (risposta di Gemini simulata), codice a mano, spesa, ricette (simulate), statistiche, impostazioni.

Uso: python3 tests/smoke.py [larghezza]   (screenshot in tests/screenshots/)
Non serve internet: le richieste a Gemini sono intercettate.
"""
import http.server
import json
import os
import socketserver
import sys
import threading
from functools import partial

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SHOTS = os.path.join(ROOT, "tests", "screenshots")
WIDTH = int(sys.argv[1]) if len(sys.argv) > 1 else 384
os.makedirs(SHOTS, exist_ok=True)

SCAN = {
    "products": [
        {
            "name": "Latte parzialmente scremato",
            "brand": "Granarolo",
            "size": "1 l",
            "emoji": "🥛",
            "location": "frigo",
            "quantity": 1,
            "unit": "pz",
            "expiry": "",
            "expiryText": "",
            "expiryKind": "scadenza",
            "shelfDays": 6,
            "openDays": 3,
        }
    ],
    "note": "",
}

MULTI = {
    "products": [
        {"name": "Mozzarella fior di latte", "brand": "", "size": "125 g", "emoji": "🧀", "location": "frigo", "quantity": 2, "unit": "pz", "expiry": "", "expiryText": "", "expiryKind": "scadenza", "shelfDays": 7, "openDays": 2},
        {"name": "Pomodori ciliegini", "brand": "", "size": "500 g", "emoji": "🍅", "location": "frigo", "quantity": 1, "unit": "conf", "expiry": "", "expiryText": "", "expiryKind": "scadenza", "shelfDays": 6, "openDays": 0},
        {"name": "Penne rigate", "brand": "Barilla", "size": "500 g", "emoji": "🍝", "location": "dispensa", "quantity": 1, "unit": "pz", "expiry": "", "expiryText": "", "expiryKind": "tmc", "shelfDays": 540, "openDays": 0},
    ],
    "note": "Scontrino un po' sfocato in fondo",
}

RECIPES = {
    "recipes": [
        {
            "title": "Frittata di zucchine e mozzarella",
            "emoji": "🍳",
            "minutes": 20,
            "difficulty": "facile",
            "servings": 2,
            "uses": [{"ref": "p1", "amount": "1"}, {"ref": "p3", "amount": "2"}, {"ref": "p5", "amount": "4"}],
            "missing": [{"name": "Parmigiano", "amount": "30 g"}],
            "steps": ["Taglia le zucchine a rondelle e falle saltare in padella con un filo d'olio per 5 minuti.", "Sbatti le uova con sale e pepe.", "Unisci zucchine e mozzarella a cubetti, versa in padella e cuoci 8 minuti per lato."],
            "why": "Usa la mozzarella che scade oggi e le zucchine di dopodomani.",
            "tip": "Ottima anche fredda il giorno dopo.",
        },
        {
            "title": "Spaghetti al pomodoro fresco",
            "emoji": "🍝",
            "minutes": 15,
            "difficulty": "facile",
            "servings": 2,
            "uses": [{"ref": "p6", "amount": "180 g"}, {"ref": "p7", "amount": "200 ml"}],
            "missing": [],
            "steps": ["Cuoci la pasta.", "Scalda la passata con olio e basilico.", "Condisci e servi."],
            "why": "Un classico veloce con quello che hai.",
            "tip": "",
        },
    ]
}


def gemini_reply(payload):
    return json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]})


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = partial(QuietHandler, directory=DIST)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    httpd = serve()
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    errors = []
    next_scan = {"payload": SCAN}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
        ctx = browser.new_context(viewport={"width": WIDTH, "height": 800}, device_scale_factor=2, permissions=["camera"], locale="it-IT")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)

        def route(r):
            u = r.request.url
            if "/models?" in u:
                r.fulfill(status=200, content_type="application/json", body=json.dumps({"models": [{"name": "models/gemini-3.8-flash", "supportedGenerationMethods": ["generateContent"]}]}))
                return
            body = r.request.post_data or ""
            if "Rispondi solo: ok" in body:
                r.fulfill(status=200, content_type="application/json", body=json.dumps({"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}))
            elif '"recipes"' in body:
                r.fulfill(status=200, content_type="application/json", body=gemini_reply(RECIPES))
            else:
                r.fulfill(status=200, content_type="application/json", body=gemini_reply(next_scan["payload"]))

        page.route("https://generativelanguage.googleapis.com/**", route)
        page.goto(url)
        page.wait_for_selector("text=Dispensa & Cucina IA")
        page.screenshot(path=f"{SHOTS}/01-onboarding.png")
        page.click("text=Inizia con qualche prodotto di prova")
        page.wait_for_selector("text=Oggi e domani")
        page.wait_for_timeout(400)
        page.screenshot(path=f"{SHOTS}/02-dispensa.png")
        page.screenshot(path=f"{SHOTS}/02b-dispensa-full.png", full_page=False)
        # Scorre l'elenco
        page.evaluate("document.querySelector('main').scrollTo(0, 700)")
        page.wait_for_timeout(200)
        page.screenshot(path=f"{SHOTS}/03-dispensa-giu.png")
        page.evaluate("document.querySelector('main').scrollTo(0, 0)")

        # Quantità +, carrello, finito con annulla
        first = page.locator("article.item").first
        first.locator("button[aria-label='Più']").click()
        first.locator("button[aria-label^='Metti']").click()
        page.wait_for_selector("text=aggiunto in cima alla spesa")
        page.locator("article.item").nth(1).locator("button.done-btn").click()
        page.wait_for_selector("text=Annulla")
        page.screenshot(path=f"{SHOTS}/04-finito-annulla.png")
        page.click("text=Annulla")
        page.wait_for_timeout(300)

        # Filtro freezer e ricerca
        page.click("button.chip:has-text('Freezer')")
        page.wait_for_timeout(200)
        assert page.locator("article.item").count() == 1, "filtro freezer"
        page.click("button.chip:has-text('Freezer')")
        page.fill("input[type=search]", "yog")
        page.wait_for_timeout(200)
        assert page.locator("article.item").count() == 1, "ricerca"
        page.fill("input[type=search]", "")

        # Modifica prodotto
        page.locator("article.item button.main").first.click()
        page.wait_for_selector("text=Modifica prodotto")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOTS}/05-modifica.png")
        page.click("button[aria-label='Chiudi']")
        page.wait_for_timeout(300)

        # Aggiungi: senza chiave
        page.click("nav button:has-text('Aggiungi')")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{SHOTS}/06-aggiungi-senza-chiave.png")
        # Collega Gemini
        page.click("text=Per leggere le foto collega Gemini")
        page.wait_for_selector("text=Collega Gemini")
        page.screenshot(path=f"{SHOTS}/07-chiave.png")
        page.fill("input[type=password]", "AQ.Ab8RN6Jxl6OdplEKqxwlbG2IZ7PNmYabcdefghijkl")
        page.click("text=Salva la chiave")
        page.wait_for_selector("text=Gemini collegato")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{SHOTS}/08-mirino.png")
        # Scatto (fotocamera finta) → risposta simulata
        page.click("button[aria-label='Scatta']")
        page.wait_for_selector("text=Conferma prodotto", timeout=20000)
        page.wait_for_timeout(400)
        page.screenshot(path=f"{SHOTS}/09-conferma.png")
        page.click("text=Conferma e salva in dispensa")
        page.wait_for_selector("text=in dispensa")
        # Più prodotti
        next_scan["payload"] = MULTI
        page.click("button:has-text('Spesa intera')")
        page.wait_for_timeout(800)
        page.screenshot(path=f"{SHOTS}/10-modalita-spesa.png")
        page.click("button[aria-label='Scatta']")
        page.wait_for_selector("text=Prodotti trovati", timeout=20000)
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOTS}/11-multi.png")
        page.click("text=Aggiungi 3 prodotti")
        page.wait_for_timeout(500)
        page.click("button:has-text('Codice a barre')")
        page.wait_for_timeout(600)
        page.screenshot(path=f"{SHOTS}/12-barcode.png")
        # A mano
        page.click("text=Scrivi a mano")
        page.wait_for_selector("text=Conferma prodotto")
        page.fill("input[placeholder^='Es. Latte']", "yogurt alla fragola")
        page.wait_for_timeout(200)
        page.screenshot(path=f"{SHOTS}/13-a-mano.png")
        page.click("text=Conferma e salva in dispensa")
        page.wait_for_timeout(500)

        # Ricette
        page.click("nav button:has-text('Ricette')")
        page.wait_for_timeout(500)
        page.screenshot(path=f"{SHOTS}/14-ricette.png")
        page.click("text=Genera ricette con gli ingredienti in scadenza")
        page.wait_for_selector("text=Frittata di zucchine", timeout=20000)
        page.wait_for_timeout(900)
        page.screenshot(path=f"{SHOTS}/15-ricette-risultati.png")
        page.evaluate("document.querySelector('main').scrollTo(0, 520)")
        page.wait_for_timeout(200)
        page.screenshot(path=f"{SHOTS}/16-ricette-card.png")
        page.click("text=Frittata di zucchine e mozzarella")
        page.wait_for_selector("text=Procedimento")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOTS}/17-ricetta.png")
        page.click("text=L’ho cucinata")
        page.wait_for_selector("text=Com’è andata?")
        page.screenshot(path=f"{SHOTS}/18-cucinata.png")
        page.click("text=Aggiorna la dispensa")
        page.wait_for_timeout(500)

        # Spesa
        page.click("nav button:has-text('Dispensa')")
        page.wait_for_timeout(300)
        page.click("button[aria-label='Lista della spesa']")
        page.wait_for_selector("text=Lista della spesa")
        page.fill("input[placeholder^='Aggiungi:']", "pane, uova e caffè")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        page.locator("button.tick").first.click()
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOTS}/19-spesa.png")
        page.click("text=Metti in dispensa")
        page.wait_for_selector("text=Controlla dove va ogni prodotto")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOTS}/20-spesa-in-dispensa.png")
        page.locator("button.btn-primary:has-text('Aggiungi')").click()
        page.wait_for_timeout(300)
        page.click("button[aria-label='Chiudi']")
        page.wait_for_timeout(300)

        # Statistiche e impostazioni
        page.evaluate("document.querySelector('main').scrollTo(0, 99999)")
        page.click("text=Il tuo anti-spreco")
        page.wait_for_selector("text=consumati")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOTS}/21-statistiche.png")
        page.click("button[aria-label='Chiudi']")
        page.wait_for_timeout(300)
        page.click("button[aria-label='Impostazioni']")
        page.wait_for_selector("text=Avvisi delle scadenze")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOTS}/22-impostazioni.png")
        page.click("button[aria-label='Chiudi']")

        # Tema scuro
        page.emulate_media(color_scheme="dark")
        page.evaluate("document.querySelector('main').scrollTo(0, 0)")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOTS}/23-scuro.png")
        browser.close()
    httpd.shutdown()
    bad = [e for e in errors if "favicon" not in e]
    if bad:
        print("\n".join(bad))
        sys.exit(1)
    print(f"OK ({WIDTH}px): screenshot in {SHOTS}")


if __name__ == "__main__":
    main()
