<script lang="ts">
  // Scheda "Pasti": la settimana con pranzo e cena di ogni giorno.
  import { fade } from 'svelte/transition';
  import { reportError } from '../lib/errors';
  import { addDays } from '../lib/logic/dates';
  import { badgeText, daysLeft } from '../lib/logic/expiry';
  import {
    dayTitle,
    daySubtitle,
    isPastSlot,
    mealsByDay,
    mealWarnings,
    shoppingForMeals,
    SLOTS,
    urgentNotPlanned,
    warningText,
    weekDays,
    weekRange,
    weekShareText,
    weekStart,
    weekStats,
    weekTitle,
    type Meal,
  } from '../lib/logic/meals';
  import { joinNames, plural } from '../lib/logic/text';
  import { tapFeedback } from '../lib/platform';
  import { shareText } from '../lib/services/share';
  import { app, hasAiKey, sheets } from '../lib/state/app.svelte';
  import { addMissingToShopping, plan, toggleMealDone } from '../lib/state/meals.svelte';
  import { recipes } from '../lib/state/recipes.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Ring from '../lib/ui/Ring.svelte';

  const thisWeek = $derived(weekStart(app.today));
  const days = $derived(weekDays(plan.week));
  const byDay = $derived(mealsByDay(app.meals, days));
  const stats = $derived(weekStats(app.meals, days, app.items, app.today));
  const toBuy = $derived(shoppingForMeals(app.meals, days, app.items, app.shopping, app.today));
  const urgent = $derived(plan.week <= thisWeek ? urgentNotPlanned(app.items, app.meals, app.today) : []);
  const isPastWeek = $derived(addDays(plan.week, 6) < app.today);
  const hour = $derived(new Date().getHours());
  // Nella settimana in corso i giorni già passati restano chiusi (si aprono col pulsante).
  let showPast = $state(false);
  const pastDays = $derived(plan.week === thisWeek ? days.filter((d) => d < app.today) : []);
  const shownDays = $derived(showPast ? days : days.filter((d) => !pastDays.includes(d)));

  function moveWeek(n: number) {
    void tapFeedback();
    plan.week = addDays(plan.week, 7 * n);
  }

  function openMeal(m: Meal) {
    sheets.meal = { mode: 'edit', id: m.id };
  }

  function newMeal(date: string, slot: Meal['slot']) {
    void tapFeedback();
    sheets.meal = { mode: 'new', date, slot };
  }

  function planWithAi() {
    if (!hasAiKey()) {
      sheets.aiKey = true;
      return;
    }
    sheets.planAi = true;
  }

  function findRecipes() {
    recipes.filters.onlyExpiring = true;
    recipes.view = 'nuove';
    app.tab = 'ricette';
  }

  async function share() {
    try {
      await shareText('Pasti della settimana', weekShareText(app.meals, days));
    } catch (e) {
      reportError(e);
    }
  }
</script>

<header class="page-top">
  <div class="grow">
    <p class="hello">Piano dei pasti</p>
    <h1>Cosa mangiamo?</h1>
  </div>
  <button class="circle-btn" aria-label="Condividi i pasti della settimana" disabled={!stats.planned} onclick={share}>
    <Icon name="share" size={22} />
  </button>
</header>

