<script lang="ts" module>
  import type { LocationFilter, SortMode } from '../lib/logic/pantry';

  // Filtri della dispensa: restano quando si cambia scheda.
  const view = $state({ location: 'tutto' as LocationFilter, query: '', sort: 'scadenza' as SortMode });
</script>

<script lang="ts">
  import { flip } from 'svelte/animate';
  import { greeting } from '../lib/logic/dates';
  import { countByLocation, filterItems, groupByUrgency, LOCATIONS, sortItems, summarize } from '../lib/logic/pantry';
  import { plural } from '../lib/logic/text';
  import { app, sheets } from '../lib/state/app.svelte';
  import Icon, { type IconName } from '../lib/ui/Icon.svelte';
  import Ring from '../lib/ui/Ring.svelte';
  import ProductCard from './ProductCard.svelte';

  const TILES: { id: LocationFilter; label: string; icon: IconName }[] = [
    { id: 'tutto', label: 'Tutto', icon: 'list' },
    ...LOCATIONS.map((l) => ({ id: l.id as LocationFilter, label: l.label, icon: (l.id === 'frigo' ? 'fridge' : l.id === 'freezer' ? 'snowflake' : 'jar') as IconName })),
  ];

  const counts = $derived(countByLocation(app.items));
  const summary = $derived(summarize(app.items, app.today));
  const filtered = $derived(sortItems(filterItems(app.items, view.location, view.query), view.sort));
  const sections = $derived(view.sort === 'scadenza' ? groupByUrgency(filtered, app.today) : [{ id: 'tutti', title: '', items: filtered }]);
  const toBuy = $derived(app.shopping.filter((s) => !s.done).length);
  const urgentNow = $derived(summary.urgent + summary.expired);
  const fresh = $derived(summary.total - summary.urgent - summary.expired - summary.soon);
  const hour = $derived(new Date().getHours());
</script>

