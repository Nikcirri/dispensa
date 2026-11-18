<script lang="ts">
  // "Programma con l'IA": l'IA propone una ricetta per ogni pasto libero dei prossimi giorni,
  // mettendo i prodotti che scadono prima nei pasti più vicini. Si sceglie cosa tenere e si mette nel piano.
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { usedModelText } from '../../lib/logic/gemini';
  import { whenText, type MealSlot } from '../../lib/logic/meals';
  import { planWaitingMessage } from '../../lib/logic/plan';
  import { plural } from '../../lib/logic/text';
  import { tapFeedback } from '../../lib/platform';
  import { app, openRecipe, sheets } from '../../lib/state/app.svelte';
  import { acceptPlan, generatePlan, planAi, planTargets } from '../../lib/state/meals.svelte';
  import { loadRecipes, recipes, rememberFilters } from '../../lib/state/recipes.svelte';
  import { showToast } from '../../lib/state/ui.svelte';
  import AiStatus from '../../lib/ui/AiStatus.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';

  const DAYS = [
    { n: 2, label: 'Oggi e domani' },
    { n: 3, label: '3 giorni' },
    { n: 5, label: '5 giorni' },
    { n: 7, label: 'Una settimana' },
  ];

  // Ricalcolati quando cambiano le scelte o il piano.
  const targets = $derived(planTargets());
  const targetsText = $derived.by(() => {
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (!first || !last) return '';
    const a = whenText(first.date, first.slot, app.today);
    return targets.length > 1 ? `da ${a} a ${whenText(last.date, last.slot, app.today)}` : a;
  });
  const chosen = $derived(planAi.proposals.filter((p) => p.keep).length);

  // Persone, vegetariano e senza lattosio come nelle Ricette (anche se la scheda Ricette non è ancora stata aperta).
  onMount(() => {
    void loadRecipes().catch(() => undefined);
  });
  let saving = $state(false);

  function close() {
    sheets.planAi = false;
  }

  function toggleSlot(s: MealSlot) {
    void tapFeedback();
    const has = planAi.slots.includes(s);
    if (has && planAi.slots.length === 1) return;
    planAi.slots = has ? planAi.slots.filter((x) => x !== s) : (['pranzo', 'cena'] as MealSlot[]).filter((x) => x === s || planAi.slots.includes(x));
  }

  function servings(delta: number) {
    const next = Math.min(12, Math.max(1, recipes.filters.servings + delta));
    if (next === recipes.filters.servings) return;
    void tapFeedback();
    recipes.filters.servings = next;
    rememberFilters();
  }

  async function accept() {
    if (saving) return;
    saving = true;
    const n = await acceptPlan();
    saving = false;
    if (n) {
      showToast(`${plural(n, 'pasto messo', 'pasti messi')} nel piano 🗓️`, { duration: 3000 });
      close();
    }
  }
</script>

