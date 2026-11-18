<script lang="ts">
  // Un pasto del piano: aggiungerne uno (scritto o da una ricetta) oppure guardare, spostare, togliere quello scelto.
  import { onMount, untrack } from 'svelte';
  import { reportError } from '../../lib/errors';
  import { capitalize, plural } from '../../lib/logic/text';
  import { dishEmoji, mealWarnings, warningText, whenText, type Meal } from '../../lib/logic/meals';
  import { savedCount, useStatuses, type Recipe } from '../../lib/logic/recipes';
  import { app, hasAiKey, openRecipe, sheets, type MealRequest } from '../../lib/state/app.svelte';
  import { addMissingToShopping, addRecipeMeal, addTextMeal, changeMeal, removeMeal, startCooking, toggleMealDone } from '../../lib/state/meals.svelte';
  import { loadRecipes, recipes } from '../../lib/state/recipes.svelte';
  import { showToast } from '../../lib/state/ui.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';

  let { request }: { request: MealRequest } = $props();
  const req = untrack(() => request);

  // Il pasto aperto resta aggiornato (es. "Fatto" toccato qui o la ricetta cucinata).
  const meal = $derived(req.mode === 'edit' ? app.meals.find((m) => m.id === req.id) ?? null : null);
  const date = req.mode === 'new' ? req.date : (untrack(() => app.meals.find((m) => m.id === req.id))?.date ?? app.today);
  const slot = req.mode === 'new' ? req.slot : (untrack(() => app.meals.find((m) => m.id === req.id))?.slot ?? 'cena');

  let text = $state('');
  let title = $state(untrack(() => meal?.title ?? ''));
  let input = $state<HTMLInputElement | null>(null);

  const warns = $derived(meal ? mealWarnings(meal, app.items, app.today) : []);
  const ideas = $derived(dedupe([...recipes.list, ...recipes.saved]));

  onMount(() => {
    loadRecipes().catch((e: unknown) => reportError(e));
  });

  // Se il pasto viene tolto (o non c'è più), il foglio si chiude.
  $effect(() => {
    if (req.mode === 'edit' && !meal) sheets.meal = null;
  });

  function dedupe(list: Recipe[]): Recipe[] {
    const seen = new Set<string>();
    return list.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  }

  function close() {
    sheets.meal = null;
  }

  async function addText(e?: SubmitEvent) {
    e?.preventDefault();
    if (!text.trim()) {
      input?.focus();
      return;
    }
    await addTextMeal(text, date, slot);
    showToast(`Aggiunto: ${whenText(date, slot, app.today)}`);
    close();
  }

  async function addRecipe(r: Recipe) {
    try {
      await addRecipeMeal($state.snapshot(r) as Recipe, date, slot);
      showToast(`${r.title}: ${whenText(date, slot, app.today)}`);
      close();
    } catch (e) {
      reportError(e);
    }
  }

  async function saveTitle() {
    if (!meal) return;
    const t = capitalize(title.trim());
    if (!t) {
      title = meal.title;
      return;
    }
    if (t === meal.title) return;
    await changeMeal(meal.id, { title: t, emoji: meal.recipe ? meal.emoji : dishEmoji(t) });
  }

  function askIdeas() {
    close();
    recipes.view = 'nuove';
    app.tab = 'ricette';
  }

  function used(r: Recipe): string {
    const n = savedCount(useStatuses(r, app.items, app.today));
    return n ? `${plural(n, 'prodotto in scadenza', 'prodotti in scadenza')}` : `${r.minutes} min`;
  }

  async function remove(m: Meal) {
    close();
    await removeMeal(m);
  }
</script>