<header class="page-top">
  <div class="grow">
    <p class="hello">{greeting(hour)}</p>
    <h1>La tua dispensa</h1>
  </div>
  <button class="circle-btn" aria-label="Lista della spesa" onclick={() => (sheets.shopping = true)}>
    <Icon name="cart" size={22} />
    {#if toBuy}<span class="dot num">{toBuy > 99 ? '99+' : toBuy}</span>{/if}
  </button>
  <button class="circle-btn" aria-label="Impostazioni" onclick={() => (sheets.settings = true)}>
    <Icon name="gear" size={22} />
  </button>
</header>

{#if app.items.length}
  <!-- Riassunto: l'anello è la parte di dispensa fresca; al centro quanto va usato per primo. -->
  <section class="lime-card summary">
    <div class="top-row">
      <Ring value={summary.total ? fresh / summary.total : 0} size={128} stroke={12} color="var(--ring-on-lime)" track="var(--ring-track-on-lime)">
        {#if urgentNow}
          <span class="big num">{urgentNow}</span>
          <span class="cap">da usare<br />subito</span>
        {:else if summary.soon}
          <span class="big num">{summary.soon}</span>
          <span class="cap">entro<br />5 giorni</span>
        {:else}
          <span class="big ok"><Icon name="check" size={40} stroke={3} /></span>
          <span class="cap">tutto<br />fresco</span>
        {/if}
      </Ring>
      <div class="stats">
        <div class="stat-line">
          <span>In dispensa</span>
          <strong class="num">{summary.total}</strong>
        </div>
        <div class="stat-line">
          <span><i class="dot-c" style:background="var(--red)"></i>Oggi e domani</span>
          <strong class="num">{summary.urgent}</strong>
        </div>
        <div class="stat-line">
          <span><i class="dot-c" style:background="var(--amber)"></i>Entro 5 giorni</span>
          <strong class="num">{summary.soon}</strong>
        </div>
        {#if summary.expired}
          <div class="stat-line">
            <span><i class="dot-c" style:background="var(--ink)"></i>Oltre la data</span>
            <strong class="num">{summary.expired}</strong>
          </div>
        {/if}
      </div>
    </div>
    {#if urgentNow || summary.soon}
      <button class="go cook" onclick={() => (app.tab = 'ricette')}>
        <span class="go-icon"><Icon name="chef" size={22} /></span>
        <span class="go-text">Cosa cucino?</span>
        <span class="go-end"><Icon name="chevronRight" size={20} /></span>
      </button>
    {/if}
  </section>

  <label class="search">
    <Icon name="search" size={20} />
    <input type="search" placeholder="Cerca in dispensa…" bind:value={view.query} autocomplete="off" />
    {#if view.query}
      <button class="clear" aria-label="Cancella la ricerca" onclick={() => (view.query = '')}><Icon name="close" size={18} /></button>
    {/if}
  </label>

  <div class="tiles" role="group" aria-label="Dove">
    {#each TILES as t (t.id)}
      <button class="tile" aria-pressed={view.location === t.id} onclick={() => (view.location = view.location === t.id && t.id !== 'tutto' ? 'tutto' : t.id)}>
        <Icon name={t.icon} size={22} />
        <strong class="num">{counts[t.id]}</strong>
        <span>{t.label}</span>
      </button>
    {/each}
  </div>

  <div class="sortbar">
    <span class="found">{view.query || view.location !== 'tutto' ? plural(filtered.length, 'risultato', 'risultati') : ''}</span>
    <label class="sort">
      <span>Ordina</span>
      <select bind:value={view.sort} aria-label="Ordina per">
        <option value="scadenza">per scadenza</option>
        <option value="nome">per nome</option>
        <option value="recenti">ultimi aggiunti</option>
      </select>
      <Icon name="chevronDown" size={16} />
    </label>
  </div>

  {#if filtered.length}
    {#each sections as s (s.id)}
      {#if s.title}<h2 class="section-title {s.id}">{s.title} <span class="num">{s.items.length}</span></h2>{/if}
      <div class="cards">
        {#each s.items as it (it.id)}
          <div animate:flip={{ duration: 220 }}>
            <ProductCard item={it} today={app.today} showLocation={view.location === 'tutto'} />
          </div>
        {/each}
      </div>
    {/each}
  {:else}
    <div class="empty">
      Nessun prodotto {view.query ? `con “${view.query}”` : 'qui'}.
      <div class="empty-actions">
        <button class="btn btn-soft btn-small" onclick={() => ((view.query = ''), (view.location = 'tutto'))}>Mostra tutto</button>
      </div>
    </div>
  {/if}

  <button class="card stats-link" onclick={() => (sheets.stats = true)}>
    <span class="icon-tile"><Icon name="leaf" /></span>
    <span class="grow">
      <strong>Il tuo anti-spreco</strong>
      <span>Quanto consumi e quanto butti, mese per mese</span>
    </span>
    <Icon name="chevronRight" size={20} />
  </button>
{:else}
  <section class="lime-card welcome">
    <div class="big-emoji" aria-hidden="true">🫙</div>
    <h2>La dispensa è vuota</h2>
    <p>Fotografa un prodotto o la sua etichetta: leggo nome e scadenza e lo metto in dispensa per te.</p>
  </section>
  <div class="welcome-actions">
    <button class="go" onclick={() => (app.tab = 'aggiungi')}>
      <span class="go-icon"><Icon name="camera" size={22} /></span>
      <span class="go-text">Aggiungi il primo prodotto</span>
      <span class="go-end"><Icon name="chevronRight" size={20} /></span>
    </button>
    <button class="btn btn-ghost btn-block" onclick={() => (sheets.shopping = true)}>
      <Icon name="cart" /> Apri la lista della spesa
    </button>
  </div>
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
    font-size: 2.125rem;
    font-weight: 700;
    line-height: 1.05;
  }
  .big.ok {
    color: var(--ring-on-lime);
    display: grid;
  }
  .cap {
    font-size: 0.8125rem;
    line-height: 1.2;
    opacity: 0.75;
  }
  .stats {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .stat-line span {
    white-space: nowrap;
  }
  .cook {
    min-height: 54px;
    font-size: 1rem;
  }
  .cook .go-icon,
  .cook .go-end {
    width: 42px;
    height: 42px;
  }
  .search {
    margin-top: 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 8px 0 16px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    outline: none;
    height: 48px;
  }
  .search input::-webkit-search-cancel-button {
    display: none;
  }
  .clear {
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--text-muted);
  }
  .tiles {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .tile {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 2px 9px;
    border: 0;
    border-radius: 20px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text-muted);
    cursor: pointer;
    transition: background 150ms ease, color 150ms ease, transform 120ms ease;
  }
  .tile:active {
    transform: scale(0.96);
  }
  .tile strong {
    font-size: 1.25rem;
    line-height: 1.1;
    color: var(--text);
  }
  .tile span {
    font-size: 0.8125rem;
    font-weight: 600;
    max-width: 100%;
    overflow-wrap: anywhere;
    text-align: center;
  }
  .tile[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .tile[aria-pressed='true'] strong {
    color: var(--accent-contrast);
  }
  .sortbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 10px 2px 0;
    min-height: 40px;
  }
  .found {
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .sort {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .sort select {
    appearance: none;
    border: 0;
    background: transparent;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
    padding: 8px 18px 8px 2px;
    margin-right: -18px;
    cursor: pointer;
  }
  .sort :global(svg) {
    pointer-events: none;
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
  }
  .section-title span {
    font-weight: 600;
    letter-spacing: 0;
  }
  .section-title.rosso,
  .section-title.scaduto {
    color: var(--red-text);
  }
  .section-title.arancione {
    color: var(--amber-text);
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .empty-actions {
    margin-top: 12px;
  }
  .stats-link {
    width: 100%;
    margin-top: 22px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    border: 0;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .stats-link .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stats-link .grow span {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .welcome {
    margin-top: 6px;
    text-align: center;
    padding: 28px 22px;
  }
  .welcome h2 {
    margin: 8px 0 6px;
    font-size: 1.375rem;
  }
  .welcome p {
    margin: 0;
    line-height: 1.5;
    opacity: 0.8;
  }
  .big-emoji {
    font-size: 3.75rem;
    line-height: 1;
  }
  .welcome-actions {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