<Sheet title="Riempi il piano con l’IA" onclose={close}>
  <div class="stack">
    {#if !planAi.proposals.length}
      <p class="lead">Ti propongo una ricetta per ogni pasto libero, usando <strong>prima i prodotti che scadono prima</strong>.</p>

      <section>
        <h3 class="label">Quali pasti?</h3>
        <div class="chips">
          <button class="chip" aria-pressed={planAi.slots.includes('pranzo')} onclick={() => toggleSlot('pranzo')}>☀️ Pranzi</button>
          <button class="chip" aria-pressed={planAi.slots.includes('cena')} onclick={() => toggleSlot('cena')}>🌙 Cene</button>
        </div>
      </section>

      <section>
        <h3 class="label">Per quanti giorni?</h3>
        <div class="chips">
          {#each DAYS as d (d.n)}
            <button class="chip" aria-pressed={planAi.days === d.n} onclick={() => ((planAi.days = d.n), void tapFeedback())}>{d.label}</button>
          {/each}
        </div>
      </section>

      <section class="opts">
        <div class="servings" aria-label="Persone">
          <button aria-label="Una persona in meno" onclick={() => servings(-1)}><Icon name="minus" size={18} /></button>
          <span class="num">👥 {recipes.filters.servings}</span>
          <button aria-label="Una persona in più" onclick={() => servings(1)}><Icon name="plus" size={18} /></button>
        </div>
        <button class="chip" aria-pressed={planAi.onlyPantry} onclick={() => (planAi.onlyPantry = !planAi.onlyPantry)}>🏠 Solo quello che ho</button>
        {#if recipes.filters.vegetarian}<span class="tag">🌱 Vegetariano</span>{/if}
        {#if recipes.filters.lactoseFree}<span class="tag">🚫 Senza lattosio</span>{/if}
      </section>

      <textarea class="input extra" rows="2" bind:value={planAi.extra} maxlength="300" placeholder="Altro? Es. pesce il venerdì, la domenica qualcosa di speciale…"></textarea>

      <p class="targets">
        {#if targets.length}
          Riempio <strong>{plural(targets.length, 'pasto libero', 'pasti liberi')}</strong>: {targetsText}.
        {:else}
          Questi pasti sono già tutti in programma: scegli più giorni o anche gli altri pasti.
        {/if}
      </p>

      {#if planAi.loading}
        <div in:fade><AiStatus progress={planAi.progress} message={planWaitingMessage(planAi.seconds)} /></div>
      {:else if planAi.error}
        <div class="card error" role="alert">
          <p>{planAi.error}</p>
          {#if planAi.detail}<p class="detail">{planAi.detail}</p>{/if}
        </div>
      {/if}
    {:else}
      {#if planAi.note}<p class="ai-note">💬 {planAi.note}</p>{/if}
      <p class="lead">Togli la spunta a quello che non ti piace, poi metti il resto nel piano. Il procedimento si scrive quando apri il piatto.</p>
      <ul class="props">
        {#each planAi.proposals as p, i (p.slot.code)}
          <li in:fly={{ y: 12, duration: 220, delay: i * 50 }} class:off={!p.keep}>
            <button class="tick" class:on={p.keep} aria-label={p.keep ? `Togli ${p.recipe.title}` : `Tieni ${p.recipe.title}`} onclick={() => ((p.keep = !p.keep), void tapFeedback())}>
              {#if p.keep}<Icon name="check" size={18} stroke={3} />{/if}
            </button>
            <button class="prop" onclick={() => openRecipe(p.recipe)}>
              <span class="when">{whenText(p.slot.date, p.slot.slot, app.today)}</span>
              <span class="t"><span aria-hidden="true">{p.recipe.emoji}</span> {p.recipe.title}</span>
              {#if p.recipe.uses.length}<span class="s">Usa: {p.recipe.uses.map((u) => u.name).join(', ')}</span>{/if}
              {#if p.recipe.missing.length}<span class="s miss">Da comprare: {p.recipe.missing.map((m) => m.name).join(', ')}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
      {#if planAi.usedModel}<p class="used">✨ {usedModelText(planAi.usedModel, planAi.usedSeconds)}</p>{/if}
    {/if}
  </div>

  {#snippet footer()}
    {#if planAi.proposals.length}
      <div class="foot">
        <button class="btn" onclick={() => (planAi.proposals = [])}><Icon name="refresh" size={20} /> Rifai</button>
        <button class="btn btn-primary grow" disabled={!chosen || saving} onclick={() => void accept()}>
          <Icon name="calendar" size={20} /> Metti nel piano ({chosen})
        </button>
      </div>
    {:else}
      <button class="btn btn-primary btn-big" disabled={planAi.loading || !targets.length} onclick={() => void generatePlan()}>
        <Icon name="sparkles" />
        {planAi.loading ? 'Preparo il piano…' : `Programma ${plural(targets.length, 'pasto', 'pasti')}`}
      </button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .lead {
    margin: 0;
    line-height: 1.5;
  }
  .label {
    margin: 0 0 8px 2px;
    font-size: 0.875rem;
    color: var(--text-muted);
    font-weight: 600;
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
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
  .tag {
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .extra {
    line-height: 1.4;
    border-radius: 20px;
  }
  .targets {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .error p {
    margin: 0;
  }
  .detail {
    margin-top: 6px !important;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .ai-note {
    margin: 0;
    padding: 12px 14px;
    border-radius: 18px;
    background: var(--amber-soft);
    color: var(--amber-text);
    line-height: 1.45;
  }
  .props {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .props li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    border-radius: 18px;
    background: var(--surface-2);
    transition: opacity 150ms ease;
  }
  .props li.off {
    opacity: 0.5;
  }
  .tick {
    width: 32px;
    height: 32px;
    flex: none;
    margin-top: 2px;
    border-radius: 50%;
    border: 2px solid var(--border);
    background: var(--surface);
    display: grid;
    place-items: center;
    color: var(--accent-contrast);
    cursor: pointer;
  }
  .tick.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .prop {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .when {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--accent-text);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .t {
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .s {
    font-size: 0.875rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .miss {
    color: var(--amber-text);
  }
  .used {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .foot {
    width: 100%;
    display: flex;
    gap: 8px;
  }
  .foot > .btn:first-child {
    flex: none;
    padding-left: 18px;
    padding-right: 18px;
  }
  .foot .grow {
    flex: 1;
    min-width: 0;
  }
</style>
