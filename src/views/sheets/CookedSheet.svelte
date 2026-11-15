<script lang="ts">
  import { untrack } from 'svelte';
  import { db } from '../../lib/db';
  import { reportError } from '../../lib/errors';
  import type { Recipe } from '../../lib/logic/recipes';
  import { plural } from '../../lib/logic/text';
  import { tapFeedback } from '../../lib/platform';
  import { removeItem, updateItem } from '../../lib/repo';
  import { app, reloadItems, sheets } from '../../lib/state/app.svelte';
  import { showToast } from '../../lib/state/ui.svelte';
  import ExpiryBadge from '../../lib/ui/ExpiryBadge.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import ItemThumb from '../../lib/ui/ItemThumb.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';
  import { daysLeft } from '../../lib/logic/expiry';
  import type { Item } from '../../lib/types';

  // Dopo aver cucinato: i prodotti usati si tolgono dalla dispensa (o restano, già aperti).
  let { recipe }: { recipe: Recipe } = $props();

  type Choice = 'finito' | 'resta' | 'no';
  const used: Item[] = untrack(() => recipe).uses
    .map((u) => (u.itemId ? app.items.find((i) => i.id === u.itemId) : undefined))
    .filter((i): i is Item => i !== undefined)
    .map((i) => $state.snapshot(i) as Item);
  let choices = $state<Choice[]>(used.map(() => 'finito'));
  let saving = $state(false);

  function close() {
    sheets.cooked = null;
  }

  async function apply() {
    if (saving) return;
    saving = true;
    let finished = 0;
    try {
      for (let i = 0; i < used.length; i++) {
        const item = used[i]!;
        const c = choices[i];
        if (c === 'finito') {
          await removeItem(db, item, 'consumato', app.today);
          finished++;
        } else if (c === 'resta' && !item.openedAt) {
          await updateItem(db, item.id, { openedAt: app.today });
        }
      }
      await reloadItems();
      void tapFeedback('medium');
      showToast(finished ? `Ottimo! ${plural(finished, 'prodotto salvato', 'prodotti salvati')} dallo spreco 🌱` : 'Dispensa aggiornata', { duration: 3500 });
      sheets.cooked = null;
      sheets.recipe = null;
    } catch (e) {
      saving = false;
      reportError(e);
    }
  }
</script>

<Sheet title="Com’è andata?" onclose={close}>
  <div class="stack">
    {#if used.length}
      <p class="lead">Aggiorno la dispensa: cosa è rimasto dei prodotti usati?</p>
      <ul class="list">
        {#each used as it, i (it.id)}
          <li>
            <div class="top">
              <ItemThumb emoji={it.emoji} thumb={it.thumb} imageUrl={it.imageUrl} size={44} />
              <span class="name">{it.name}</span>
              <ExpiryBadge days={daysLeft(it, app.today)} kind={it.expiryKind} estimated={it.expiryEstimated} />
            </div>
            <div class="segmented">
              <button aria-pressed={choices[i] === 'finito'} onclick={() => (choices[i] = 'finito')}>Finito</button>
              <button aria-pressed={choices[i] === 'resta'} onclick={() => (choices[i] = 'resta')}>Ne resta</button>
              <button aria-pressed={choices[i] === 'no'} onclick={() => (choices[i] = 'no')}>Non usato</button>
            </div>
          </li>
        {/each}
      </ul>
      <p class="note">“Ne resta” lo segna come aperto, così la data si accorcia se serve.</p>
    {:else}
      <p class="lead">I prodotti di questa ricetta non sono più in dispensa: non c’è niente da aggiornare. Buon appetito! 🍽️</p>
    {/if}
  </div>

  {#snippet footer()}
    {#if used.length}
      <button class="btn btn-primary btn-big" disabled={saving} onclick={apply}><Icon name="check" /> Aggiorna la dispensa</button>
    {:else}
      <button class="btn btn-primary btn-big" onclick={() => ((sheets.cooked = null), (sheets.recipe = null))}>Chiudi</button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .lead {
    margin: 0;
    line-height: 1.5;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-bottom: 1px solid var(--border);
  }
  li:last-child {
    border-bottom: 0;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .segmented button {
    font-size: 0.875rem;
  }
</style>
