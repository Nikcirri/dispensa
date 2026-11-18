<script lang="ts">
  // Più prodotti da mettere in dispensa insieme: dallo scontrino, dalla spesa fotografata sul tavolo
  // o dalla lista della spesa. Basta controllare le date (quelle con ≈ sono stimate) e salvare.
  import { untrack } from 'svelte';
  import { db } from '../../lib/db';
  import { reportError } from '../../lib/errors';
  import { daysBetween, formatLong } from '../../lib/logic/dates';
  import type { ProductDraft } from '../../lib/logic/drafts';
  import { progressHeadline, usedModelText } from '../../lib/logic/gemini';
  import { boughtShoppingIds } from '../../lib/logic/match';
  import { LOCATIONS } from '../../lib/logic/pantry';
  import { isFreshDraft } from '../../lib/logic/receipt';
  import { plural } from '../../lib/logic/text';
  import { tapFeedback } from '../../lib/platform';
  import { deleteShopping } from '../../lib/repo';
  import { scanPhoto } from '../../lib/services/ai';
  import { blobToCanvas, prepareCanvas, takePhoto } from '../../lib/services/camera';
  import { clearReceipt, receipt } from '../../lib/state/add.svelte';
  import { addDrafts, app, hasAiKey, reloadShopping, sheets, type MultiRequest } from '../../lib/state/app.svelte';
  import { setBusyMessage, showToast, withBusy } from '../../lib/state/ui.svelte';
  import ExpiryBadge from '../../lib/ui/ExpiryBadge.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import { blurOnEnter } from '../../lib/ui/keyboard';
  import QtyStepper from '../../lib/ui/QtyStepper.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';

  let { request }: { request: MultiRequest } = $props();

  const req = untrack(() => request);
  const kind = req.kind;
  const note = req.note;
  const aiInfo = req.aiInfo ?? '';
  const today = untrack(() => app.today);

  // I freschi vengono prima: sono quelli con la data da controllare sulla confezione.
  let rows = $state(
    (JSON.parse(JSON.stringify(req.drafts)) as ProductDraft[])
      .map((d, i) => ({ d, on: true, check: isFreshDraft(d, today), i }))
      .sort((a, b) => (a.check === b.check ? a.i - b.i : a.check ? -1 : 1)),
  );
  let saving = $state(false);
  let reading = $state<number | null>(null);
  const chosen = $derived(rows.filter((r) => r.on && r.d.name.trim()));
  const toCheck = $derived(rows.filter((r) => r.on && r.check && r.d.expiryEstimated).length);
  const firstLong = $derived(rows.findIndex((r) => !r.check));

  const title = kind === 'spesa' ? 'Metti in dispensa' : kind === 'scontrino' ? 'Dallo scontrino' : 'Prodotti trovati';

  function close() {
    if (kind === 'scontrino') clearReceipt();
    sheets.multi = null;
  }

  function setDate(i: number, v: string) {
    const r = rows[i];
    if (!r) return;
    r.d.expiry = v || null;
    r.d.expiryEstimated = false;
  }

  /** Fotografa la data sulla confezione di quel prodotto e la scrive al posto di quella stimata. */
  async function readDate(i: number) {
    const r = rows[i];
    if (!r || reading !== null) return;
    if (!hasAiKey()) {
      sheets.aiKey = true;
      return;
    }
    reading = i;
    try {
      const blob = await takePhoto();
      if (!blob) return;
      const img = prepareCanvas(await blobToCanvas(blob), 1024);
      const name = r.d.name || 'prodotto';
      const res = await withBusy(`Leggo la data di ${name}…`, () =>
        scanPhoto(app.aiKey, { base64: img.base64, mime: img.mime }, 'data', name, (p) => setBusyMessage(`Leggo la data di ${name}… ${progressHeadline(p)} (${p.seconds} s)`)),
      );
      const found = res.value.products.find((p) => p.expiry && !p.expiryEstimated);
      if (!found?.expiry) {
        showToast('Non riesco a leggere la data: avvicinati, con più luce, oppure scrivila tu.', { duration: 4500 });
        return;
      }
      r.d.expiry = found.expiry;
      r.d.expiryKind = found.expiryKind;
      r.d.expiryEstimated = false;
      r.d.expiryText = found.expiryText;
      void tapFeedback('medium');
      showToast(`${name}: ${formatLong(found.expiry)} · ${usedModelText(res.model, res.seconds)}`, { duration: 3500 });
    } catch (e) {
      reportError(e);
    } finally {
      reading = null;
    }
  }

  /** Scontrino lungo: si tengono i prodotti trovati (con le modifiche) e si fotografa la parte che manca. */
  function morePhotos() {
    receipt.pending = $state.snapshot(rows).map((r) => r.d) as ProductDraft[];
    receipt.store = req.store ?? '';
    sheets.multi = null;
    app.tab = 'aggiungi';
  }

  async function save() {
    if (!chosen.length || saving) return;
    saving = true;
    try {
      const drafts = chosen.map((r) => ({ ...(JSON.parse(JSON.stringify(r.d)) as ProductDraft), name: r.d.name.trim() }));
      const res = await addDrafts(drafts);
      // Quello che era nella lista della spesa è stato comprato: si toglie dalla lista.
      const bought = req.shoppingIds?.length ? req.shoppingIds : boughtShoppingIds(app.shopping, drafts.map((d) => d.name));
      if (bought.length) {
        await deleteShopping(db, bought);
        await reloadShopping();
      }
      if (kind === 'scontrino') clearReceipt();
      void tapFeedback('medium');
      const parts = [
        `${plural(drafts.length, 'prodotto aggiunto', 'prodotti aggiunti')} in dispensa`,
        res.merged ? (res.merged === 1 ? '1 c’era già: sommato' : `${res.merged} c’erano già: sommati`) : '',
        !req.shoppingIds?.length && bought.length ? `${plural(bought.length, 'tolto', 'tolti')} dalla lista della spesa` : '',
      ].filter(Boolean);
      showToast(parts.join(' · '), { duration: 4000 });
      sheets.multi = null;
    } catch (e) {
      saving = false;
      reportError(e);
    }
  }
