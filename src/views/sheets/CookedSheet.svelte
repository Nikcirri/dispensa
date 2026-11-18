<script lang="ts">
  // "Com'è andata?": dopo aver cucinato si aggiorna la dispensa (finito, ne resta, non usato)
  // e il pasto del piano diventa fatto. Si possono aggiungere altri prodotti usati.
  import { untrack } from 'svelte';
  import { db } from '../../lib/db';
  import { reportError } from '../../lib/errors';
  import { daysLeft } from '../../lib/logic/expiry';
  import { formatQuantity } from '../../lib/logic/foods';
  import { plannedMealOf, whenText } from '../../lib/logic/meals';
  import { liveRecipe } from '../../lib/logic/match';
  import { leftoverAfter } from '../../lib/logic/recipes';
  import { capitalize, plural } from '../../lib/logic/text';
  import { tapFeedback } from '../../lib/platform';
  import { removeItem, updateItem } from '../../lib/repo';
  import { app, reloadItems, sheets, type CookedRequest } from '../../lib/state/app.svelte';
  import { changeMeal } from '../../lib/state/meals.svelte';
  import { showToast } from '../../lib/state/ui.svelte';
  import ExpiryBadge from '../../lib/ui/ExpiryBadge.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import ItemPicker from '../../lib/ui/ItemPicker.svelte';
  import ItemThumb from '../../lib/ui/ItemThumb.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';
  import type { Item } from '../../lib/types';

  let { request }: { request: CookedRequest } = $props();
  const req = untrack(() => request);
  // Il pasto da segnare fatto: quello da cui si arriva, oppure il primo da fare con questa ricetta.
  const mealId = req.mealId ?? (req.recipe ? (untrack(() => plannedMealOf(req.recipe!.id, app.meals, app.today))?.id ?? null) : null);
  const meal = untrack(() => app.meals.find((m) => m.id === mealId)) ?? null;

  type Choice = 'finito' | 'resta' | 'no';
  interface Row {
    item: Item;
    /** Quanto ne è stato usato (dalla ricetta), es. "4" o "200 g". */
    amount: string;
    /** Quanti ne restano se si sceglie "Ne resta" (null: si segna solo come aperto). */
    left: number | null;
    choice: Choice;
  }

  function row(item: Item, amount: string): Row {
    const left = leftoverAfter(item, amount);
    // Usato solo in parte (es. 4 uova su 6): di partenza "Ne resta".
    return { item, amount, left, choice: left !== null ? 'resta' : 'finito' };
  }

  let rows = $state<Row[]>(
    untrack(() =>
      (req.recipe ? liveRecipe(req.recipe, app.items).uses : [])
        .map((u) => {
          const item = u.itemId ? app.items.find((i) => i.id === u.itemId) : undefined;
          return item ? row($state.snapshot(item) as Item, u.amount) : null;
        })
        .filter((r): r is Row => r !== null),
    ),
  );
  let picking = $state(untrack(() => rows.length === 0 && app.items.length > 0));
  let saving = $state(false);

  function close() {
    sheets.cooked = null;
  }

  function addUsed(item: Item) {
    void tapFeedback();
    rows = [...rows, row($state.snapshot(item) as Item, '')];
    picking = false;
  }

  function leftText(r: Row): string {
    if (r.left === null) return 'Ne resta';
    return `Ne restano ${formatQuantity(r.left, r.item.unit)}`;
  }

  async function finish(updatePantry: boolean) {
    if (saving) return;
    saving = true;
    let finished = 0;
    // Prodotti in scadenza (entro 5 giorni) usati: sono quelli "salvati dallo spreco".
    const rescued = rows.filter((r) => {
      if (r.choice === 'no') return false;
      const d = daysLeft(r.item, app.today);
      return d !== null && d <= 5;
    }).length;
    try {
      if (updatePantry) {
        for (const r of rows) {
          if (r.choice === 'finito') {
            await removeItem(db, r.item, 'consumato', app.today);
            finished++;
          } else if (r.choice === 'resta') {
            if (r.left !== null) await updateItem(db, r.item.id, { quantity: r.left });
            else if (!r.item.openedAt) await updateItem(db, r.item.id, { openedAt: app.today });
          }
        }
        await reloadItems();
      }
      if (mealId) await changeMeal(mealId, { done: true, rescued: updatePantry ? rescued : 0 });
      void tapFeedback('medium');
      const message =
        updatePantry && rescued
          ? `Ottimo! ${plural(rescued, 'prodotto in scadenza salvato', 'prodotti in scadenza salvati')} dallo spreco 🌱`
          : updatePantry && finished
            ? `Dispensa aggiornata: ${plural(finished, 'prodotto finito', 'prodotti finiti')}`
            : updatePantry && rows.length
              ? 'Dispensa aggiornata'
              : 'Segnato come cucinato ✓';
      showToast(message, { duration: 3500 });
      sheets.cooked = null;
      sheets.recipe = null;
      sheets.recipeMealId = null;
      sheets.meal = null;
    } catch (e) {
      saving = false;
      reportError(e);
    }
  }
