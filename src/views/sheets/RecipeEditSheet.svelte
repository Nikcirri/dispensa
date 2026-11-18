<script lang="ts">
  // Una ricetta scritta da te: nuova (tra le salvate), da modificare, oppure gli ingredienti di un pasto del piano.
  // Gli ingredienti si scelgono dalla dispensa (così risultano "in programma") o si scrivono (da comprare).
  import { untrack } from 'svelte';
  import { reportError } from '../../lib/errors';
  import { dishEmoji, whenText } from '../../lib/logic/meals';
  import { buildUserRecipe, stepsFromText, type MissingIngredient, type Recipe, type RecipeUse } from '../../lib/logic/recipes';
  import { splitNames } from '../../lib/logic/shopping';
  import { capitalize, normalize } from '../../lib/logic/text';
  import { tapFeedback } from '../../lib/platform';
  import { app, sheets, type EditRecipeRequest } from '../../lib/state/app.svelte';
  import { addMissingToShopping, changeMeal } from '../../lib/state/meals.svelte';
  import { isSaved, recipes, saveUserRecipe, updateRecipeEverywhere } from '../../lib/state/recipes.svelte';
  import { confirmDialog, showToast } from '../../lib/state/ui.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import ItemPicker from '../../lib/ui/ItemPicker.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';
  import type { Item } from '../../lib/types';

  let { request }: { request: EditRecipeRequest } = $props();
  const req = untrack(() => request);
  const meal = req.mode === 'meal' ? (untrack(() => app.meals.find((m) => m.id === req.mealId)) ?? null) : null;
  const start: Recipe | null = req.mode === 'edit' ? req.recipe : (meal?.recipe ?? null);

  let title = $state(start?.title ?? meal?.title ?? '');
  let servings = $state(start?.servings ?? untrack(() => app.settings.recipes.servings));
  let minutes = $state(String(start?.minutes ?? 30));
  let uses = $state<RecipeUse[]>(start ? start.uses.map((u) => ({ ...u })) : []);
  let missing = $state<MissingIngredient[]>(start ? start.missing.map((m) => ({ ...m })) : []);
  let stepsText = $state(start ? start.steps.join('\n') : '');
  let saveToMine = $state(false);
  let picking = $state(false);
  let newMissing = $state('');
  let saving = $state(false);

  const sheetTitle = req.mode === 'new' ? 'Nuova ricetta' : req.mode === 'edit' ? 'Modifica la ricetta' : 'Ingredienti del piatto';

  function close() {
    sheets.editRecipe = null;
  }

  /** Il prodotto è ancora in dispensa? (un ingrediente scelto prima può essere stato finito). */
  function present(u: RecipeUse): boolean {
    return !!u.itemId && app.items.some((i) => i.id === u.itemId);
  }

  function pick(item: Item) {
    void tapFeedback();
    uses = [...uses, { itemId: item.id, name: item.name, emoji: item.emoji || '🛒', amount: '' }];
    picking = false;
  }

  function addMissing(e?: SubmitEvent) {
    e?.preventDefault();
    const names = splitNames(newMissing);
    if (!names.length) return;
    const have = new Set(missing.map((m) => normalize(m.name)));
    missing = [...missing, ...names.filter((n) => !have.has(normalize(n))).map((n) => ({ name: capitalize(n), amount: '' }))];
    newMissing = '';
  }

  function servingsBy(d: number) {
    servings = Math.min(20, Math.max(1, servings + d));
    void tapFeedback();
  }

  async function save() {
    if (saving) return;
    if (!title.trim()) {
      showToast('Scrivi il nome del piatto');
      return;
    }
    if (newMissing.trim()) addMissing();
    saving = true;
    try {
      const recipe = buildUserRecipe(
        {
          id: start?.id,
          title: capitalize(title.trim()),
          emoji: start && start.title === title.trim() ? start.emoji : dishEmoji(title),
          servings,
          minutes: Number(minutes) || 30,
          uses: $state.snapshot(uses) as RecipeUse[],
          missing: $state.snapshot(missing) as MissingIngredient[],
          steps: stepsFromText(stepsText),
          createdAt: start?.createdAt,
        },
        new Date().toISOString(),
      );
      if (req.mode === 'new') {
        await saveUserRecipe(recipe);
        recipes.view = 'salvate';
        showToast('Ricetta salvata ❤️');
      } else if (req.mode === 'edit') {
        if (isSaved(recipe.id)) await saveUserRecipe(recipe);
        else await updateRecipeEverywhere(recipe);
        showToast('Ricetta aggiornata');
      } else if (meal) {
        await changeMeal(meal.id, { recipe, title: recipe.title, emoji: recipe.emoji });
        if (saveToMine) await saveUserRecipe(recipe);
        showToast('Ingredienti salvati: i prodotti della dispensa risultano in programma');
      }
      void tapFeedback('medium');
      close();
      // Quelli da comprare: si chiede se metterli nella lista della spesa (solo quelli che non ci sono già).
      if (req.mode === 'meal' && recipe.missing.length) {
        const inList = new Set(app.shopping.filter((s) => !s.done).map((s) => normalize(s.name)));
        const toAdd = recipe.missing.filter((m) => !inList.has(normalize(m.name)));
        if (toAdd.length) {
          const ok = await confirmDialog({
            title: 'Li metto nella lista della spesa?',
            message: `Non sono in dispensa: ${toAdd.map((m) => m.name).join(', ')}.`,
            confirmLabel: 'Sì, aggiungi',
            cancelLabel: 'No',
          });
          if (ok) await addMissingToShopping(toAdd);
        }
      }
    } catch (e) {
      saving = false;
      reportError(e);
    }
  }
