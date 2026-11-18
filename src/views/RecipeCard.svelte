<script lang="ts">
  import { savedCount, useStatuses, type Recipe } from '../lib/logic/recipes';
  import { app, openRecipe, sheets } from '../lib/state/app.svelte';
  import { isSaved, toggleSaved } from '../lib/state/recipes.svelte';
  import Icon from '../lib/ui/Icon.svelte';

  let { recipe }: { recipe: Recipe } = $props();

  const statuses = $derived(useStatuses(recipe, app.items, app.today));
  const saved = $derived(savedCount(statuses));
  const present = $derived(statuses.filter((s) => s.present).length);
  const liked = $derived(isSaved(recipe.id));
  // Già nel piano dei pasti (da oggi in avanti)?
  const planned = $derived(app.meals.some((m) => m.recipe?.id === recipe.id && m.date >= app.today));
</script>

<article class="recipe">
  <button class="open" onclick={() => openRecipe(recipe)}>
    <div class="top">
      <span class="emoji" aria-hidden="true">{recipe.emoji}</span>
      <div class="titles">
        <h3>{recipe.title}</h3>
        <p class="meta">
          <span><Icon name="clock" size={16} /> {recipe.minutes} min</span>
          <span>· {recipe.difficulty}</span>
          <span>· <Icon name="users" size={16} /> {recipe.servings}</span>
        </p>
        {#if recipe.source === 'utente'}<span class="mine">✍️ Ricetta tua</span>{/if}
      </div>
    </div>

    {#if present}
      <div class="svuota" class:hot={saved > 0}>
        <span class="tag">♻️ Svuota-Frigo</span>
        <span>Usa {present === 1 ? '1 tuo prodotto' : `${present} tuoi prodotti`}{saved ? ` · ${saved} in scadenza` : ''}</span>
      </div>
    {/if}

    <div class="uses">
      {#each statuses as s, i (i)}
        <span class="use {s.urgency}" class:gone={!s.present}>
          <span aria-hidden="true">{s.emoji}</span>
          {s.name}{s.amount ? ` · ${s.amount}` : ''}
        </span>
      {/each}
    </div>

    {#if recipe.missing.length}
      <p class="missing"><strong>Ti manca:</strong> {recipe.missing.map((m) => m.name + (m.amount ? ` (${m.amount})` : '')).join(', ')}</p>
    {:else if recipe.uses.length}
      <p class="missing ok">✓ Hai già tutto in casa</p>
    {/if}
    {#if recipe.why}<p class="why">{recipe.why}</p>{/if}
  </button>
  <div class="actions">
    <button class="btn btn-soft btn-small grow" onclick={() => openRecipe(recipe)}>Procedimento <Icon name="chevronRight" size={18} /></button>
    <button class="icon-btn cal" class:on={planned} aria-label={planned ? 'Già nel piano dei pasti: mettila in un altro giorno' : 'Metti nel piano dei pasti'} onclick={() => (sheets.plan = { recipe: $state.snapshot(recipe) as Recipe })}>
      <Icon name="calendar" />
    </button>
    <button class="icon-btn heart" class:on={liked} aria-label={liked ? 'Togli dalle salvate' : 'Salva la ricetta'} aria-pressed={liked} onclick={() => void toggleSaved(recipe)}>
      <Icon name="heart" filled={liked} />
    </button>
  </div>
</article>

<style>
  .recipe {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .open {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    padding: 16px 16px 4px;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .top {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .emoji {
    font-size: 2.4rem;
    line-height: 1;
    width: 56px;
    height: 56px;
    border-radius: 18px;
    background: var(--accent-soft);
    display: grid;
    place-items: center;
    flex: none;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: 1.1875rem;
    overflow-wrap: anywhere;
  }
  .meta {
    margin: 4px 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .meta span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .svuota {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border-radius: 14px;
    background: var(--green-soft);
    color: var(--green-text);
    font-size: 0.875rem;
    font-weight: 600;
  }
  .svuota.hot {
    background: linear-gradient(120deg, var(--red-soft), var(--amber-soft));
    color: var(--red-text);
  }
  .tag {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface);
    font-weight: 750;
  }
  .uses {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .use {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 999px;
    font-size: 0.875rem;
    font-weight: 600;
    background: var(--grey-soft);
    color: var(--grey-text);
  }
  .use.rosso,
  .use.scaduto {
    background: var(--red);
    color: #fff;
  }
  .use.arancione {
    background: var(--amber-soft);
    color: var(--amber-text);
  }
  .use.verde {
    background: var(--green-soft);
    color: var(--green-text);
  }
  .use.gone {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .missing {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .missing.ok {
    color: var(--accent-text);
    font-weight: 600;
  }
  .why {
    margin: 0;
    font-size: 0.9375rem;
    font-style: italic;
    color: var(--text-muted);
  }
  .mine {
    display: inline-block;
    margin-top: 4px;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 0.8125rem;
    font-weight: 700;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 14px 16px;
  }
  .grow {
    flex: 1;
  }
  .cal {
    color: var(--text-muted);
    background: var(--surface-2);
    border-radius: 50%;
  }
  .cal.on {
    color: var(--accent-contrast);
    background: var(--accent);
  }
  .heart {
    color: var(--text-muted);
    background: var(--surface-2);
    border-radius: 50%;
  }
  .heart.on {
    color: var(--coral);
    animation: beat 300ms ease-out;
  }
  @keyframes beat {
    50% {
      transform: scale(1.25);
    }
  }
</style>