</script>

<Sheet title="Com’è andata?" onclose={close}>
  <div class="stack">
    <div class="dish">
      <span class="dish-emoji" aria-hidden="true">{req.recipe?.emoji ?? meal?.emoji ?? '🍽️'}</span>
      <span class="dish-text">
        <strong>{req.title}</strong>
        {#if meal}<span class="when">{capitalize(whenText(meal.date, meal.slot, app.today))}</span>{/if}
      </span>
    </div>

    {#if rows.length}
      <p class="lead">Aggiorno la dispensa: cosa è rimasto dei prodotti usati?</p>
      <ul class="list">
        {#each rows as r, i (r.item.id)}
          <li>
            <div class="top">
              <ItemThumb emoji={r.item.emoji} thumb={r.item.thumb} imageUrl={r.item.imageUrl} size={44} />
              <span class="name">
                {r.item.name}
                {#if r.amount}<span class="amount">usati: {r.amount}</span>{/if}
              </span>
              <ExpiryBadge days={daysLeft(r.item, app.today)} kind={r.item.expiryKind} estimated={r.item.expiryEstimated} />
            </div>
            <div class="segmented">
              <button aria-pressed={r.choice === 'finito'} onclick={() => (rows[i]!.choice = 'finito')}>Finito</button>
              <button aria-pressed={r.choice === 'resta'} onclick={() => (rows[i]!.choice = 'resta')}>{leftText(r)}</button>
              <button aria-pressed={r.choice === 'no'} onclick={() => (rows[i]!.choice = 'no')}>Non usato</button>
            </div>
          </li>
        {/each}
      </ul>
      <p class="note">“Ne resta” lo segna come aperto (così la data si accorcia se serve), oppure toglie i pezzi usati.</p>
    {:else if !picking}
      <p class="lead">Nessun prodotto della dispensa da aggiornare.</p>
    {/if}

    {#if picking}
      <p class="lead">{rows.length ? 'Altri prodotti usati:' : 'Hai usato qualcosa della dispensa? Toccalo qui sotto.'}</p>
      <ItemPicker exclude={rows.map((r) => r.item.id)} onpick={addUsed} />
    {:else if app.items.length > rows.length}
      <button class="btn btn-soft btn-small more" onclick={() => (picking = true)}><Icon name="plus" size={20} /> Altri prodotti usati</button>
    {/if}

    {#if rows.length}
      <button class="btn btn-ghost skip" disabled={saving} onclick={() => void finish(false)}>Non aggiornare la dispensa, segna solo come cucinato</button>
    {/if}
  </div>

  {#snippet footer()}
    {#if rows.length}
      <button class="btn btn-primary btn-big" disabled={saving} onclick={() => void finish(true)}><Icon name="check" /> Aggiorna la dispensa</button>
    {:else}
      <button class="btn btn-primary btn-big" disabled={saving} onclick={() => void finish(false)}><Icon name="check" /> Segna come cucinato</button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .dish {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .dish-emoji {
    font-size: 1.8rem;
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: var(--surface-2);
    display: grid;
    place-items: center;
    flex: none;
  }
  .dish-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    font-size: 1.0625rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .when {
    font-size: 0.9375rem;
    color: var(--text-muted);
  }
  .lead {
    margin: 0;
    line-height: 1.5;
  }
  .note {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
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
    display: flex;
    flex-direction: column;
  }
  .amount {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .segmented button {
    font-size: 0.875rem;
  }
  .more {
    align-self: flex-start;
  }
  .skip {
    font-size: 0.9375rem;
    color: var(--text-muted);
  }
</style>
