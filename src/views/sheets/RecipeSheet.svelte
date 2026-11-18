<script lang="ts">
  import { untrack } from 'svelte';
  import { db } from '../../lib/db';
  import { reportError } from '../../lib/errors';
  import { plannedMealOf, whenText } from '../../lib/logic/meals';
  import { recipeShareText, savedCount, useStatuses, type Recipe } from '../../lib/logic/recipes';
  import { recipeWaitingMessage } from '../../lib/logic/recipes';
  import { tapFeedback } from '../../lib/platform';
  import { addShopping } from '../../lib/repo';
  import { shareText } from '../../lib/services/share';
  import { app, hasAiKey, reloadShopping, sheets } from '../../lib/state/app.svelte';
  import { generateSteps, isSaved, stepsAi, toggleSaved } from '../../lib/state/recipes.svelte';
  import AiStatus from '../../lib/ui/AiStatus.svelte';
  import { showToast } from '../../lib/state/ui.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';

  let { recipe }: { recipe: Recipe } = $props();
  // La ricetta può cambiare mentre il foglio è aperto (procedimento scritto dall'IA, modifica):
  // si segue, ma si tiene l'ultima quando il foglio si chiude (allora diventa null).
  let current = $state(untrack(() => recipe));
  $effect(() => {
    if (recipe) current = recipe;
  });
  const r = $derived(current);

  const statuses = $derived(useStatuses(r, app.items, app.today));
  const saved = $derived(savedCount(statuses));
  const liked = $derived(isSaved(r.id));
  let doneSteps = $state<boolean[]>(untrack(() => recipe).steps.map(() => false));
  $effect(() => {
    if (doneSteps.length !== r.steps.length) doneSteps = r.steps.map(() => false);
  });
  const writing = $derived(stepsAi.recipeId === r.id);

  function close() {
    sheets.recipe = null;
    sheets.recipeMealId = null;
  }

  // Aperta dal piano dei pasti: si vede per quale pasto è.
  const fromMeal = $derived(sheets.recipeMealId ? app.meals.find((m) => m.id === sheets.recipeMealId) ?? null : null);

  async function missingToShopping() {
    try {
      for (const m of [...r.missing].reverse()) await addShopping(db, m.name, m.amount);
      await reloadShopping();
      void tapFeedback();
      showToast(r.missing.length === 1 ? 'Aggiunto alla spesa' : `${r.missing.length} ingredienti aggiunti alla spesa`);
    } catch (e) {
      reportError(e);
    }
  }

  async function share() {
    try {
      await shareText(r.title, recipeShareText(r));
    } catch (e) {
      reportError(e);
    }
  }

  function cooked() {
    const mealId = sheets.recipeMealId ?? plannedMealOf(r.id, app.meals, app.today)?.id ?? null;
    sheets.cooked = { recipe: $state.snapshot(r) as Recipe, title: r.title, mealId };
  }

  function edit() {
    sheets.editRecipe = { mode: 'edit', recipe: $state.snapshot(r) as Recipe };
  }
</script>

