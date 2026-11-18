<script lang="ts">
  // Scegliere un prodotto della dispensa: casella di ricerca e lista (chi scade prima per primo).
  import { daysLeft } from '../logic/expiry';
  import { sortItems } from '../logic/pantry';
  import { normalize } from '../logic/text';
  import { app } from '../state/app.svelte';
  import type { Item } from '../types';
  import ExpiryBadge from './ExpiryBadge.svelte';
  import Icon from './Icon.svelte';

  let { exclude = [], onpick }: { exclude?: readonly string[]; onpick: (item: Item) => void } = $props();

  let query = $state('');
  const list = $derived.by(() => {
    const q = normalize(query.trim());
    return sortItems(app.items, 'scadenza')
      .filter((i) => !exclude.includes(i.id))
      .filter((i) => !q || normalize(`${i.name} ${i.brand ?? ''}`).includes(q))
      .slice(0, 40);
  });
</script>

<div class="picker">
  <label class="search">
    <Icon name="search" size={20} />
    <input bind:value={query} placeholder="Cerca in dispensa…" autocomplete="off" enterkeyhint="search" />
  </label>
  {#if list.length}
    <ul>
      {#each list as it (it.id)}
        <li>
          <button onclick={() => onpick(it)}>
            <span class="emoji" aria-hidden="true">{it.emoji}</span>
            <span class="name">{it.name}</span>
            <ExpiryBadge days={daysLeft(it, app.today)} kind={it.expiryKind} estimated={it.expiryEstimated} />
            <span class="plus"><Icon name="plus" size={18} /></span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">{query ? 'Nessun prodotto con questo nome.' : 'Non ci sono altri prodotti in dispensa.'}</p>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border-radius: 20px;
    background: var(--surface-2);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    min-height: 48px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font: inherit;
    color: var(--text);
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 300px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 0;
    border-radius: 14px;
    background: var(--surface);
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  li button:active {
    transform: scale(0.99);
  }
  .emoji {
    font-size: 1.4rem;
    flex: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .plus {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-contrast);
    display: grid;
    place-items: center;
    flex: none;
  }
  .empty {
    margin: 4px 6px;
    color: var(--text-muted);
    font-size: 0.9375rem;
  }
</style>
