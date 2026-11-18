<script lang="ts">
  // "Quando la cucini?": si sceglie il giorno e il pasto per una ricetta, oppure dove spostare un pasto.
  import { untrack } from 'svelte';
  import { reportError } from '../../lib/errors';
  import { addDays } from '../../lib/logic/dates';
  import { dayTitle, daySubtitle, firstFreeSlot, isPastSlot, mealsByDay, SLOTS, whenText, type MealSlot } from '../../lib/logic/meals';
  import { effectiveExpiry } from '../../lib/logic/expiry';
  import { liveRecipe } from '../../lib/logic/match';
  import type { Recipe } from '../../lib/logic/recipes';
  import { app, sheets, type PlanRequest } from '../../lib/state/app.svelte';
  import { addRecipeMeal, changeMeal } from '../../lib/state/meals.svelte';
  import { showToast } from '../../lib/state/ui.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';
  import type { Item } from '../../lib/types';

  let { request }: { request: PlanRequest } = $props();
  const req = untrack(() => request);
  const moving = 'mealId' in req ? untrack(() => app.meals.find((m) => m.id === req.mealId)) ?? null : null;
  const recipe: Recipe | null = 'recipe' in req ? req.recipe : (moving?.recipe ?? null);

  const hour = new Date().getHours();
  const days = $derived(Array.from({ length: 14 }, (_, i) => addDays(app.today, i)));
  const byDay = $derived(mealsByDay(app.meals, days));
  const suggested = $derived(firstFreeSlot(app.meals, app.today, hour));

  // Il giorno in cui scade il primo ingrediente della ricetta: meglio cucinarla entro quel giorno.
  const deadline = $derived.by(() => {
    if (!recipe) return null;
    const dates = liveRecipe(recipe, app.items).uses
      .map((u) => app.items.find((i) => i.id === u.itemId))
      .filter((i): i is Item => !!i && i.expiryKind === 'scadenza')
      .map((i) => effectiveExpiry(i))
      .filter((d): d is string => !!d && d >= app.today && d < addDays(app.today, 14))
      .sort();
    return dates[0] ?? null;
  });

  function close() {
    sheets.plan = null;
  }

  async function pick(date: string, slot: MealSlot) {
    try {
      if (moving) {
        await changeMeal(moving.id, { date, slot, done: false });
        showToast(`${moving.title}: ${whenText(date, slot, app.today)}`);
      } else if (recipe) {
        await addRecipeMeal($state.snapshot(recipe) as Recipe, date, slot);
        showToast(`Nel piano: ${whenText(date, slot, app.today)}`);
      }
      close();
    } catch (e) {
      reportError(e);
    }
  }

  function late(date: string): boolean {
    return !!deadline && date > deadline;
  }
</script>

<Sheet title={moving ? 'Sposta il pasto' : 'Quando la cucini?'} onclose={close}>
  <div class="stack">
    <p class="lead">
      {#if moving}
        <strong>{moving.emoji} {moving.title}</strong>: scegli il nuovo giorno.
      {:else if recipe}
        <strong>{recipe.emoji} {recipe.title}</strong>: tocca il pranzo o la cena.
      {/if}
      {#if deadline}<br /><span class="note">⏰ Meglio entro {dayTitle(deadline, app.today).toLowerCase()} ({daySubtitle(deadline, app.today)}): poi un ingrediente scade.</span>{/if}
    </p>
    <ul class="days">
      {#each days as d (d)}
        {@const dm = byDay.get(d)}
        <li class:late={late(d)}>
          <span class="dname">
            <strong>{dayTitle(d, app.today)}</strong>
            <span>{daySubtitle(d, app.today)}</span>
          </span>
          {#each SLOTS as s (s.id)}
            {@const n = dm ? dm[s.id].length : 0}
            {@const isMine = moving && moving.date === d && moving.slot === s.id}
            <button
              class="slot"
              class:busy={n > 0}
              class:suggested={!moving && suggested.date === d && suggested.slot === s.id}
              disabled={isPastSlot(d, s.id, app.today, hour) || !!isMine}
              onclick={() => void pick(d, s.id)}
            >
              <span aria-hidden="true">{s.emoji}</span>
              <span class="sl">{s.label}</span>
              {#if n}<span class="count num">{isMine ? 'qui' : `+${n}`}</span>{/if}
            </button>
          {/each}
        </li>
      {/each}
    </ul>
  </div>
</Sheet>

<style>
  .lead {
    margin: 0;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .note {
    color: var(--red-text);
    font-size: 0.9375rem;
  }
  .days {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
  li:last-child {
    border-bottom: 0;
  }
  .dname {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .dname span {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .late .dname strong {
    color: var(--text-muted);
  }
  .slot {
    flex: none;
    min-width: 0;
    min-height: 46px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: transform 120ms ease, background 150ms ease;
  }
  .slot:active {
    transform: scale(0.96);
  }
  .slot:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .slot.suggested {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }
  .slot.busy:not(.suggested) {
    background: var(--surface-2);
  }
  .count {
    font-size: 0.75rem;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--ink);
    color: #fff;
  }
</style>
