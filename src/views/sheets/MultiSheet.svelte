<script lang="ts">
  import { blurOnEnter } from '../../lib/ui/keyboard';
  import { untrack } from 'svelte';
  import { db } from '../../lib/db';
  import { reportError } from '../../lib/errors';
  import { daysBetween } from '../../lib/logic/dates';
  import type { ProductDraft } from '../../lib/logic/drafts';
  import { LOCATIONS } from '../../lib/logic/pantry';
  import { plural } from '../../lib/logic/text';
  import { tapFeedback } from '../../lib/platform';
  import { deleteShopping } from '../../lib/repo';
  import { addDrafts, app, reloadShopping, sheets } from '../../lib/state/app.svelte';
  import { showToast } from '../../lib/state/ui.svelte';
  import ExpiryBadge from '../../lib/ui/ExpiryBadge.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';

  let { request }: { request: { drafts: ProductDraft[]; note: string; shoppingIds?: string[]; aiInfo?: string } } = $props();

  const req = untrack(() => request);
  const note = req.note;
  const aiInfo = req.aiInfo ?? '';
  const shoppingIds = req.shoppingIds ?? [];
  const fromShopping = shoppingIds.length > 0;
  let rows = $state(
    (JSON.parse(JSON.stringify(req.drafts)) as ProductDraft[]).map((d) => ({ d, on: true })),
  );
  let saving = $state(false);
  const chosen = $derived(rows.filter((r) => r.on && r.d.name.trim()));

  function close() {
    sheets.multi = null;
  }

  function setDate(i: number, v: string) {
    const r = rows[i];
    if (!r) return;
    r.d.expiry = v || null;
    r.d.expiryEstimated = false;
  }

  async function save() {
    if (!chosen.length || saving) return;
    saving = true;
    try {
      const drafts = chosen.map((r) => ({ ...(JSON.parse(JSON.stringify(r.d)) as ProductDraft), name: r.d.name.trim() }));
      await addDrafts(drafts);
      if (shoppingIds.length) {
        await deleteShopping(db, shoppingIds);
        await reloadShopping();
      }
      void tapFeedback('medium');
      showToast(`${plural(drafts.length, 'prodotto aggiunto', 'prodotti aggiunti')} in dispensa`);
      close();
    } catch (e) {
      saving = false;
      reportError(e);
    }
  }
</script>

<Sheet title={fromShopping ? 'Metti in dispensa' : 'Prodotti trovati'} onclose={close}>
  <div class="stack">
    <p class="hintbox">
      {#if fromShopping}
        Controlla dove va ogni prodotto e la data di scadenza (quelle con ≈ sono stimate).
      {:else}
        Ho trovato {plural(rows.length, 'prodotto', 'prodotti')}. Togli la spunta a quelli che non vuoi e controlla le date: quelle con ≈ sono stimate.
      {/if}
      {#if note}<br /><em>{note}</em>{/if}
      {#if aiInfo}<br /><span class="ai-info">✨ {aiInfo}</span>{/if}
    </p>

    <ul class="rows">
      {#each rows as r, i (i)}
        <li class:off={!r.on}>
          <div class="line1">
            <input class="check" type="checkbox" bind:checked={r.on} aria-label="Aggiungi {r.d.name}" />
            <span class="emoji" aria-hidden="true">{r.d.emoji}</span>
            <input class="input name" bind:value={r.d.name} aria-label="Nome" maxlength="80" enterkeyhint="done" onkeydown={blurOnEnter} />
          </div>
          <div class="line2">
            <select class="input small" bind:value={r.d.location} aria-label="Dove">
              {#each LOCATIONS as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
            </select>
            <input class="input small date" type="date" value={r.d.expiry ?? ''} onchange={(e) => setDate(i, (e.currentTarget as HTMLInputElement).value)} aria-label="Scadenza" />
          </div>
          <div class="line3">
            <ExpiryBadge days={r.d.expiry ? daysBetween(app.today, r.d.expiry) : null} kind={r.d.expiryKind} estimated={r.d.expiryEstimated} />
            <span class="extra">{[r.d.brand, r.d.size, r.d.quantity !== 1 || r.d.unit !== 'pz' ? `${r.d.quantity} ${r.d.unit}` : ''].filter(Boolean).join(' · ')}</span>
          </div>
        </li>
      {/each}
    </ul>
  </div>

  {#snippet footer()}
    <button class="btn btn-primary btn-big" disabled={!chosen.length || saving} onclick={save}>
      <Icon name="check" /> Aggiungi {plural(chosen.length, 'prodotto', 'prodotti')}
    </button>
  {/snippet}
</Sheet>

<style>
  .hintbox {
    margin: 0;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 0.9375rem;
    line-height: 1.45;
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
  li {
    padding: 10px;
    border-radius: 18px;
    background: var(--surface-2);
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: opacity 150ms ease;
  }
  li.off {
    opacity: 0.45;
  }
  .line1,
  .line2 {
    display: flex;
    align-items: center;
    gap: 8px;
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
    flex: 0 0 120px;
    padding-right: 30px;
  }
  .date {
    flex: 1;
    min-width: 0;
  }
  .line3 {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-left: 32px;
  }
  .extra {
    font-size: 0.8125rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
</style>