</script>

<Sheet title={sheetTitle} onclose={close}>
  <div class="stack">
    {#if meal}
      <p class="lead">Per <strong>{whenText(meal.date, meal.slot, app.today)}</strong>: scegli i prodotti della dispensa che userai (risultano “in programma”) e scrivi quelli da comprare.</p>
    {/if}

    <label class="field">
      <span class="label">Nome del piatto</span>
      <input class="input" bind:value={title} maxlength="80" placeholder="Es. Pasta al tonno" autocomplete="off" enterkeyhint="done" />
    </label>

    <section>
      <h3 class="section-title">Dalla dispensa</h3>
      {#if uses.length}
        <ul class="rows">
          {#each uses as u, i (i)}
            <li class:gone={!present(u)}>
              <span class="emoji" aria-hidden="true">{u.emoji}</span>
              <span class="name">{u.name}{#if !present(u)}<small>non c’è più</small>{/if}</span>
              <input class="input qty" bind:value={uses[i]!.amount} placeholder="quanto?" maxlength="40" aria-label="Quantità di {u.name}" />
              <button class="icon-btn" aria-label="Togli {u.name}" onclick={() => (uses = uses.filter((_, j) => j !== i))}><Icon name="close" size={20} /></button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if picking}
        <ItemPicker exclude={uses.map((u) => u.itemId ?? '')} onpick={pick} />
        <button class="btn btn-ghost btn-small" onclick={() => (picking = false)}>Chiudi l’elenco</button>
      {:else}
        <button class="btn btn-soft btn-small" disabled={!app.items.length} onclick={() => (picking = true)}><Icon name="plus" size={20} /> Aggiungi dalla dispensa</button>
      {/if}
    </section>

    <section>
      <h3 class="section-title">Da comprare (non in casa)</h3>
      {#if missing.length}
        <ul class="rows">
          {#each missing as m, i (i)}
            <li>
              <span class="emoji" aria-hidden="true">🛒</span>
              <span class="name">{m.name}</span>
              <input class="input qty" bind:value={missing[i]!.amount} placeholder="quanto?" maxlength="40" aria-label="Quantità di {m.name}" />
              <button class="icon-btn" aria-label="Togli {m.name}" onclick={() => (missing = missing.filter((_, j) => j !== i))}><Icon name="close" size={20} /></button>
            </li>
          {/each}
        </ul>
      {/if}
      <form class="adder" onsubmit={addMissing}>
        <input class="input" bind:value={newMissing} placeholder="Es. basilico, panna" autocomplete="off" enterkeyhint="done" />
        <button class="circle-btn lime addbtn" type="submit" aria-label="Aggiungi" disabled={!newMissing.trim()}><Icon name="plus" size={22} stroke={2.6} /></button>
      </form>
    </section>

    <div class="opts">
      <div class="servings" aria-label="Persone">
        <button aria-label="Una persona in meno" onclick={() => servingsBy(-1)}><Icon name="minus" size={18} /></button>
        <span class="num">👥 {servings}</span>
        <button aria-label="Una persona in più" onclick={() => servingsBy(1)}><Icon name="plus" size={18} /></button>
      </div>
      <label class="time">
        <Icon name="clock" size={18} />
        <input class="input" type="number" inputmode="numeric" min="1" max="600" bind:value={minutes} aria-label="Minuti" />
        <span>min</span>
      </label>
    </div>

    <label class="field">
      <span class="label">Procedimento (facoltativo)</span>
      <textarea class="input steps" rows="4" bind:value={stepsText} placeholder={'Un passaggio per riga.\nSe lo lasci vuoto, puoi farlo scrivere all’IA.'}></textarea>
    </label>

    {#if req.mode === 'meal'}
      <button class="chip" aria-pressed={saveToMine} onclick={() => (saveToMine = !saveToMine)}>❤️ Salva anche tra le mie ricette</button>
    {/if}
  </div>

  {#snippet footer()}
    <button class="btn btn-primary btn-big" disabled={saving} onclick={() => void save()}><Icon name="check" /> Salva</button>
  {/snippet}
</Sheet>

<style>
  .lead {
    margin: 0;
    line-height: 1.5;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-left: 4px;
  }
  .section-title {
    margin-top: 4px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: stretch;
  }
  section > .btn {
    align-self: flex-start;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 10px;
    border-radius: 16px;
    background: var(--surface-2);
  }
  .rows li.gone .name {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .emoji {
    font-size: 1.3rem;
    flex: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
    display: flex;
    flex-direction: column;
  }
  .name small {
    font-weight: 500;
    font-size: 0.8125rem;
    color: var(--red-text);
    text-decoration: none;
  }
  .qty {
    flex: none;
    width: 96px;
    min-height: 40px;
    padding: 6px 10px;
    font-size: 0.9375rem;
  }
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
  .opts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .servings {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .servings button {
    width: 38px;
    height: 38px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .servings span {
    font-size: 0.9375rem;
    font-weight: 600;
    padding: 0 4px;
  }
  .time {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-weight: 600;
  }
  .time .input {
    width: 84px;
    min-height: 44px;
    text-align: center;
  }
  .steps {
    line-height: 1.45;
    border-radius: 20px;
  }
</style>