<section class="lime-card summary">
  <div class="top-row">
    <Ring value={stats.total ? stats.planned / stats.total : 0} size={116} stroke={11} color="var(--ring-on-lime)" track="var(--ring-track-on-lime)">
      <span class="big num">{stats.planned}</span>
      <span class="cap">{stats.planned === 1 ? 'pasto' : 'pasti'} in<br />programma</span>
    </Ring>
    <div class="stats">
      <div class="stat-line">
        <span>Pranzi e cene</span>
        <strong class="num">{stats.planned}/{stats.total}</strong>
      </div>
      <div class="stat-line">
        <span><i class="dot-c" style:background="var(--red)"></i>Prodotti salvati</span>
        <strong class="num">{stats.rescued}</strong>
      </div>
      <div class="stat-line">
        <span><i class="dot-c" style:background="var(--amber)"></i>Da comprare</span>
        <strong class="num">{toBuy.length}</strong>
      </div>
    </div>
  </div>
  {#if !isPastWeek}
    <button class="go" onclick={planWithAi}>
      <span class="go-icon"><Icon name="sparkles" size={22} /></span>
      <span class="go-text">Riempi con l’IA</span>
      <span class="go-end"><Icon name="chevronRight" size={20} /></span>
    </button>
  {/if}
</section>

<div class="weekbar">
  <button class="circle-btn small" aria-label="Settimana prima" onclick={() => moveWeek(-1)}><Icon name="chevronLeft" size={20} /></button>
  <div class="week">
    <strong>{weekTitle(plan.week, app.today)}</strong>
    <span>{weekRange(plan.week, app.today)}</span>
  </div>
  <button class="circle-btn small" aria-label="Settimana dopo" onclick={() => moveWeek(1)}><Icon name="chevronRight" size={20} /></button>
</div>
{#if plan.week !== thisWeek}
  <button class="today-link" onclick={() => (plan.week = thisWeek)} in:fade>Torna a questa settimana</button>
{/if}

{#if urgent.length}
  <div class="card hint red" in:fade>
    <p>
      <span aria-hidden="true">⏰</span>
      <strong>Da usare e non ancora nel piano:</strong>
      {urgent.map((i) => `${i.emoji} ${i.name} (${badgeText(daysLeft(i, app.today), i.expiryKind).toLowerCase()})`).join(', ')}
    </p>
    <button class="btn btn-soft btn-small" onclick={findRecipes}><Icon name="chef" size={20} /> Trova una ricetta</button>
  </div>
{/if}

{#if toBuy.length}
  <div class="card hint" in:fade>
    <p>
      <span aria-hidden="true">🛒</span>
      <strong>Per questi pasti {toBuy.length === 1 ? 'manca' : 'mancano'}:</strong>
      {joinNames(toBuy.map((t) => t.name), 5)}
    </p>
    <button class="btn btn-soft btn-small" onclick={() => void addMissingToShopping(toBuy)}><Icon name="cartPlus" size={20} /> Aggiungi alla spesa</button>
  </div>
{/if}

<div class="days">
  {#if pastDays.length}
    <button class="past-toggle" onclick={() => (showPast = !showPast)} aria-expanded={showPast}>
      <Icon name={showPast ? 'chevronDown' : 'chevronRight'} size={18} />
      {showPast ? 'Nascondi' : 'Mostra'} i giorni passati ({pastDays.length})
    </button>
  {/if}
  {#each shownDays as d (d)}
    {@const dm = byDay.get(d)}
    <section class="day card" class:today={d === app.today} class:past={d < app.today}>
      <h2>
        <span class="dname">{dayTitle(d, app.today)}</span>
        <span class="ddate">{daySubtitle(d, app.today)}</span>
      </h2>
      {#each SLOTS as s (s.id)}
        {@const list = dm ? dm[s.id] : []}
        <div class="slot">
          <span class="slot-label"><span aria-hidden="true">{s.emoji}</span> {s.label}</span>
          <div class="slot-meals">
            {#each list as m (m.id)}
              {@const warns = mealWarnings(m, app.items, app.today)}
              <div class="meal" class:done={m.done}>
                <button class="meal-main" onclick={() => openMeal(m)}>
                  <span class="m-emoji" aria-hidden="true">{m.emoji}</span>
                  <span class="m-text">
                    <span class="m-title">{m.title}</span>
                    {#if m.recipe}
                      <span class="m-sub">
                        <Icon name="clock" size={14} />
                        {m.recipe.minutes} min{m.recipe.uses.length ? ` · ${plural(m.recipe.uses.length, 'prodotto tuo', 'prodotti tuoi')}` : ''}
                      </span>
                    {/if}
                    {#if warns.length}
                      <span class="m-warn">⚠️ {warningText(warns[0]!, app.today)}{warns.length > 1 ? ` (e altri ${warns.length - 1})` : ''}</span>
                    {/if}
                  </span>
                </button>
                <button class="tick" class:on={m.done} aria-label={m.done ? `Da fare: ${m.title}` : `Fatto: ${m.title}`} onclick={() => void toggleMealDone(m)}>
                  {#if m.done}<Icon name="check" size={18} stroke={3} />{/if}
                </button>
              </div>
            {/each}
            {#if !list.length && !isPastSlot(d, s.id, app.today, hour)}
              <button class="add-meal" onclick={() => newMeal(d, s.id)}><Icon name="plus" size={18} /> Aggiungi</button>
            {:else if !list.length}
              <span class="nothing">—</span>
            {:else}
              <button class="add-more" aria-label="Aggiungi un altro piatto a {s.label.toLowerCase()}" onclick={() => newMeal(d, s.id)}><Icon name="plus" size={16} /> altro piatto</button>
            {/if}
          </div>
        </div>
      {/each}
    </section>
  {/each}
</div>

{#if recipes.list.length || recipes.saved.length}
  <p class="foot-hint">Dalle ricette dell’IA puoi toccare <Icon name="calendar" size={16} /> per metterle in un giorno.</p>
{/if}

<style>
  .summary {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 16px;
  }
  .top-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .big {
    font-size: 2rem;
    font-weight: 700;
    line-height: 1.05;
  }
  .cap {
    font-size: 0.8125rem;
    line-height: 1.2;
    opacity: 0.75;
    text-align: center;
  }
  .stats {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .weekbar {
    margin-top: 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .week {
    flex: 1;
    min-width: 0;
    text-align: center;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .week strong {
    font-size: 1.0625rem;
  }
  .week span {
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .today-link {
    display: block;
    margin: 6px auto 0;
    border: 0;
    background: transparent;
    color: var(--accent-text);
    font-weight: 600;
    font-size: 0.9375rem;
    padding: 6px 10px;
    cursor: pointer;
  }
  .hint {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 16px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .hint p {
    margin: 0;
  }
  .hint.red {
    background: var(--red-soft);
    color: var(--red-text);
    box-shadow: none;
  }
  .days {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .day {
    padding: 14px 14px 10px;
  }
  .day.today {
    box-shadow: 0 0 0 2px var(--accent), var(--shadow);
  }
  .day.past {
    opacity: 0.72;
  }
  .day h2 {
    margin: 0 2px 4px;
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 1.125rem;
  }
  .ddate {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-muted);
  }
  .today .dname {
    color: var(--accent-text);
  }
  .slot {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 0;
    border-top: 1px solid var(--border);
  }
  .slot-label {
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .slot-meals {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .past-toggle {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-weight: 600;
    font-size: 0.9375rem;
    padding: 4px 6px;
    cursor: pointer;
  }
  .meal {
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 16px;
    background: var(--surface-2);
    padding: 4px 6px 4px 4px;
  }
  .meal-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    border: 0;
    background: transparent;
    text-align: left;
    padding: 4px;
    color: inherit;
    cursor: pointer;
  }
  .m-emoji {
    font-size: 1.5rem;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--surface);
    display: grid;
    place-items: center;
    flex: none;
  }
  .m-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .m-title {
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .m-sub {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .m-warn {
    font-size: 0.8125rem;
    color: var(--red-text);
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .meal.done .m-title {
    text-decoration: line-through;
    color: var(--text-muted);
  }
  .tick {
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--border);
    background: var(--surface);
    display: grid;
    place-items: center;
    color: var(--accent-contrast);
    cursor: pointer;
    transition: background 150ms ease, transform 120ms ease;
  }
  .tick:active {
    transform: scale(0.85);
  }
  .tick.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .add-meal {
    min-height: 44px;
    border-radius: 16px;
    border: 2px dashed var(--border);
    background: transparent;
    color: var(--text-muted);
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
  }
  .add-meal:active {
    background: var(--surface-2);
  }
  .add-more {
    align-self: flex-start;
    border: 0;
    background: transparent;
    color: var(--accent-text);
    font-size: 0.875rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    cursor: pointer;
  }
  .nothing {
    color: var(--text-muted);
    padding-left: 4px;
  }
  .foot-hint {
    margin: 14px 4px 0;
    font-size: 0.875rem;
    color: var(--text-muted);
    text-align: center;
    line-height: 1.5;
  }
  .foot-hint :global(svg) {
    display: inline-block;
    vertical-align: -3px;
  }
</style>