</script>

<Sheet {title} onclose={close}>
  <div class="stack">
    <div class="hintbox">
      {#if kind === 'spesa'}
        <p>Controlla dove va ogni prodotto e la data di scadenza (quelle con ≈ sono stimate).</p>
      {:else if kind === 'scontrino'}
        <p>
          Ho letto {plural(rows.length, 'prodotto', 'prodotti')}{req.store ? ` (${req.store})` : ''}. Sullo scontrino le date non ci sono: le ho stimate (≈).
          {#if toCheck}<strong>Correggi quelle dei {toCheck} freschi</strong> con la data sulla confezione: scrivila o tocca <Icon name="camera" size={16} /> per leggerla.{/if}
        </p>
      {:else}
        <p>Ho trovato {plural(rows.length, 'prodotto', 'prodotti')}. Togli la spunta a quelli che non vuoi e controlla le date: quelle con ≈ sono stimate.</p>
      {/if}
      {#if note}<p><em>{note}</em></p>{/if}
      {#if aiInfo}<p class="ai-info">✨ {aiInfo}</p>{/if}
    </div>

    <ul class="rows">
      {#each rows as r, i (r.i)}
        {#if kind !== 'spesa' && i === 0 && r.check}
          <li class="group">Freschi: controlla la data</li>
        {/if}
        {#if kind !== 'spesa' && i === firstLong && i > 0}
          <li class="group">A lunga conservazione: la data stimata di solito va bene</li>
        {/if}
        <li class="prow" class:off={!r.on}>
          <div class="line1">
            <input class="check" type="checkbox" bind:checked={r.on} aria-label="Aggiungi {r.d.name}" />
            <span class="emoji" aria-hidden="true">{r.d.emoji}</span>
            <input class="input name" bind:value={r.d.name} aria-label="Nome" maxlength="80" enterkeyhint="done" onkeydown={blurOnEnter} />
          </div>
          <div class="line2">
            <select class="input small" bind:value={r.d.location} aria-label="Dove">
              {#each LOCATIONS as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
            </select>
            <input
              class="input small date"
              class:est={r.d.expiryEstimated}
              type="date"
              value={r.d.expiry ?? ''}
              onchange={(e) => setDate(i, (e.currentTarget as HTMLInputElement).value)}
              aria-label="Scadenza di {r.d.name}"
            />
            <button class="circle-btn small cam" aria-label="Leggi la data di {r.d.name} dalla confezione" disabled={reading !== null} onclick={() => void readDate(i)}>
              <Icon name="camera" size={20} />
            </button>
          </div>
          <div class="line3">
            <QtyStepper compact quantity={r.d.quantity} unit={r.d.unit} onchange={(q) => (r.d.quantity = q)} onempty={() => (r.on = false)} />
            <ExpiryBadge days={r.d.expiry ? daysBetween(app.today, r.d.expiry) : null} kind={r.d.expiryKind} estimated={r.d.expiryEstimated} />
          </div>
          {#if r.d.brand || r.d.size || r.d.receiptLine}
            <p class="extra">
              {[r.d.brand, r.d.size].filter(Boolean).join(' · ')}
              {#if r.d.receiptLine}<span class="line">🧾 {r.d.receiptLine}</span>{/if}
            </p>
          {/if}
        </li>
      {/each}
    </ul>

    {#if kind === 'scontrino'}
      <button class="more" disabled={saving} onclick={morePhotos} aria-label="Fotografa il resto dello scontrino">
        <Icon name="camera" size={22} />
        <span><strong>Manca un pezzo?</strong> Se lo scontrino è lungo, fotografa il resto: aggiungo i prodotti che mancano.</span>
      </button>
    {/if}
  </div>

  {#snippet footer()}
    <button class="btn btn-primary btn-big btn-block" disabled={!chosen.length || saving} onclick={save}>
      <Icon name="check" /> Aggiungi {plural(chosen.length, 'prodotto', 'prodotti')}
    </button>
  {/snippet}
</Sheet>

<style>
  .hintbox {
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 0.9375rem;
    line-height: 1.45;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .hintbox p {
    margin: 0;
  }
  .hintbox :global(svg) {
    display: inline-block;
    vertical-align: -3px;
  }
  .ai-info {
    font-size: 0.8125rem;
    opacity: 0.8;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .group {
    margin: 6px 4px 0;
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .prow {
    padding: 10px;
    border-radius: 18px;
    background: var(--surface-2);
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: opacity 150ms ease;
  }
  .prow.off {
    opacity: 0.45;
  }
  .line1,
  .line2,
  .line3 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .line3 {
    flex-wrap: wrap;
    padding-left: 32px;
  }
  .check {
    width: 24px;
    height: 24px;
    flex: none;
    accent-color: var(--accent);
  }
  .emoji {
    font-size: 1.6rem;
    flex: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    min-height: 46px;
    font-weight: 600;
  }
  .small {
    min-height: 44px;
    padding: 6px 10px;
    font-size: 0.9375rem;
  }
  select.small {
    flex: 0 0 112px;
    padding-right: 30px;
  }
  .date {
    flex: 1;
    min-width: 0;
  }
  .date.est {
    border-color: var(--amber);
  }
  .cam {
    flex: none;
  }
  .extra {
    margin: 0;
    padding-left: 32px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .line {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    opacity: 0.85;
  }
  .more {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 14px 16px;
    border: 2px dashed var(--border);
    border-radius: 18px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.9375rem;
    line-height: 1.4;
    text-align: left;
    cursor: pointer;
  }
  .more :global(svg) {
    flex: none;
  }
</style>
