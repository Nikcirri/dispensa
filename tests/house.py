"""Casa condivisa con l'emulatore di Firebase (dopo `npm run build`): due "telefoni" nella stessa casa.

Si esegue dentro l'emulatore (lo fa GitHub Actions, workflow "Controllo"):
    npx firebase-tools emulators:exec --only auth,firestore --project demo-dispensa "python3 tests/house.py"

Controlla: creare la casa, l'invito (anche con il codice sbagliato), entrare, la spesa e la dispensa che arrivano
sull'altro telefono con il nome di chi le ha cambiate, le cancellazioni, la riapertura dell'app e l'uscita dalla casa.
"""
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import SHOTS, WIDTH, serve  # noqa: E402

# Progetto "demo-": non esiste online, l'app si collega all'emulatore (127.0.0.1:9099 e :8080).
CONFIG = """const firebaseConfig = {
  apiKey: "AIzaSyDemoKeyForTheFirebaseEmulator0000",
  authDomain: "demo-dispensa.firebaseapp.com",
  projectId: "demo-dispensa",
  appId: "1:000000000000:web:0000000000000000"
};"""

TIMEOUT = 30000


def main():
    httpd = serve()
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    errors = []
    pages = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            run(browser, url, errors, pages)
        except Exception:
            for i, pg in enumerate(pages):
                try:
                    if not pg.is_closed():
                        pg.screenshot(path=f"{SHOTS}/house-fail-{i}.png")
                except Exception:
                    pass
            print("\n".join(errors))
            raise
        browser.close()
    httpd.shutdown()
    # L'intruso deve ricevere un errore (permesso negato): i suoi messaggi non contano.
    bad = [e for e in errors if "favicon" not in e and not e.startswith("Intruso")]
    if bad:
        print("\n".join(bad))
        sys.exit(1)
    print(f"OK ({WIDTH}px): casa condivisa con l'emulatore")


