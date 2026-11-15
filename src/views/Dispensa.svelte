<script lang="ts" module>
  import type { LocationFilter, SortMode } from '../lib/logic/pantry';

  // Filtri della dispensa: restano quando si cambia scheda.
  const view = $state({ location: 'tutto' as LocationFilter, query: '', sort: 'scadenza' as SortMode });
</script>

<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import { countByLocation, filterItems, groupByUrgency, LOCATIONS, sortItems, summarize } from '../lib/logic/pantry';
  import { plural } from '../lib/logic/text';
  import { app, sheets } from '../lib/state/app.svelte';
  import Icon, { type IconName } from '../lib/ui/Icon.svelte';
  import ProductCard from './ProductCard.svelte';

  const LOCATION_ICONS: Record<LocationFilter, IconName> = { tutto: 'list', frigo: 'fridge', freezer: 'snowflake', dispensa: 'jar' };

  const counts = $derived(countByLocation(app.items));
  const summary = $derived(summarize(app.items, app.today));
  const filtered = $derived(sortItems(filterItems(app.items, view.location, view.query), view.sort));
  const sections = $derived(view.sort === 'scadenza' ? groupByUrgency(filtered, app.today) : [{ id: 'tutti', title: '', items: filtered }]);
  const toBuy = $derived(app.shopping.filter((s) => !s.done).length);
  const atRisk = $derived(summary.urgent + summary.expired);

  const subtitle = $derived.by(() => {
    if (!summary.total) return 'Vuota, per ora';
    const parts = [plural(summary.total, 'prodotto', 'prodotti')];
    if (summary.urgent) parts.push(`${summary.urgent} da usare subito`);
    else if (summary.soon) parts.push(`${summary.soon} entro 5 giorni`);
    return parts.join(' · ');
  });
</script>

<header class="top">
  <div class="titles">
    <h1>Dispensa</h1>
    <p>{subtitle}</p>
  </div>
  <button class="icon-btn filled" aria-label="Lista della spesa" onclick={() => (sheets.shopping = true)}>
    <Icon name="cart" />
    {#if toBuy}<span class="dot num">{toBuy > 99 ? '99+' : toBuy}</span>{/if}
  </button>
  <button class="icon-btn filled" aria-label="Impostazioni" onclick={() => (sheets.settings = true)}>
    <Icon name="gear" />
  </button>
</header>

{#if app.items.length}
  <label class="search">
    <Icon name="search" size={20} />
    <input type="search" placeholder="Cerca in dispensa…" bind:value={view.query} autocomplete="off" />
    {#if view.query}
      <button class="clear" aria-label="Cancella la ricerca" onclick={() => (view.query = '')}><Icon name="close" size={18} /></button>
    {/if}
  </label>

  <div class="chips scroll filters" role="group" aria-label="Dove">
    <button class="chip" aria-pressed={view.location === 'tutto'} onclick={() => (view.location = 'tutto')}>
      <Icon name={LOCATION_ICONS.tutto} size={18} /> Tutto <span class="count">{counts.tutto}</span>
    </button>
    {#each LOCATIONS as l (l.id)}
      <button class="chip" aria-pressed={view.location === l.id} onclick={() => (view.location = view.location === l.id ? 'tutto' : l.id)}>
        <Icon name={LOCATION_ICONS[l.id]} size={18} /> {l.label} <span class="count">{counts[l.id]}</span>
      </button>
    {/each}
  </div>

  {#if atRisk && !view.query}
    <button class="alert" onclick={() => (app.tab = 'ricette')} transition:fade={{ duration: 150 }}>
      <span class="alert-icon" aria-hidden="true">⏰</span>
      <span class="alert-text">
        <strong>
          {#if summary.urgent}
            {summary.urgent === 1 ? '1 prodotto scade' : `${summary.urgent} prodotti scadono`} oggi o domani
          {:else}
            {summary.expired === 1 ? '1 prodotto è oltre la data' : `${summary.expired} prodotti sono oltre la data`}
          {/if}
        </strong>
        <span>Tocca per una ricetta che {summary.urgent + summary.expired === 1 ? 'lo usa' : 'li usa'}</span>
      </span>
      <Icon name="chevronRight" />
    </button>
  {/if}

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

  <button class="stats-link" onclick={() => (sheets.stats = true)}>
    <span aria-hidden="true">🌱</span>
    <span class="grow">Il tuo anti-spreco</span>
    <Icon name="chevronRight" size={20} />
  </button>
{:else}
  <div class="welcome card">
    <div class="big" aria-hidden="true">🫙</div>
    <h2>La dispensa è vuota</h2>
    <p>Fotografa un prodotto o la sua etichetta: leggo nome e scadenza e lo metto in dispensa per te.</p>
    <button class="btn btn-primary btn-big btn-block" onclick={() => (app.tab = 'aggiungi')}>
      <Icon name="camera" /> Aggiungi il primo prodotto
    </button>
    <button class="btn btn-ghost btn-block" onclick={() => (sheets.shopping = true)}>
      <Icon name="cart" /> Apri la lista della spesa
    </button>
  </div>
{/if}

<style>
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 14px;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: 2rem;
  }
  .titles p {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 0.9375rem;
  }
  .search {
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
    border-color: var(--primary);
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
  .filters {
    margin-top: 12px;
  }
  .alert {
    width: 100%;
    margin-top: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 14px 14px 16px;
    border: 0;
    border-radius: var(--radius);
    background: linear-gradient(120deg, var(--red-soft), var(--amber-soft));
    color: var(--red-text);
    text-align: left;
    cursor: pointer;
  }
  .alert-icon {
    font-size: 1.75rem;
    line-height: 1;
  }
  .alert-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .alert-text span {
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .sortbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 12px 2px 0;
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
    font-weight: 650;
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
    min-height: 56px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    border: 1px dashed var(--border);
    border-radius: 18px;
    background: transparent;
    color: var(--text-muted);
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  .stats-link .grow {
    flex: 1;
  }
  .welcome {
    margin-top: 20px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 28px 20px;
  }
  .welcome h2 {
    margin: 0;
  }
  .welcome p {
    margin: 0 0 8px;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .big {
    font-size: 4rem;
    line-height: 1;
  }
</style>