<Sheet title={r.title} onclose={close}>
  <div class="stack">
    <div class="hero">
      <span class="emoji" aria-hidden="true">{r.emoji}</span>
      <div class="facts">
        <span><Icon name="clock" size={18} /> {r.minutes} min</span>
        <span>{r.difficulty}</span>
        <span><Icon name="users" size={18} /> {r.servings} {r.servings === 1 ? 'persona' : 'persone'}</span>
      </div>
    </div>
    {#if r.why}<p class="why" class:hot={saved > 0}>♻️ {r.why}</p>{/if}
    {#if fromMeal}
      <p class="planned"><Icon name="calendar" size={18} /> Nel piano: {whenText(fromMeal.date, fromMeal.slot, app.today)}</p>
    {:else}
      <button class="btn btn-soft btn-small planbtn" onclick={() => (sheets.plan = { recipe: $state.snapshot(r) as Recipe })}>
        <Icon name="calendar" size={20} /> Mettila nel piano dei pasti
      </button>
    {/if}

    {#if statuses.length}
    <section>
      <h3 class="section-title">Dalla tua dispensa</h3>
      <ul class="ing">
        {#each statuses as s, i (i)}
          <li class={s.urgency} class:gone={!s.present}>
            <span class="dotc" aria-hidden="true"></span>
            <span aria-hidden="true">{s.emoji}</span>
            <span class="grow">{s.name}</span>
            <span class="amount">{s.amount}</span>
          </li>
        {/each}
      </ul>
      {#if statuses.some((s) => !s.present)}<p class="note">I prodotti barrati non sono più in dispensa.</p>{/if}
    </section>
    {/if}

    {#if r.missing.length}
      <section>
        <h3 class="section-title">Da comprare</h3>
        <ul class="ing">
          {#each r.missing as m, i (i)}
            <li>
              <span aria-hidden="true">🛒</span>
              <span class="grow">{m.name}</span>
              <span class="amount">{m.amount}</span>
            </li>
          {/each}
        </ul>
        <button class="btn btn-soft btn-small tospesa" onclick={missingToShopping}><Icon name="cartPlus" size={20} /> Aggiungi alla spesa</button>
      </section>
    {/if}

    <section>
      <h3 class="section-title">Procedimento</h3>
      {#if !r.steps.length}
        {#if writing}
          <AiStatus progress={stepsAi.progress} message={recipeWaitingMessage(stepsAi.seconds)} />
        {:else}
          <p class="note nosteps">
            {r.source === 'utente' ? 'Non hai scritto il procedimento.' : 'Il procedimento non c’è ancora: i piatti del piano arrivano senza, per fare prima.'}
          </p>
          {#if stepsAi.error}
            <div class="card error" role="alert">
              <p>{stepsAi.error}</p>
              {#if stepsAi.detail}<p class="detail">{stepsAi.detail}</p>{/if}
            </div>
          {/if}
          {#if hasAiKey()}
            <button class="btn btn-soft writebtn" onclick={() => void generateSteps(r)}><Icon name="sparkles" size={20} /> Scrivi il procedimento con l’IA</button>
          {/if}
        {/if}
      {/if}
      <ol class="steps">
        {#each r.steps as step, i (i)}
          <li>
            <button class:done={doneSteps[i]} onclick={() => ((doneSteps[i] = !doneSteps[i]), void tapFeedback())}>
              <span class="n">{doneSteps[i] ? '✓' : i + 1}</span>
              <span class="t">{step}</span>
            </button>
          </li>
        {/each}
      </ol>
      {#if r.steps.length}<p class="note">Tocca un passaggio quando l’hai fatto.</p>{/if}
    </section>

    {#if r.tip}<p class="tip">💡 {r.tip}</p>{/if}

    <div class="side-actions">
      <button class="btn btn-small" onclick={() => void toggleSaved(r)}><Icon name="heart" filled={liked} size={20} /> {liked ? 'Salvata' : 'Salva'}</button>
      <button class="btn btn-small" onclick={share}><Icon name="share" size={20} /> Condividi</button>
      <button class="btn btn-small" onclick={edit}><Icon name="edit" size={20} /> Modifica</button>
    </div>
  </div>

  {#snippet footer()}
    <button class="btn btn-primary btn-big" onclick={cooked}><Icon name="check" /> L’ho cucinata</button>
  {/snippet}
</Sheet>

<style>
  .nosteps {
    margin: 0 0 10px;
  }
  .writebtn {
    align-self: flex-start;
  }
  .error p {
    margin: 0;
  }
  .error .detail {
    margin-top: 6px;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .planned {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--accent-text);
  }
  .planbtn {
    align-self: flex-start;
  }
  .hero {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .emoji {
    font-size: 3rem;
    width: 76px;
    height: 76px;
    border-radius: 22px;
    background: var(--surface-2);
    display: grid;
    place-items: center;
    flex: none;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .facts span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 0.875rem;
    font-weight: 600;
  }
  .why {
    margin: 0;
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--green-soft);
    color: var(--green-text);
    font-weight: 600;
    line-height: 1.45;
  }
  .why.hot {
    background: linear-gradient(120deg, var(--red-soft), var(--amber-soft));
    color: var(--red-text);
  }
  section .section-title {
    margin-top: 6px;
  }
  .ing {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: 18px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .ing li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
  }
  .ing li:last-child {
    border-bottom: 0;
  }
  .grow {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 550;
  }
  .amount {
    flex: none;
    max-width: 40%;
    text-align: right;
    color: var(--text-muted);
    font-size: 0.9375rem;
  }
  .dotc {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--border);
    flex: none;
  }
  .rosso .dotc,
  .scaduto .dotc {
    background: var(--red);
  }
  .arancione .dotc {
    background: var(--amber);
  }
  .verde .dotc {
    background: var(--accent);
  }
  .gone .grow {
    text-decoration: line-through;
    color: var(--text-muted);
  }
  .tospesa {
    margin-top: 10px;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .steps button {
    width: 100%;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px;
    border: 0;
    border-radius: 16px;
    background: var(--surface-2);
    text-align: left;
    cursor: pointer;
    line-height: 1.5;
    transition: opacity 150ms ease;
  }
  .n {
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 700;
    display: grid;
    place-items: center;
    font-size: 0.9375rem;
  }
  .steps button.done {
    opacity: 0.55;
  }
  .steps button.done .t {
    text-decoration: line-through;
  }
  .tip {
    margin: 0;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--amber-soft);
    color: var(--amber-text);
    line-height: 1.5;
  }
  .side-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .side-actions .btn {
    flex: 1 1 auto;
  }
</style>
