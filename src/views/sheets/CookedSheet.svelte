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
  import { cookedDefault, scaleAmount } from '../../lib/logic/recipes';
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
    /** Quantità della ricetta (per le persone della ricetta). */
    base: string;
    /** Quanto ne è stato usato per le persone scelte, es. "3" o "150 g". */
    amount: string;
    /** Quanti ne restano se si sceglie "Ne resta" (null: si segna solo come aperto). */
    left: number | null;
    choice: Choice;
    /** La scelta l'ha cambiata chi usa l'app: cambiando le persone non si tocca. */
    touched: boolean;
  }

  // Per quante persone è la ricetta, e per quante è stata cucinata davvero (si può cambiare).
  const recipeServings = Math.min(20, Math.max(1, req.recipe?.servings ?? 2));
  let people = $state(recipeServings);

  function row(item: Item, base: string, factor = 1): Row {
    const amount = scaleAmount(base, factor);
    // Usato solo in parte (es. 4 uova su 6, 240 g su 500): di partenza "Ne resta".
    return { item, base, amount, ...cookedDefault(item, amount), touched: false };
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
  const fromRecipe = $derived(rows.some((r) => r.base));

  /** Cambia le persone: le quantità usate (e quanto resta) si ricalcolano. */
  function setPeople(n: number) {
    const next = Math.min(20, Math.max(1, n));
    if (next === people) return;
    people = next;
    void tapFeedback();
    const factor = next / recipeServings;
    rows = rows.map((r) => {
      if (!r.base) return r;
      const amount = scaleAmount(r.base, factor);
      const d = cookedDefault(r.item, amount);
      return { ...r, amount, left: d.left, choice: r.touched ? (r.choice === 'resta' && d.left === null && d.choice === 'finito' ? 'finito' : r.choice) : d.choice };
    });
  }

  function choose(i: number, c: Choice) {
    const r = rows[i];
    if (!r) return;
    r.choice = c;
    r.touched = true;
  }
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

    {#if req.recipe && fromRecipe}
      <div class="people">
        <span class="people-text">Per quante persone l’hai cucinato?</span>
        <div class="servings" aria-label="Persone">
          <button aria-label="Una persona in meno" disabled={people <= 1} onclick={() => setPeople(people - 1)}><Icon name="minus" size={18} /></button>
          <span class="num">👥 {people}</span>
          <button aria-label="Una persona in più" disabled={people >= 20} onclick={() => setPeople(people + 1)}><Icon name="plus" size={18} /></button>
        </div>
        {#if people !== recipeServings}
          <span class="people-note">La ricetta era per {plural(recipeServings, 'persona', 'persone')}: ho ricalcolato quanto hai usato.</span>
        {/if}
      </div>
    {/if}

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
              <button aria-pressed={r.choice === 'finito'} onclick={() => choose(i, 'finito')}>Finito</button>
              <button aria-pressed={r.choice === 'resta'} onclick={() => choose(i, 'resta')}>{leftText(r)}</button>
              <button aria-pressed={r.choice === 'no'} onclick={() => choose(i, 'no')}>Non usato</button>
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
  .people {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    padding: 12px 14px;
    border-radius: 18px;
    background: var(--surface-2);
  }
  .people-text {
    font-weight: 650;
    flex: 1 1 160px;
    min-width: 0;
    line-height: 1.35;
  }
  .servings {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    flex: none;
  }
  .servings button {
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: inherit;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .servings button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .servings .num {
    min-width: 52px;
    text-align: center;
    font-size: 1rem;
    font-weight: 650;
  }
  .people-note {
    flex-basis: 100%;
    font-size: 0.875rem;
    color: var(--text-muted);
    line-height: 1.4;
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