<Sheet title={capitalize(whenText(date, slot, app.today))} onclose={close}>
  <div class="stack">
    {#if req.mode === 'new'}
      <form class="adder" onsubmit={addText}>
        <input class="input" bind:this={input} bind:value={text} placeholder="Cosa cucini? Es. pasta al pesto" maxlength="80" autocomplete="off" enterkeyhint="done" />
        <button class="circle-btn lime addbtn" type="submit" aria-label="Aggiungi al piano"><Icon name="plus" size={24} stroke={2.6} /></button>
      </form>

      <section>
        <h3 class="section-title">Dalle ricette</h3>
        {#if ideas.length}
          <ul class="ideas">
            {#each ideas as r (r.id)}
              <li>
                <button class="idea" onclick={() => void addRecipe(r)}>
                  <span class="emoji" aria-hidden="true">{r.emoji}</span>
                  <span class="grow">
                    <span class="t">{r.title}</span>
                    <span class="s">{used(r)}</span>
                  </span>
                  <span class="plus"><Icon name="plus" size={20} /></span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">Qui compaiono le ricette proposte dall’IA e quelle salvate col ❤️.</p>
        {/if}
        {#if hasAiKey()}
          <button class="btn btn-soft btn-block ask" onclick={askIdeas}><Icon name="sparkles" size={20} /> Chiedi nuove idee all’IA</button>
        {/if}
      </section>
    {:else if meal}
      <div class="head">
        <span class="big-emoji" aria-hidden="true">{meal.emoji}</span>
        <input class="input title-in" bind:value={title} maxlength="80" aria-label="Nome del piatto" onblur={() => void saveTitle()} onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
      </div>

      {#if warns.length}
        <div class="warn">
          {#each warns as w, i (i)}<p>⚠️ {warningText(w, app.today)}</p>{/each}
        </div>
      {/if}

      {#if !meal.recipe}
        <button class="card recipe-link" onclick={() => (sheets.editRecipe = { mode: 'meal', mealId: meal.id })}>
          <span class="icon-tile"><Icon name="list" /></span>
          <span class="grow">
            <strong>Scegli gli ingredienti</strong>
            <span>Dalla dispensa (risultano “in programma”) e da comprare</span>
          </span>
          <Icon name="chevronRight" size={20} />
        </button>
      {/if}

      {#if meal.recipe}
        {@const r = meal.recipe}
        <button class="card recipe-link" onclick={() => openRecipe(r, meal.id)}>
          <span class="icon-tile"><Icon name="chef" /></span>
          <span class="grow">
            <strong>Apri la ricetta</strong>
            <span>{r.minutes} min · {r.difficulty}{r.uses.length ? ` · usa ${r.uses.map((u) => u.name).slice(0, 3).join(', ')}` : ''}</span>
          </span>
          <Icon name="chevronRight" size={20} />
        </button>
        <div class="row-btns">
          <button class="btn btn-soft btn-small" onclick={() => (sheets.editRecipe = { mode: 'meal', mealId: meal.id })}>
            <Icon name="edit" size={20} /> Modifica ingredienti
          </button>
          {#if r.missing.length}
            <button class="btn btn-soft btn-small" onclick={() => void addMissingToShopping(r.missing)}>
              <Icon name="cartPlus" size={20} /> Mancanti alla spesa ({r.missing.length})
            </button>
          {/if}
        </div>
      {/if}

      <div class="actions">
        {#if meal.done}
          <button class="btn" onclick={() => void toggleMealDone(meal)}><Icon name="refresh" size={20} /> Segna da fare</button>
        {:else}
          <button class="btn btn-primary" onclick={() => startCooking(meal)}><Icon name="check" size={20} /> L’ho cucinato</button>
        {/if}
        <button class="btn" onclick={() => (sheets.plan = { mealId: meal.id })}><Icon name="calendar" size={20} /> Sposta in un altro giorno</button>
        <button class="btn btn-ghost danger" onclick={() => void remove(meal)}><Icon name="trash" size={20} /> Togli dal piano</button>
      </div>
    {/if}
  </div>
</Sheet>

<style>
  .adder {
    display: flex;
    gap: 8px;
  }
  .adder .input {
    flex: 1;
    min-width: 0;
  }
  .addbtn {
    width: 52px;
    height: 52px;
    flex: none;
  }
  .section-title {
    margin-top: 6px;
  }
  .ideas {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .idea {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 0;
    border-radius: 18px;
    background: var(--surface-2);
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .idea:active {
    transform: scale(0.99);
  }
  .emoji {
    font-size: 1.6rem;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    background: var(--surface);
    display: grid;
    place-items: center;
    flex: none;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .t {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .s {
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .plus {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-contrast);
    display: grid;
    place-items: center;
    flex: none;
  }
  .muted {
    margin: 0 2px;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .ask {
    margin-top: 12px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .big-emoji {
    font-size: 2.4rem;
    width: 64px;
    height: 64px;
    border-radius: 20px;
    background: var(--surface-2);
    display: grid;
    place-items: center;
    flex: none;
  }
  .title-in {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }
  .warn p {
    margin: 0;
  }
  .warn {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 14px;
    border-radius: 16px;
    background: var(--red-soft);
    color: var(--red-text);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .recipe-link {
    display: flex;
    align-items: center;
    gap: 12px;
    border: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
    padding: 14px;
  }
  .recipe-link .grow span {
    font-size: 0.875rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .row-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .danger {
    color: var(--red-text);
  }
</style>
