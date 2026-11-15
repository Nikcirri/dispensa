# Dispensa & Cucina IA

Frigo, freezer e dispensa sotto controllo, per non buttare più niente. Fotografi l'etichetta e l'app legge nome e scadenza; le scadenze si vedono a colori; quando qualcosa sta per scadere ti avvisa e ti propone una ricetta che lo usa. Tutti i dati restano sul telefono.

## Le tre schede

- **Dispensa** – tutti i prodotti, dal più urgente: 🔴 rosso se scade oggi o domani, 🟠 arancione entro 5 giorni, 🟢 verde più avanti. Cerca, filtra (Frigo, Freezer, Dispensa), cambia la quantità con − e +, tocca **Finito** quando l'hai mangiato (con "Annulla") o il carrello per metterlo in cima alla spesa. Toccando un prodotto lo modifichi, lo segni come aperto, finito o buttato.
- **Aggiungi** – il mirino della fotocamera con tre modalità:
  - **Foto prodotto**: inquadri il prodotto con la data, l'IA legge nome, scadenza ("da consumarsi entro" o "preferibilmente entro"), dove va e quanto dura una volta aperto;
  - **Codice a barre**: lo scanner di Google riconosce il prodotto (Open Food Facts); la data la fotografi con **Leggi** o la scegli tu;
  - **Spesa intera**: fotografi tutta la spesa sul tavolo o lo scontrino e aggiungi tutto in un colpo.
  Poi **Scrivi a mano** e, sotto, i prodotti che compri spesso per riaggiungerli con un tocco.
- **Ricette IA** – "Cosa cucino?": un pulsante genera 3 ricette che usano per primi i prodotti in scadenza, con filtri (meno di 20 minuti, leggero, voglia di pasta, senza lattosio, vegetariano, solo quello che ho) e il numero di persone. Ogni ricetta mostra quali prodotti della dispensa salva, cosa manca (da mettere in spesa con un tocco) e il procedimento passo passo. Con **L'ho cucinata** la dispensa si aggiorna da sola.

In più: **lista della spesa** (in alto a destra, si condivide su WhatsApp; i prodotti presi vanno in dispensa con un tocco), **avvisi** alle 18 nei giorni in cui qualcosa scade, **statistiche anti-spreco** (in fondo alla Dispensa), **backup** e **tema scuro** automatico.

## Collegare Gemini (una volta sola, gratis)

Foto e ricette usano Google Gemini con una chiave personale gratuita: la stessa dell'app Nutrizione va bene.

1. Nell'app tocca **Collega Gemini** (nella scheda Aggiungi o Ricette, oppure ⚙️ Impostazioni).
2. Apri il link **aistudio.google.com/apikey**, accedi con Google, tocca **Create API key** e copia la chiave (inizia con `AQ.` o `AIza`).
3. Torna nell'app, incollala e tocca **Salva la chiave**.

Senza chiave l'app funziona lo stesso con codice a barre e inserimento a mano.

## Installare l'app (Android)

1. Dal telefono apri https://github.com/Nikcirri/dispensa/releases/latest
2. In fondo alla pagina, sotto "Assets", tocca il file `Dispensa-vX.Y.Z.apk` per scaricarlo.
3. Apri il file scaricato (dalla notifica o dall'app File).
4. Se Android dice che l'installazione è bloccata, tocca **Impostazioni**, attiva **Consenti da questa origine** e torna indietro.
5. Tocca **Installa**. Se compare un avviso di Play Protect, tocca **Installa comunque**: succede con tutte le app che non arrivano dal Play Store.

## Aggiornare

L'app si aggiorna da sola: quando esce una versione nuova compare in alto l'avviso **Nuova versione**. Tocca **Aggiorna**, la prima volta consenti "Installa app sconosciute", poi **Aggiorna** e **Apri** nella finestra di Android. I dati restano. Da ⚙️ Impostazioni puoi anche **Controlla aggiornamenti**.

## Per chi sviluppa

- Vite + Svelte 5 + TypeScript + Capacitor 8 Android, dati in IndexedDB con Dexie. Stessa base dell'app Nutrizione.
- `src/lib/logic/` funzioni pure con i test (scadenze, cibi, ricette, lettura delle foto, spesa, avvisi, backup); `src/lib/services/` rete e telefono (Gemini, fotocamera, scanner, Open Food Facts, notifiche); `src/views/` schermate e fogli.
- `npm run dev` avvia la versione web, `npm run verify` fa controllo dei tipi, test e build. `python3 tests/smoke.py` (dopo `npm run build`) prova tutta l'app in Chrome con fotocamera finta e risposte di Gemini simulate e salva gli screenshot.
- Quando su `main` cambia la versione in `package.json`, GitHub Actions costruisce l'APK firmato e pubblica la Release `vX.Y.Z`.
- Regole di lavoro: [`CLAUDE.md`](CLAUDE.md). Novità di ogni versione: [`CHANGELOG.md`](CHANGELOG.md).
