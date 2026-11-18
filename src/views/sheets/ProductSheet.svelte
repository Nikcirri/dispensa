<script lang="ts">
  import { blurOnEnter } from '../../lib/ui/keyboard';
  import { untrack } from 'svelte';
  import { db } from '../../lib/db';
  import { reportError } from '../../lib/errors';
  import { addDays, addMonths, daysBetween, formatLong } from '../../lib/logic/dates';
  import { effectiveExpiry, expiryText, limitedByOpening, pastDateAdvice } from '../../lib/logic/expiry';
  import { guessFood, isKnownFood, UNITS } from '../../lib/logic/foods';
  import { LOCATIONS } from '../../lib/logic/pantry';
  import type { ProductDraft } from '../../lib/logic/drafts';
  import { capitalize } from '../../lib/logic/text';
  import { tapFeedback } from '../../lib/platform';
  import { deleteItem, deleteShopping } from '../../lib/repo';
  import { scanPhoto } from '../../lib/services/ai';
  import { blobToCanvas, prepareCanvas, takePhoto } from '../../lib/services/camera';
  import {
    addDrafts,
    addToShopping,
    app,
    finishItem,
    hasAiKey,
    reloadItems,
    reloadShopping,
    saveEdit,
    sheets,
    type ProductRequest,
  } from '../../lib/state/app.svelte';
  import { confirmDialog, setBusyMessage, showToast, withBusy } from '../../lib/state/ui.svelte';
  import { progressHeadline, usedModelText } from '../../lib/logic/gemini';
  import Icon, { type IconName } from '../../lib/ui/Icon.svelte';
  import ItemThumb from '../../lib/ui/ItemThumb.svelte';
  import QtyStepper from '../../lib/ui/QtyStepper.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';
  import type { Location } from '../../lib/types';

  let { request }: { request: ProductRequest } = $props();

  // Copia di lavoro: la richiesta diventa null quando il foglio si chiude.
  const req = untrack(() => request);
  const mode = req.mode;
  const itemId = req.itemId;
  const shoppingId = req.shoppingId;
  const hint = req.hint ?? '';
  const aiInfo = req.aiInfo ?? '';
  let d = $state<ProductDraft>(JSON.parse(JSON.stringify(req.draft)) as ProductDraft);
  let showPicker = $state(false);
  let showMore = $state(mode === 'edit' && !!(d.brand || d.size || d.note || d.openDays));
  let saving = $state(false);
  let nameInput = $state<HTMLInputElement | null>(null);

  // Scrivendo il nome a mano icona, posto e durata si indovinano finché non li cambi tu.
  const autoGuess = mode === 'new' && !d.name && !d.thumb && !d.imageUrl;
  let touched = $state({ emoji: false, location: false, expiry: false });

  const LOCATION_ICONS: Record<Location, IconName> = { frigo: 'fridge', freezer: 'snowflake', dispensa: 'jar' };
  const EMOJIS = [
    '🥛', '🧀', '🥚', '🧈', '🥣', '🥓', '🍗', '🥩', '🐟', '🦐', '🍝', '🍚', '🥟', '🍞', '🥨', '🍪', '🍫', '🍯', '🫙', '🥫', '🫘', '🫒', '🧂', '🌾',
    '🍎', '🍐', '🍊', '🍋', '🍌', '🍇', '🍓', '🥝', '🍑', '🍉', '🥑', '🍅', '🥕', '🥔', '🧅', '🧄', '🥒', '🍆', '🫑', '🥦', '🥬', '🍄', '🌿', '🥗',
    '🍲', '🍕', '🧊', '🍨', '☕', '🧃', '💧', '🍺', '🍷', '🥜', '🍿', '🛒',
  ];

  const QUICK_DATES: { label: string; apply: (today: string) => string }[] = [
    { label: '+3 giorni', apply: (t) => addDays(t, 3) },
    { label: '+1 settimana', apply: (t) => addDays(t, 7) },
    { label: '+1 mese', apply: (t) => addMonths(t, 1) },
    { label: '+3 mesi', apply: (t) => addMonths(t, 3) },
    { label: '+1 anno', apply: (t) => addMonths(t, 12) },
  ];

  const effective = $derived(effectiveExpiry({ expiry: d.expiry, openedAt: d.openedAt ?? null, openDays: d.openDays }));
  const days = $derived(effective ? daysBetween(app.today, effective) : null);
  const canSave = $derived(d.name.trim().length > 0 && !saving);

  $effect(() => {
    if (mode === 'new' && !d.name) setTimeout(() => nameInput?.focus(), 250);
  });

  function onName() {
    if (!autoGuess || !isKnownFood(d.name)) return;
    const g = guessFood(d.name);
    if (!touched.emoji) d.emoji = g.emoji;
    if (!touched.location) d.location = g.location;
    if (!touched.expiry) {
      d.expiry = g.shelfDays ? addDays(app.today, g.shelfDays) : null;
      d.expiryEstimated = g.shelfDays !== null;
      d.expiryKind = g.kind;
    }
    if (d.openDays === null) d.openDays = g.openDays;
  }

  function pickEmoji(e: string) {
    d.emoji = e;
    d.thumb = undefined;
    d.imageUrl = undefined;
    touched.emoji = true;
    showPicker = false;
    void tapFeedback();
  }

  function setLocation(l: Location) {
    touched.location = true;
    // Mettendo in freezer un prodotto fresco, dura molto di più.
    if (l === 'freezer' && d.location !== 'freezer' && (!d.expiry || daysBetween(app.today, d.expiry) < 60)) {
      d.expiry = addMonths(app.today, 3);
      d.expiryEstimated = true;
      d.expiryKind = 'tmc';
    }
    d.location = l;
  }

  function setQuickDate(apply: (today: string) => string) {
    d.expiry = apply(app.today);
    d.expiryEstimated = true;
    touched.expiry = true;
    void tapFeedback();
  }

  function onDateInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    d.expiry = v || null;
    d.expiryEstimated = false;
    touched.expiry = true;
  }

  function noExpiry() {
    d.expiry = null;
    d.expiryEstimated = false;
    touched.expiry = true;
  }

  async function readDate() {
    if (!hasAiKey()) {
      sheets.aiKey = true;
      return;
    }
    try {
      const blob = await takePhoto();
      if (!blob) return;
      const img = prepareCanvas(await blobToCanvas(blob), 1024);
      const res = await withBusy('Leggo la data…', () =>
        scanPhoto(app.aiKey, { base64: img.base64, mime: img.mime }, 'data', d.name || 'prodotto', (p) => setBusyMessage(`Leggo la data… ${progressHeadline(p)} (${p.seconds} s)`)),
      );
      const found = res.value.products.find((p) => p.expiry && !p.expiryEstimated);
      if (!found?.expiry) {
        showToast('Non riesco a leggere la data: avvicinati, con più luce, oppure scrivila tu.', { duration: 4500 });
        return;
      }
      d.expiry = found.expiry;
      d.expiryKind = found.expiryKind;
      d.expiryEstimated = false;
      d.expiryText = found.expiryText;
      touched.expiry = true;
      void tapFeedback('medium');
      showToast(`Data letta: ${formatLong(found.expiry)} · ${usedModelText(res.model, res.seconds)}`, { duration: 4000 });
    } catch (e) {
      reportError(e);
    }
  }

  function setOpened(on: boolean) {
    d.openedAt = on ? app.today : null;
    if (on && !d.openDays) d.openDays = guessFood(d.name).openDays ?? 3;
  }

  function close() {
    sheets.product = null;
  }

  async function save() {
    if (!canSave) return;
    saving = true;
    const draft = JSON.parse(JSON.stringify(d)) as ProductDraft;
    draft.name = capitalize(draft.name.trim());
    try {
      if (mode === 'edit' && itemId) {
        await saveEdit(itemId, draft);
        showToast('Modifiche salvate');
      } else {
        await addDrafts([draft]);
        if (shoppingId) {
          await deleteShopping(db, [shoppingId]);
          await reloadShopping();
        }
        void tapFeedback('medium');
        showToast(`${draft.emoji} ${draft.name} in dispensa`);
      }
      close();
    } catch (e) {
      saving = false;
      reportError(e);
    }
  }

  function currentItem() {
    return itemId ? app.items.find((i) => i.id === itemId) : undefined;
  }

  async function finish(outcome: 'consumato' | 'buttato') {
    const item = currentItem();
    if (!item) return;
    close();
    await finishItem(item, outcome);
  }

  async function remove() {
    const item = currentItem();
    if (!item) return;
    const ok = await confirmDialog({
      title: 'Eliminare il prodotto?',
      message: 'Usalo solo se l’hai aggiunto per sbaglio: non conta nelle statistiche. Se l’hai mangiato tocca “Finito”.',
      confirmLabel: 'Elimina',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteItem(db, item.id);
      await reloadItems();
      close();
      showToast('Prodotto eliminato');
    } catch (e) {
      reportError(e);
    }
  }
</script>

<Sheet title={mode === 'edit' ? 'Modifica prodotto' : 'Conferma prodotto'} onclose={close}>
  <div class="stack">
    {#if hint || aiInfo}
      <div class="hintbox">
        {#if hint}<p>{hint}</p>{/if}
        {#if aiInfo}<p class="ai-info">✨ {aiInfo}</p>{/if}
      </div>
    {/if}

    <div class="head">
      <button class="pic" aria-label="Cambia icona" onclick={() => (showPicker = !showPicker)}>
        <ItemThumb emoji={d.emoji} thumb={d.thumb} imageUrl={d.imageUrl} size={72} />
        <span class="pen"><Icon name="edit" size={14} /></span>
      </button>
      <label class="field grow">
        <span>Nome</span>
        <input class="input big" bind:this={nameInput} bind:value={d.name} oninput={onName} placeholder="Es. Latte parzialmente scremato" autocomplete="off" maxlength="80" enterkeyhint="done" onkeydown={blurOnEnter} />
      </label>
    </div>

    {#if showPicker}
      <div class="emojis" role="group" aria-label="Scegli l’icona">
        {#each EMOJIS as e (e)}
          <button class:sel={d.emoji === e && !d.thumb} onclick={() => pickEmoji(e)}>{e}</button>
        {/each}
      </div>
    {/if}

    <div class="field">
      <span>Dove lo metti</span>
      <div class="segmented">
        {#each LOCATIONS as l (l.id)}
          <button aria-pressed={d.location === l.id} onclick={() => setLocation(l.id)}><Icon name={LOCATION_ICONS[l.id]} size={18} /> {l.label}</button>
        {/each}
      </div>
    </div>

    <div class="field">
      <span>Data di scadenza</span>
      <div class="date-row">
        <input class="input date" type="date" value={d.expiry ?? ''} onchange={onDateInput} aria-label="Data di scadenza" />
        <button class="btn btn-soft read" onclick={readDate}><Icon name="camera" size={20} /> Leggi</button>
      </div>
      <div class="chips quick">
        {#each QUICK_DATES as q (q.label)}
          <button class="chip small" onclick={() => setQuickDate(q.apply)}>{q.label}</button>
        {/each}
        <button class="chip small" aria-pressed={d.expiry === null} onclick={noExpiry}>Nessuna</button>
      </div>
      <p class="expinfo" class:est={d.expiryEstimated}>
        {#if d.expiry}
          {d.expiryEstimated ? '≈ Stimata' : d.expiryText ? `✓ Letta: “${d.expiryText}”` : '✓'} · {expiryText(days, d.expiryKind, effective, app.today)}
          {#if effective && limitedByOpening({ expiry: d.expiry, openedAt: d.openedAt ?? null, openDays: d.openDays })} (dall’apertura){/if}
        {:else}
          Nessuna scadenza: resta in fondo all’elenco.
        {/if}
      </p>
      {#if days !== null && days < 0}<p class="warning">{pastDateAdvice(d.expiryKind)}</p>{/if}
      <div class="segmented kind">
        <button aria-pressed={d.expiryKind === 'scadenza'} onclick={() => (d.expiryKind = 'scadenza')}>Da consumarsi entro</button>
        <button aria-pressed={d.expiryKind === 'tmc'} onclick={() => (d.expiryKind = 'tmc')}>Preferibilmente entro</button>
      </div>
    </div>

    <div class="field">
      <span>Quantità</span>
      <div class="qty-row">
        <QtyStepper quantity={d.quantity} unit={d.unit} onchange={(q) => (d.quantity = q)} />
        <select class="input unit" bind:value={d.unit} aria-label="Unità">
          {#each UNITS as u (u.id)}<option value={u.id}>{u.label}</option>{/each}
        </select>
      </div>
    </div>

    <label class="switch-line">
      <span class="grow">
        <strong>Già aperto</strong>
        <small>{d.openedAt ? `Dal ${formatLong(d.openedAt)}` : 'Una volta aperto molti prodotti durano meno'}</small>
      </span>
      <input class="switch" type="checkbox" checked={!!d.openedAt} onchange={(e) => setOpened((e.currentTarget as HTMLInputElement).checked)} />
    </label>

    <button class="more" onclick={() => (showMore = !showMore)} aria-expanded={showMore}>
      <span>Altri dettagli</span>
      <span class="chev" class:open={showMore}><Icon name="chevronDown" size={20} /></span>
    </button>
    {#if showMore}
      <div class="stack more-box">
        <div class="two">
          <label class="field">
            <span>Marca</span>
            <input class="input" bind:value={d.brand} maxlength="40" autocomplete="off" enterkeyhint="done" onkeydown={blurOnEnter} />
          </label>
          <label class="field">
            <span>Formato</span>
            <input class="input" bind:value={d.size} maxlength="30" placeholder="500 g" autocomplete="off" enterkeyhint="done" onkeydown={blurOnEnter} />
          </label>
        </div>
        <label class="field">
          <span>Una volta aperto, da consumare entro (giorni)</span>
          <input
            class="input num"
            type="number"
            inputmode="numeric"
            min="1"
            max="365"
            value={d.openDays ?? ''}
            oninput={(e) => {
              const n = parseInt((e.currentTarget as HTMLInputElement).value, 10);
              d.openDays = Number.isFinite(n) && n > 0 ? Math.min(365, n) : null;
            }}
            placeholder="Es. 3"
            enterkeyhint="done"
            onkeydown={blurOnEnter}
          />
        </label>
        <label class="field">
          <span>Nota</span>
          <input class="input" bind:value={d.note} maxlength="200" placeholder="Es. ripiano in alto" autocomplete="off" enterkeyhint="done" onkeydown={blurOnEnter} />
        </label>
        {#if d.barcode}<p class="note">Codice a barre: {d.barcode}</p>{/if}
      </div>
    {/if}

    {#if mode === 'edit'}
      <div class="edit-actions">
        <button class="btn btn-soft" onclick={() => finish('consumato')}><Icon name="check" /> Finito</button>
        <button class="btn" onclick={() => finish('buttato')}><Icon name="trash" /> Buttato</button>
        <button class="btn" onclick={() => void addToShopping(d.name)}><Icon name="cartPlus" /> In spesa</button>
        <button class="btn btn-ghost danger" onclick={remove}>Elimina</button>
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <button class="btn btn-primary btn-big" disabled={!canSave} onclick={save}>
      <Icon name="check" />
      {mode === 'edit' ? 'Salva le modifiche' : 'Conferma e salva in dispensa'}
    </button>
  {/snippet}
</Sheet>

<style>
  .hintbox p {
    margin: 0;
  }
  .ai-info {
    margin-top: 4px !important;
    font-size: 0.8125rem;
    opacity: 0.8;
  }
  .hintbox {
    margin: 0;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 0.9375rem;
    line-height: 1.45;
  }
  .head {
    display: flex;
    align-items: flex-end;
    gap: 12px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .pic {
    position: relative;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    border-radius: 18px;
  }
  .pen {
    position: absolute;
    right: -4px;
    bottom: -4px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow);
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
  }
  .input.big {
    font-weight: 600;
  }
  .emojis {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
    gap: 4px;
    padding: 8px;
    border-radius: 16px;
    background: var(--surface-2);
  }
  .emojis button {
    height: 44px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    font-size: 1.5rem;
    cursor: pointer;
  }
  .emojis button.sel {
    background: var(--surface);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .date-row {
    display: flex;
    gap: 8px;
  }
  .date {
    flex: 1;
    min-width: 0;
  }
  .read {
    flex: none;
    min-height: 52px;
  }
  .quick {
    margin-top: 2px;
  }
  .chip.small {
    min-height: 36px;
    padding: 0 12px;
    font-size: 0.875rem;
  }
  .expinfo {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--accent-text);
    font-weight: 600;
  }
  .expinfo.est {
    color: var(--amber-text);
  }
  .kind button {
    font-size: 0.8125rem;
    min-height: 40px;
  }
  .qty-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .unit {
    flex: 1;
    min-width: 120px;
  }
  .switch-line {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--surface-2);
    cursor: pointer;
  }
  .switch-line .grow {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .switch-line small {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }
  .more {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 48px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    font-weight: 650;
    color: var(--text-muted);
    cursor: pointer;
  }
  .chev {
    transition: transform 200ms ease;
  }
  .chev.open {
    transform: rotate(180deg);
  }
  .more-box {
    margin-top: -6px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .edit-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .edit-actions .danger {
    color: var(--danger);
  }
</style>