def run(browser, url, errors, pages):
    def phone(label):
        ctx = browser.new_context(
            viewport={"width": WIDTH, "height": 800},
            device_scale_factor=2,
            locale="it-IT",
            permissions=["clipboard-read", "clipboard-write"],
        )
        page = ctx.new_page()
        pages.append(page)
        page.on("pageerror", lambda e: errors.append(f"{label} pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"{label} console: {m.text}") if m.type == "error" else None)
        page.route("https://api.github.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"tag_name": "v0.0.1", "body": "", "assets": []})))
        page.goto(url)
        page.wait_for_selector("text=Iniziamo")
        return ctx, page

    def tab(page, name):
        page.click(f"nav button:has-text('{name}')")
        page.wait_for_timeout(250)

    def open_house(page):
        tab(page, "Dispensa")
        page.click("button[aria-label='Impostazioni']")
        page.locator("button.row", has_text=re.compile("Condividi con chi vive con te|Casa condivisa")).first.click()
        page.wait_for_selector("h2:has-text('Casa condivisa')")

    def close_sheets(page):
        while page.locator("button[aria-label='Chiudi']").count():
            page.locator("button[aria-label='Chiudi']").last.click()
            page.wait_for_timeout(250)

    # ---------- Io creo la casa ----------
    ctx_a, a = phone("Nicola")
    a.click("text=Iniziamo")
    a.wait_for_selector("nav.navbar", timeout=TIMEOUT)
    tab(a, "Spesa")
    a.fill("input[placeholder^='Aggiungi:']", "uova")
    a.keyboard.press("Enter")
    a.wait_for_selector("text=Uova")
    open_house(a)
    a.click("text=Crea la casa")
    a.fill("textarea[placeholder^='const firebaseConfig']", CONFIG)
    a.wait_for_selector("text=Progetto “demo-dispensa”")
    a.fill("input[placeholder='Es. Nicola']", "Nicola")
    a.click("button.btn-primary:has-text('Crea la casa')")
    a.wait_for_selector("text=Casa creata", timeout=TIMEOUT)
    a.wait_for_selector(".status >> text=Collegata", timeout=TIMEOUT)
    a.screenshot(path=f"{SHOTS}/house-01-creata.png")
    a.click("text=Copia l’invito")
    a.wait_for_selector("text=Invito copiato")
    invite = a.evaluate("navigator.clipboard.readText()")
    assert "DSP1." in invite and "Nicola ti invita" in invite, invite
    a.click("button:has-text('QR')")
    a.wait_for_selector(".qr svg")
    a.screenshot(path=f"{SHOTS}/house-02-invito-qr.png")
    close_sheets(a)

    # ---------- Un invito con il codice sbagliato non entra (regole di Firestore) ----------
    ctx_x, x = phone("Intruso")
    x.click("text=Ho un invito per una casa condivisa")
    x.wait_for_selector("textarea[placeholder^='Tieni premuto qui']")
    code = invite[invite.index("DSP1."):].split()[0]
    payload = json.loads(__import__("base64").urlsafe_b64decode(code[5:] + "=" * (-len(code[5:]) % 4)))
    payload["c"] = "Z" * 24
    bad = "DSP1." + __import__("base64").urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    x.fill("textarea[placeholder^='Tieni premuto qui']", bad)
    x.fill("input[placeholder='Es. Mamma']", "Intruso")
    x.click("button.btn-primary:has-text('Entra nella casa')")
    x.wait_for_selector("text=Invito non valido", timeout=TIMEOUT)
    ctx_x.close()

    # ---------- Mamma entra con l'invito (dalla prima schermata) ----------
    ctx_b, b = phone("Mamma")
    b.click("text=Ho un invito per una casa condivisa")
    b.wait_for_selector("textarea[placeholder^='Tieni premuto qui']")
    b.fill("textarea[placeholder^='Tieni premuto qui']", invite)
    b.wait_for_selector("text=✓ Invito valido")
    b.fill("input[placeholder='Es. Mamma']", "Mamma")
    b.click("button.btn-primary:has-text('Entra nella casa')")
    b.wait_for_selector("text=Sei nella casa", timeout=TIMEOUT)
    b.wait_for_selector(".status >> text=Collegata", timeout=TIMEOUT)
    b.wait_for_selector(".members >> text=Nicola", timeout=TIMEOUT)
    b.screenshot(path=f"{SHOTS}/house-03-mamma-entrata.png")
    close_sheets(b)
    # La spesa che avevo io c'è anche da lei.
    tab(b, "Spesa")
    b.wait_for_selector("button.tick[aria-label='Preso: Uova']", timeout=TIMEOUT)

    # ---------- Lei aggiunge il latte: lo vedo io, con il suo nome ----------
    b.fill("input[placeholder^='Aggiungi:']", "latte")
    b.keyboard.press("Enter")
    a.wait_for_selector("text=Mamma ha aggiunto Latte alla spesa", timeout=TIMEOUT)
    tab(a, "Spesa")
    a.wait_for_selector("button.tick[aria-label='Preso: Latte']", timeout=TIMEOUT)
    a.screenshot(path=f"{SHOTS}/house-04-latte-da-mamma.png")

    # ---------- Io compro il latte e lo metto in dispensa: da lei sparisce dalla spesa e compare in dispensa ----------
    a.click("button.tick[aria-label='Preso: Latte']")
    a.click("text=Metti in dispensa")
    a.wait_for_selector("text=Controlla dove va ogni prodotto")
    a.locator("button.btn-primary:has-text('Aggiungi')").click()
    a.wait_for_timeout(500)
    b.wait_for_selector("button.tick[aria-label='Preso: Latte']", state="detached", timeout=TIMEOUT)
    tab(b, "Dispensa")
    b.fill("input[placeholder='Cerca in dispensa…']", "latte")
    b.wait_for_selector("main >> text=Latte", timeout=TIMEOUT)
    b.screenshot(path=f"{SHOTS}/house-05-latte-in-dispensa.png")
    b.fill("input[placeholder='Cerca in dispensa…']", "")

    # ---------- Riapro l'app: resto nella casa e i dati ci sono ----------
    a.reload()
    a.wait_for_selector("nav.navbar", timeout=TIMEOUT)
    open_house(a)
    a.wait_for_selector(".status >> text=Collegata", timeout=TIMEOUT)
    a.wait_for_selector(".members >> text=Mamma", timeout=TIMEOUT)
    close_sheets(a)

    # ---------- Lei toglie le uova dalla spesa mentre io ho l'app chiusa: alla riapertura spariscono anche da me ----------
    a.close()
    tab(b, "Spesa")
    b.click("button[aria-label='Togli Uova']")
    b.wait_for_timeout(1500)
    a = ctx_a.new_page()
    pages.append(a)
    a.on("pageerror", lambda e: errors.append(f"Nicola pageerror: {e}"))
    a.on("console", lambda m: errors.append(f"Nicola console: {m.text}") if m.type == "error" else None)
    a.route("https://api.github.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"tag_name": "v0.0.1", "body": "", "assets": []})))
    a.goto(url)
    a.wait_for_selector("nav.navbar", timeout=TIMEOUT)
    tab(a, "Spesa")
    a.wait_for_selector("button.tick[aria-label='Preso: Uova']", state="detached", timeout=TIMEOUT)

    # ---------- Lei esce dalla casa: i suoi dati restano ma non si aggiornano più ----------
    open_house(b)
    b.click("text=Esci dalla casa")
    b.click(".dialog button:has-text('Esci')")
    b.wait_for_selector("text=Sei uscito dalla casa condivisa", timeout=TIMEOUT)
    b.wait_for_selector("text=Ho un invito")
    close_sheets(b)
    tab(b, "Dispensa")
    b.fill("input[placeholder='Cerca in dispensa…']", "latte")
    b.wait_for_selector("main >> text=Latte")
    ctx_b.close()
    ctx_a.close()


if __name__ == "__main__":
    main()
