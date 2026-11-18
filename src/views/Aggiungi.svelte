<script lang="ts" module>
  import type { ScanMode } from '../lib/logic/scan';

  type AddMode = 'etichetta' | 'barcode' | 'multi';
  // La modalità scelta resta quando si cambia scheda.
  const pref = $state({ mode: 'etichetta' as AddMode });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { errorText, reportError, UserError } from '../lib/errors';
  import { watchForeground, inForeground } from '../lib/foreground';
  import { draftFromName, draftFromTemplate, type ProductDraft } from '../lib/logic/drafts';
  import { scanWaitingMessage } from '../lib/logic/scan';
  import { tapFeedback } from '../lib/platform';
  import { templateByBarcode } from '../lib/repo';
  import { db } from '../lib/db';
  import { scanPhoto } from '../lib/services/ai';
  import { scanBarcode } from '../lib/services/barcode';
  import {
    blobToCanvas,
    CameraUnavailable,
    captureFrame,
    choosePhoto,
    closeViewfinder,
    openViewfinder,
    prepareCanvas,
    setTorch,
    takePhoto,
    type CameraProblem,
    type PreparedImage,
    type Viewfinder,
  } from '../lib/services/camera';
  import { AiError } from '../lib/services/gemini';
  import { lookupBarcode } from '../lib/services/openfoodfacts';
  import { anySheetOpen, app, hasAiKey, sheets } from '../lib/state/app.svelte';
  import { busy, withBusy } from '../lib/state/ui.svelte';
  import Icon, { type IconName } from '../lib/ui/Icon.svelte';
  import ItemThumb from '../lib/ui/ItemThumb.svelte';

  const MODES: { id: AddMode; label: string; icon: IconName; hint: string }[] = [
    { id: 'etichetta', label: 'Foto prodotto', icon: 'tag', hint: 'Inquadra il prodotto con la data di scadenza ben visibile' },
    { id: 'barcode', label: 'Codice a barre', icon: 'barcode', hint: 'Tocca il pulsante e inquadra il codice a barre' },
    { id: 'multi', label: 'Spesa intera', icon: 'receipt', hint: 'Fotografa la spesa sul tavolo oppure lo scontrino' },
  ];

  let video = $state<HTMLVideoElement | null>(null);
  let frameEl = $state<HTMLElement | null>(null);
  let finder: Viewfinder | null = null;
  let camera = $state<'off' | 'starting' | 'live' | 'unavailable'>('off');
  let problem = $state<CameraProblem | null>(null);
  let hasTorch = $state(false);
  let torchOn = $state(false);
  let visible = $state(inForeground());
  let scanningBarcode = $state(false);
  let analyzing = $state<{ preview: string; seconds: number; mode: ScanMode } | null>(null);
  let error = $state<{ message: string; detail: string } | null>(null);
  let runId = 0;

  const current = $derived(MODES.find((m) => m.id === pref.mode) ?? MODES[0]!);
  const needsKey = $derived(pref.mode !== 'barcode' && !hasAiKey());
  const wantCamera = $derived(visible && !anySheetOpen() && !analyzing && !scanningBarcode && !busy.message && camera !== 'unavailable');

  // Il mirino è acceso solo quando serve: con un foglio aperto, durante l'analisi o ad app in background si spegne.
  $effect(() => {
    if (wantCamera && video) void startCamera();
    else stopCamera();
  });

  onMount(() => {
    const stop = watchForeground((active) => (visible = active));
    return () => {
      stop();
      stopCamera();
    };
  });

  async function startCamera() {
    if (finder || camera === 'starting' || !video) return;
    camera = 'starting';
    try {
      const f = await openViewfinder(video);
      // Nel frattempo il mirino potrebbe non servire più (foglio aperto, scheda cambiata).
      if (!wantCamera) {
        closeViewfinder(f, video);
        camera = 'off';
        return;
      }
      finder = f;
      hasTorch = f.hasTorch;
      torchOn = false;
      problem = null;
      camera = 'live';
    } catch (e) {
      problem = e instanceof CameraUnavailable ? e.problem : 'error';
      camera = 'unavailable';
    }
  }

  function stopCamera() {
    if (!finder) {
      if (camera === 'live') camera = 'off';
      return;
    }
    closeViewfinder(finder, video);
    finder = null;
    torchOn = false;
    if (camera !== 'unavailable') camera = 'off';
  }

  function retryCamera() {
    problem = null;
    camera = 'off';
  }

  async function toggleTorch() {
    if (!finder) return;
    torchOn = await setTorch(finder, !torchOn);
  }

  function frameRect() {
    if (!video || !frameEl) return null;
    const v = video.getBoundingClientRect();
    const f = frameEl.getBoundingClientRect();
    return { x: f.left - v.left, y: f.top - v.top, width: f.width, height: f.height };
  }

  async function shutter() {
    error = null;
    if (pref.mode === 'barcode') return startBarcode();
    if (needsKey) {
      sheets.aiKey = true;
      return;
    }
    void tapFeedback('medium');
    try {
      if (camera === 'live' && video) {
        const canvas = captureFrame(video, pref.mode === 'etichetta' ? frameRect() : null);
        await analyze(canvas, pref.mode);
      } else {
        const blob = await takePhoto();
        if (blob) await analyze(await blobToCanvas(blob), pref.mode);
      }
    } catch (e) {
      reportError(e, 'Non riesco a scattare la foto. Riprova.');
    }
  }

  async function fromGallery() {
    error = null;
    if (!hasAiKey()) {
      sheets.aiKey = true;
      return;
    }
    try {
      stopCamera();
      const blob = await choosePhoto();
      if (blob) await analyze(await blobToCanvas(blob), pref.mode === 'multi' ? 'multi' : 'etichetta');
    } catch (e) {
      reportError(e, 'Non riesco ad aprire la foto.');
    }
  }

  async function analyze(canvas: HTMLCanvasElement, mode: ScanMode) {
    let prepared: PreparedImage;
    try {
      prepared = prepareCanvas(canvas, mode === 'multi' ? 1280 : 1024);
    } catch (e) {
      reportError(e);
      return;
    }
    const id = ++runId;
    const t0 = Date.now();
    analyzing = { preview: prepared.dataUrl, seconds: 0, mode };
    const timer = setInterval(() => {
      if (analyzing && id === runId) analyzing.seconds = Math.round((Date.now() - t0) / 1000);
    }, 1000);
    try {
      const res = await scanPhoto(app.aiKey, { base64: prepared.base64, mime: prepared.mime }, mode);
      if (id !== runId) return;
      const products = res.value.products;
      if (!products.length) {
        error = {
          message:
            mode === 'multi'
              ? 'Non ho trovato prodotti da mangiare nella foto. Riprova più da vicino, con più luce.'
              : 'Non riconosco il prodotto. Avvicinati all’etichetta (o usa il codice a barre).',
          detail: res.detail,
        };
        return;
      }
      void tapFeedback('medium');
      openResults(products, res.value.note, prepared.thumb, mode);
    } catch (e) {
      if (id !== runId) return;
      error = { message: e instanceof UserError ? e.message : `Qualcosa è andato storto (${errorText(e)}).`, detail: e instanceof AiError ? e.detail : '' };
    } finally {
      clearInterval(timer);
      if (id === runId) analyzing = null;
    }
  }

  function openResults(products: ProductDraft[], note: string, thumb: string, mode: ScanMode) {
    if (products.length === 1) {
      const p = products[0]!;
      const hint = !p.name
        ? 'Ho letto la data ma non il nome del prodotto: scrivilo tu.'
        : p.expiryEstimated
          ? `Non leggo la data sulla confezione: l’ho stimata${note ? ` (${note.replace(/\.$/, '')})` : ''}. Controllala.`
          : p.expiry
            ? 'Data letta dall’etichetta: controlla che sia giusta.'
            : note;
      sheets.product = { mode: 'new', draft: { ...p, thumb: mode === 'etichetta' ? thumb : undefined }, hint };
      return;
    }
    sheets.multi = { drafts: products.map((p) => ({ ...p, source: 'multi' as const })), note };
  }

  function cancelAnalysis() {
    runId++;
    analyzing = null;
  }

  async function startBarcode() {
    stopCamera();
    scanningBarcode = true;
    try {
      // La prima volta Google Play services scarica lo scanner: si mostra un'attesa.
      const code = await scanBarcode(() => (busy.message = 'Preparo lo scanner di Google (solo la prima volta)…'));
      busy.message = null;
      if (!code) return;
      void tapFeedback('medium');
      const known = await templateByBarcode(db, code);
      if (known) {
        sheets.product = { mode: 'new', draft: draftFromTemplate(known, app.today), hint: 'Prodotto già visto: ho stimato la scadenza come l’ultima volta. Controllala.' };
        return;
      }
      const found = await withBusy('Cerco il prodotto…', () => lookupBarcode(code, app.today));
      if (found.kind === 'found') {
        sheets.product = {
          mode: 'new',
          draft: found.draft,
          hint: 'Trovato con il codice a barre. La data non è nel codice: controlla quella stimata o fotografala.',
        };
      } else {
        sheets.product = {
          mode: 'new',
          draft: { ...draftFromName('', app.today, 'barcode'), barcode: code },
          hint: 'Non conosco questo codice: scrivi il nome. La prossima volta lo riconosco da solo.',
        };
      }
    } catch (e) {
      busy.message = null;
      reportError(e, 'Lo scanner non si è aperto. Riprova o scrivi il prodotto a mano.');
    } finally {
      scanningBarcode = false;
    }
  }

  function manual() {
    sheets.product = { mode: 'new', draft: draftFromName('', app.today), hint: '' };
  }

  function quickAdd(i: number) {
    const t = app.templates[i];
    if (!t) return;
    void tapFeedback();
    sheets.product = { mode: 'new', draft: draftFromTemplate(t, app.today), hint: t.shelfDays ? 'Scadenza stimata come l’ultima volta: controllala.' : '' };
  }

  function setMode(m: AddMode) {
    if (pref.mode === m) return;
    void tapFeedback();
    pref.mode = m;
    error = null;
  }

  const PROBLEM_TEXT: Record<CameraProblem, string> = {
    denied: 'Per usare il mirino serve il permesso della fotocamera. Puoi darlo da Impostazioni di Android → App → Dispensa → Autorizzazioni.',
    unsupported: 'Il mirino non è disponibile qui: usa la fotocamera del telefono con il pulsante qui sotto.',
    none: 'Non trovo una fotocamera.',
    busy: 'La fotocamera è usata da un’altra app. Chiudila e riprova.',
    error: 'La fotocamera non si è accesa.',
  };
