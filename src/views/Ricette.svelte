<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { reportError } from '../lib/errors';
  import { badgeText, daysLeft } from '../lib/logic/expiry';
  import { itemsToUseFirst } from '../lib/logic/pantry';
  import { usedModelText } from '../lib/logic/gemini';
  import { groupRecipes, onlyExpiringMessage, recipeWaitingMessage, type RecipeFilters } from '../lib/logic/recipes';
  import { tapFeedback } from '../lib/platform';
  import { app, hasAiKey, sheets } from '../lib/state/app.svelte';
  import { clearIdeas, generateRecipes, loadRecipes, recipes, rememberFilters } from '../lib/state/recipes.svelte';
  import { showToast } from '../lib/state/ui.svelte';
  import AiStatus from '../lib/ui/AiStatus.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import RecipeCard from './RecipeCard.svelte';

  type BoolFilter = Exclude<keyof RecipeFilters, 'servings' | 'extra'>;
  const PILLS: { id: BoolFilter; label: string }[] = [
    { id: 'onlyExpiring', label: '⏰ Solo in scadenza' },
    { id: 'quick', label: '⏱️ < 20 min' },
    { id: 'light', label: '🥗 Leggero' },
    { id: 'pasta', label: '🍝 Voglia di pasta' },
    { id: 'lactoseFree', label: '🚫 Senza lattosio' },
    { id: 'vegetarian', label: '🌱 Vegetariano' },
    { id: 'onlyPantry', label: '🏠 Solo quello che ho' },
  ];

  const first = $derived(itemsToUseFirst(app.items, app.today, 3));
  const list = $derived(recipes.view === 'salvate' ? recipes.saved : recipes.list);
  // Le idee divise: solo con prodotti in scadenza, con prodotti in scadenza e altri, altre.
  const groups = $derived(recipes.view === 'nuove' ? groupRecipes(recipes.list, app.items, app.today) : []);
  const splitMessage = $derived(recipes.askedOnlyExpiring ? onlyExpiringMessage(groups) : '');
  let showDetail = $state(false);

  let resultsEl = $state<HTMLElement | null>(null);
  let extraInput = $state<HTMLTextAreaElement | null>(null);

  /** Il campo "Altro?" cresce mentre scrivi (fino a 4 righe), così vedi tutta la frase. */
  function fitExtra() {
    const el = extraInput;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 140)}px`;
  }

  $effect(() => {
    void recipes.filters.extra;
    fitExtra();
  });

  /** Invio sulla tastiera (o la freccia) nel campo "Altro?": chiude la tastiera e genera le ricette. */
  function onExtraKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    sendExtra();
  }

  function submitExtra(e: SubmitEvent) {
    e.preventDefault();
    sendExtra();
  }

  function sendExtra() {
    extraInput?.blur();
    if (!app.items.length) {
      showToast('Prima aggiungi qualche prodotto alla dispensa.');
      return;
    }
    void generateRecipes();
  }
  let wasLoading = false;

  onMount(() => {
    loadRecipes().catch((e: unknown) => reportError(e));
  });

  let loadingEl = $state<HTMLElement | null>(null);

  // Mentre l'IA lavora si vede cosa sta facendo; appena arrivano le ricette si scorre fino alla prima.
  $effect(() => {
    const loading = recipes.loading;
    if (loading && !wasLoading) {
      setTimeout(() => loadingEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
    }
    if (wasLoading && !loading && resultsEl) {
      const el = resultsEl;
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
    wasLoading = loading;
  });

  function toggle(id: BoolFilter) {
    void tapFeedback();
    recipes.filters[id] = !recipes.filters[id];
    if (id === 'vegetarian' || id === 'lactoseFree') rememberFilters();
  }

  function servings(delta: number) {
    const next = Math.min(12, Math.max(1, recipes.filters.servings + delta));
    if (next === recipes.filters.servings) return;
    void tapFeedback();
    recipes.filters.servings = next;
    rememberFilters();
  }
</script>

<header class="page-top">
  <div class="grow">
    <p class="hello">Svuota-frigo con l’IA</p>
    <h1>Cosa cucino?</h1>
  </div>
  <div class="segmented views">
    <button aria-pressed={recipes.view === 'nuove'} onclick={() => (recipes.view = 'nuove')}>Idee</button>
    <button aria-pressed={recipes.view === 'salvate'} aria-label="Ricette salvate e tue" onclick={() => (recipes.view = 'salvate')}>❤️ {recipes.saved.length}</button>
  </div>
</header>

{#if recipes.view === 'nuove'}
  {#if !hasAiKey()}
    <div class="card nokey">
      <div class="big" aria-hidden="true">👩‍🍳</div>
      <h2>Ricette con l’IA</h2>
      <p>Collega Google Gemini (gratis, una volta sola) e ti propongo ricette con quello che sta per scadere.</p>
      <button class="btn btn-primary btn-big btn-block" onclick={() => (sheets.aiKey = true)}><Icon name="key" /> Collega Gemini</button>
    </div>
  {:else}
    <section class="lime-card hero">
      <div class="hero-head">
        <span class="hero-icon" aria-hidden="true">
          <Icon name="chef" size={34} />
          <span class="spark"><Icon name="sparkles" size={18} /></span>
        </span>
        <div class="hero-text">
          <strong>Ricette con gli ingredienti in scadenza</strong>
          {#if !app.items.length}
            <span>Prima aggiungi qualche prodotto alla dispensa.</span>
          {:else if first.length}
            <span>
              Userò per primi:
              {#each first as it, i (it.id)}<b>{it.emoji} {it.name}</b> ({badgeText(daysLeft(it, app.today), it.expiryKind).toLowerCase()}){i < first.length - 1 ? ', ' : ''}{/each}
            </span>
          {:else}
            <span>Niente in scadenza: ricette con quello che hai.</span>
          {/if}
        </div>
      </div>
      <button class="go" disabled={recipes.loading || !app.items.length} onclick={() => void generateRecipes()}>
        <span class="go-icon"><Icon name="sparkles" size={22} /></span>
        <span class="go-text">{recipes.loading ? 'Preparo le ricette…' : 'Genera ricette'}</span>
        <span class="go-end"><Icon name="chevronRight" size={20} /></span>
      </button>
    </section>

    <div class="chips pills" role="group" aria-label="Filtri">
      {#each PILLS as p (p.id)}
        <button class="chip" aria-pressed={recipes.filters[p.id]} onclick={() => toggle(p.id)}>{p.label}</button>
      {/each}
    </div>
    <div class="row-extra">
      <div class="servings" aria-label="Persone">
        <button aria-label="Una persona in meno" onclick={() => servings(-1)}><Icon name="minus" size={18} /></button>
        <span class="num">👥 {recipes.filters.servings} {recipes.filters.servings === 1 ? 'persona' : 'persone'}</span>
        <button aria-label="Una persona in più" onclick={() => servings(1)}><Icon name="plus" size={18} /></button>
      </div>
    </div>
    <!-- "Altro?": tutta la larghezza, va a capo; Invio o la freccia = "Genera ricette" con la richiesta. -->
    <form class="extra-form" onsubmit={submitExtra}>
      <textarea
        class="input extra"
        rows="1"
        bind:this={extraInput}
        bind:value={recipes.filters.extra}
        oninput={fitExtra}
        onkeydown={onExtraKey}
        placeholder="Altro? Es. senza forno, per la cena, poco piccante…"
        maxlength="300"
        autocomplete="off"
        enterkeyhint="send"
      ></textarea>
      <button class="circle-btn lime send" type="submit" aria-label="Genera ricette con questa richiesta" disabled={recipes.loading}>
        <Icon name="chevronRight" size={22} stroke={2.6} />
      </button>
    </form>

    {#if recipes.loading}
      <div class="loading" bind:this={loadingEl} in:fade>
        <AiStatus progress={recipes.progress} message={recipeWaitingMessage(recipes.seconds)} />
        {#each [0, 1, 2] as k (k)}
          <div class="skeleton" style:animation-delay="{k * 150}ms"></div>
        {/each}
      </div>
    {:else if recipes.error}
      <div class="card error" role="alert">
        <p>{recipes.error}</p>
        {#if recipes.detail}<p class="detail">{recipes.detail}</p>{/if}
        <button class="btn btn-soft btn-small" onclick={() => void generateRecipes()}><Icon name="refresh" size={18} /> Riprova</button>
      </div>
    {/if}
  {/if}
{/if}

{#if recipes.view === 'salvate'}
  <button class="btn btn-soft btn-block newrec" onclick={() => (sheets.editRecipe = { mode: 'new' })}><Icon name="plus" /> Nuova ricetta tua</button>
{/if}

{#if !recipes.loading && list.length}
  <div bind:this={resultsEl} class="anchor"></div>
  {#if recipes.view === 'nuove'}
    <div class="ideas-head">
      <span>{recipes.list.length === 1 ? 'L’ultima idea' : `Le ultime ${recipes.list.length} idee`}</span>
      <button class="btn btn-ghost btn-small clear" onclick={() => void clearIdeas()}><Icon name="trash" size={18} /> Cancella</button>
    </div>
    {#if splitMessage || recipes.note}
      <div class="ai-note" in:fade>
        <span aria-hidden="true">💬</span>
        <div>
          {#if splitMessage}<p><strong>{splitMessage}</strong></p>{/if}
          {#if recipes.note}<p>{recipes.note}</p>{/if}
        </div>
      </div>
    {/if}
    {#each groups as g (g.id)}
      <h2 class="section-title group {g.id}">{g.title} <span class="num">{g.recipes.length}</span></h2>
      <div class="results">
        {#each g.recipes as r, i (r.id)}
          <div in:fly={{ y: 16, duration: 260, delay: i * 80 }}>
            <RecipeCard recipe={r} />
          </div>
        {/each}
      </div>
    {/each}
    {#if recipes.usedModel}
      <button class="used" onclick={() => (showDetail = !showDetail)} aria-expanded={showDetail}>
        <Icon name="sparkles" size={16} />
        <span>{usedModelText(recipes.usedModel, recipes.usedSeconds)}</span>
        {#if recipes.detail}<Icon name={showDetail ? 'chevronDown' : 'chevronRight'} size={16} />{/if}
      </button>
      {#if showDetail && recipes.detail}<p class="detail used-detail">{recipes.detail}</p>{/if}
    {/if}
  {:else}
    <div class="results">
      {#each list as r, i (r.id)}
        <div in:fly={{ y: 16, duration: 260, delay: i * 80 }}>
          <RecipeCard recipe={r} />
        </div>
      {/each}
    </div>
  {/if}
  {#if recipes.view === 'nuove' && hasAiKey()}
    <button class="btn btn-block more" onclick={() => void generateRecipes(true)}><Icon name="refresh" /> Altre idee</button>
  {/if}
{:else if recipes.view === 'salvate'}
  <p class="empty">Qui trovi le ricette salvate col ❤️ e quelle scritte da te.</p>
{/if}

<style>
  .newrec {
    margin-bottom: 14px;
  }
  .ideas-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 22px 2px 4px;
    color: var(--text-muted);
    font-size: 0.9375rem;
    font-weight: 600;
  }
  .clear {
    flex: none;
    color: var(--text-muted);
  }
  .views {
    flex: none;
  }
  .views button {
    padding: 0 14px;
  }
  .nokey {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 26px 20px;
  }
  .nokey h2 {
    margin: 0;
  }
  .nokey p {
    margin: 0 0 6px;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .big {
    font-size: 3.5rem;
    line-height: 1;
  }
  .hero {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .hero-head {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .hero-icon {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 20px;
    background: rgb(255 255 255 / 0.6);
    color: var(--ring-on-lime);
    display: grid;
    place-items: center;
    flex: none;
  }
  .spark {
    position: absolute;
    top: -6px;
    right: -6px;
    color: #e09a1a;
    animation: twinkle 1.8s ease-in-out infinite;
  }
  @keyframes twinkle {
    50% {
      transform: scale(1.25) rotate(12deg);
    }
  }
  .hero-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hero-text strong {
    font-size: 1.1875rem;
    line-height: 1.25;
  }
  .hero-text span {
    font-size: 0.9375rem;
    line-height: 1.45;
    opacity: 0.85;
  }
  @media (prefers-color-scheme: dark) {
    .hero-icon {
      background: var(--surface-2);
    }
  }
  .pills {
    margin-top: 14px;
    gap: 6px;
  }
  .pills .chip {
    min-height: 38px;
    padding: 0 12px;
    font-size: 0.875rem;
  }
  .anchor {
    scroll-margin-top: 8px;
  }
  .row-extra {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
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
  .extra-form {
    margin-top: 10px;
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  .extra {
    flex: 1;
    min-width: 0;
    line-height: 1.4;
    padding-top: 12px;
    padding-bottom: 12px;
    overflow-y: auto;
    min-height: 52px;
    border-radius: 24px;
    padding-left: 18px;
    padding-right: 18px;
  }
  .loading {
    margin-top: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .skeleton {
    height: 170px;
    border-radius: var(--radius);
    background: linear-gradient(90deg, var(--surface) 0%, var(--surface-2) 50%, var(--surface) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }
  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  .error {
    margin-top: 16px;
    border: 1px solid var(--red);
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .error p {
    margin: 0;
    line-height: 1.5;
  }
  .detail {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .send {
    width: 52px;
    height: 52px;
  }
  .ai-note {
    display: flex;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 20px;
    background: var(--amber-soft);
    color: var(--amber-text);
    line-height: 1.45;
    margin-bottom: 4px;
  }
  .ai-note p {
    margin: 0;
  }
  .ai-note p + p {
    margin-top: 4px;
  }
  .group.scadenza {
    color: var(--red-text);
  }
  .group.misto {
    color: var(--amber-text);
  }
  .used {
    margin-top: 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.875rem;
    padding: 6px 2px;
    cursor: pointer;
  }
  .used-detail {
    margin: 0 2px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .more {
    margin-top: 16px;
  }
</style>