</script>

<section class="panel" class:analyzing={!!analyzing}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} class:on={camera === 'live'} playsinline muted></video>

  {#if analyzing}
    <img class="frozen" src={analyzing.preview} alt="" />
    <div class="scanline" aria-hidden="true"></div>
  {/if}

  <div class="overlay">
    <div class="modes" role="group" aria-label="Modalità">
      {#each MODES as m (m.id)}
        <button aria-pressed={pref.mode === m.id} onclick={() => setMode(m.id)} disabled={!!analyzing}>
          <Icon name={m.icon} size={20} />
          <span>{m.label}</span>
        </button>
      {/each}
    </div>

    <div class="stage">
      {#if analyzing}
        <div class="status" in:fade>
          <span class="spinner" aria-hidden="true"></span>
          <span>{scanWaitingMessage(analyzing.seconds, analyzing.mode)}</span>
        </div>
      {:else if camera === 'unavailable' && problem}
        <div class="nocam">
          <Icon name="camera" size={40} />
          <p>{PROBLEM_TEXT[problem]}</p>
          {#if problem !== 'unsupported'}<button class="btn btn-small glass" onclick={retryCamera}>Riprova</button>{/if}
        </div>
      {:else}
        <div bind:this={frameEl} class="frame {pref.mode}" class:dim={camera !== 'live'}>
          <i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
          {#if pref.mode === 'barcode'}<span class="laser" aria-hidden="true"></span>{/if}
        </div>
        <p class="hint">{current.hint}</p>
      {/if}
    </div>

    {#if analyzing}
      <div class="controls">
        <button class="btn glass" onclick={cancelAnalysis}>Annulla</button>
      </div>
    {:else}
      {#if needsKey}
        <button class="keynote" onclick={() => (sheets.aiKey = true)}>
          <Icon name="sparkles" size={18} /> Per leggere le foto collega Gemini (gratis): tocca qui
        </button>
      {/if}
      <div class="controls">
        <button class="round" aria-label="Scegli una foto dalla galleria" onclick={fromGallery} disabled={pref.mode === 'barcode'}>
          <Icon name="image" />
        </button>
        <button class="shutter" class:barcode={pref.mode === 'barcode'} aria-label={pref.mode === 'barcode' ? 'Scansiona il codice a barre' : 'Scatta'} onclick={shutter}>
          {#if pref.mode === 'barcode'}<Icon name="barcode" size={30} />{/if}
        </button>
        <button class="round" aria-label={torchOn ? 'Spegni la torcia' : 'Accendi la torcia'} aria-pressed={torchOn} onclick={toggleTorch} disabled={!hasTorch || camera !== 'live'}>
          <Icon name="flash" filled={torchOn} />
        </button>
      </div>
    {/if}
  </div>
</section>

{#if error}
  <div class="error card" role="alert" transition:fade={{ duration: 150 }}>
    <p>{error.message}</p>
    {#if error.detail}<p class="detail">{error.detail}</p>{/if}
    <div class="error-actions">
      <button class="btn btn-ghost btn-small" onclick={() => (error = null)}>Chiudi</button>
      <button class="btn btn-soft btn-small" onclick={manual}>Scrivi a mano</button>
    </div>
  </div>
{/if}

<div class="below">
  <button class="btn btn-block manual" onclick={manual}><Icon name="pencilLine" /> Scrivi a mano</button>
  {#if app.templates.length}
    <h2 class="section-title">Aggiungi di nuovo</h2>
    <div class="chips scroll">
      {#each app.templates as t, i (t.key)}
        <button class="chip again" onclick={() => quickAdd(i)}>
          <ItemThumb emoji={t.emoji} thumb={t.thumb} imageUrl={t.imageUrl} size={30} />
          {t.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel {
    position: relative;
    flex: 1;
    min-height: 420px;
    border-radius: var(--radius);
    overflow: hidden;
    background: radial-gradient(circle at 50% 40%, #2a302b, var(--camera-bg));
    color: #fff;
  }
  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 250ms ease;
  }
  video.on {
    opacity: 1;
  }
  .frozen {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
    filter: brightness(0.75);
  }
  .scanline {
    position: absolute;
    left: 0;
    right: 0;
    height: 30%;
    background: linear-gradient(180deg, transparent, rgb(106 169 110 / 0.45), transparent);
    animation: sweep 1.8s ease-in-out infinite alternate;
  }
  @keyframes sweep {
    from {
      top: -30%;
    }
    to {
      top: 100%;
    }
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 12px;
    gap: 8px;
  }
  /* I comandi stanno sopra l'ombra del riquadro (che scurisce il resto del mirino). */
  .modes,
  .hint,
  .controls,
  .keynote,
  .status,
  .nocam {
    position: relative;
    z-index: 2;
  }
  .modes {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 22px;
    background: rgb(0 0 0 / 0.45);
  }
  .modes button {
    flex: 1;
    min-height: 56px;
    border: 0;
    border-radius: 18px;
    background: transparent;
    color: rgb(255 255 255 / 0.8);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    font-size: 0.8125rem;
    font-weight: 650;
    cursor: pointer;
    padding: 4px;
    line-height: 1.15;
    text-align: center;
    transition: background 180ms ease, color 180ms ease;
  }
  .modes button[aria-pressed='true'] {
    background: #fff;
    color: #1b201c;
  }
  .stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    min-height: 0;
  }
  .frame {
    position: relative;
    width: 80%;
    max-width: 360px;
    aspect-ratio: 4 / 3;
    border-radius: 20px;
    box-shadow: 0 0 0 999px rgb(0 0 0 / 0.28);
    transition: width 250ms ease, aspect-ratio 250ms ease;
  }
  .frame.barcode {
    width: 84%;
    aspect-ratio: 2.2 / 1;
  }
  .frame.multi {
    width: 92%;
    aspect-ratio: 3 / 4;
    max-height: 100%;
    box-shadow: none;
  }
  .frame.dim {
    box-shadow: none;
  }
  .c {
    position: absolute;
    width: 34px;
    height: 34px;
    border: 4px solid #fff;
  }
  .tl {
    top: 0;
    left: 0;
    border-right: 0;
    border-bottom: 0;
    border-top-left-radius: 20px;
  }
  .tr {
    top: 0;
    right: 0;
    border-left: 0;
    border-bottom: 0;
    border-top-right-radius: 20px;
  }
  .bl {
    bottom: 0;
    left: 0;
    border-right: 0;
    border-top: 0;
    border-bottom-left-radius: 20px;
  }
  .br {
    bottom: 0;
    right: 0;
    border-left: 0;
    border-top: 0;
    border-bottom-right-radius: 20px;
  }
  .laser {
    position: absolute;
    left: 8%;
    right: 8%;
    height: 3px;
    border-radius: 2px;
    background: var(--coral);
    box-shadow: 0 0 12px var(--coral);
    animation: laser 1.6s ease-in-out infinite alternate;
  }
  @keyframes laser {
    from {
      top: 18%;
    }
    to {
      top: 80%;
    }
  }
  .hint {
    margin: 0;
    padding: 8px 14px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.5);
    font-size: 0.9375rem;
    text-align: center;
    max-width: 92%;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.6);
    font-weight: 600;
  }
  .spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 3px solid rgb(255 255 255 / 0.3);
    border-top-color: #fff;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .nocam {
    max-width: 300px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: rgb(255 255 255 / 0.85);
  }
  .nocam p {
    margin: 0;
    line-height: 1.5;
  }
  .glass {
    background: rgb(255 255 255 / 0.16);
    border-color: transparent;
    color: #fff;
  }
  .keynote {
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: var(--amber);
    color: #2b1a00;
    font-size: 0.875rem;
    font-weight: 650;
    cursor: pointer;
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-evenly;
    padding: 4px 0 6px;
    min-height: 84px;
  }
  .round {
    width: 54px;
    height: 54px;
    border: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.16);
    color: #fff;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .round:disabled {
    opacity: 0.35;
  }
  .round[aria-pressed='true'] {
    background: #fff;
    color: #1b201c;
  }
  .shutter {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    border: 5px solid #fff;
    background: var(--accent);
    box-shadow: inset 0 0 0 4px var(--camera-bg);
    color: var(--accent-contrast);
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: transform 120ms ease;
  }
  .shutter:active {
    transform: scale(0.92);
  }
  .shutter.barcode {
    background: var(--accent);
  }
  .error {
    margin-top: 12px;
    border: 1px solid var(--red);
  }
  .error p {
    margin: 0;
    line-height: 1.5;
  }
  .error .detail {
    margin-top: 6px;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .error-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
  }
  .below {
    flex: none;
    margin-top: 12px;
  }
  .manual {
    min-height: 56px;
    border: 0;
    box-shadow: var(--shadow);
  }
  .below .section-title {
    margin-top: 16px;
  }
  .again {
    padding-left: 6px;
    min-height: 44px;
  }
  .again :global(.thumb) {
    border-radius: 50% !important;
  }
</style>
