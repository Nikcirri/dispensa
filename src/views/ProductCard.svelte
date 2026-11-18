<script lang="ts">
  import { formatShort } from '../lib/logic/dates';
  import { whenText, type Meal } from '../lib/logic/meals';
  import { daysLeft, effectiveExpiry, limitedByOpening, openedText, urgencyOf } from '../lib/logic/expiry';
  import { locationLabel } from '../lib/logic/pantry';
  import { addToShopping, changeItem, finishItem, sheets } from '../lib/state/app.svelte';
  import { draftFromItem } from '../lib/logic/drafts';
  import ExpiryBadge from '../lib/ui/ExpiryBadge.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import ItemThumb from '../lib/ui/ItemThumb.svelte';
  import QtyStepper from '../lib/ui/QtyStepper.svelte';
  import type { Item } from '../lib/types';

  let { item, today, showLocation = false, plannedFor }: { item: Item; today: string; showLocation?: boolean; plannedFor?: Meal } = $props();

  const days = $derived(daysLeft(item, today));
  const urgency = $derived(urgencyOf(days));
  const date = $derived(effectiveExpiry(item));
  const meta = $derived(
    [
      item.brand,
      item.size,
      showLocation ? locationLabel(item.location) : '',
      item.openedAt ? openedText(item.openedAt, today) : '',
      date && (days === null || days > 1) ? `${limitedByOpening(item) ? 'Entro il' : 'Scad.'} ${formatShort(date, today)}` : '',
    ].filter(Boolean),
  );
  let done = $state(false);

  function edit() {
    sheets.product = { mode: 'edit', draft: draftFromItem(item), itemId: item.id };
  }

  async function finish() {
    done = true;
    await new Promise((r) => setTimeout(r, 260));
    await finishItem(item, 'consumato');
  }
</script>

<article class="item {urgency}" class:done class:tmc={item.expiryKind === 'tmc'}>
  <button class="main" onclick={edit} aria-label="Modifica {item.name}">
    <ItemThumb emoji={item.emoji} thumb={item.thumb} imageUrl={item.imageUrl} size={56} tone={urgency} />
    <span class="text">
      <span class="name">{item.name}</span>
      {#if meta.length}<span class="meta">{meta.join(' · ')}</span>{/if}
      {#if plannedFor}<span class="planned">🗓️ Per {whenText(plannedFor.date, plannedFor.slot, today)}</span>{/if}
    </span>
    <span class="badge-wrap"><ExpiryBadge {days} kind={item.expiryKind} estimated={item.expiryEstimated} /></span>
  </button>
  <div class="actions">
    <QtyStepper
      compact
      quantity={item.quantity}
      unit={item.unit}
      onchange={(q) => void changeItem(item.id, { quantity: q })}
      onempty={() => void finish()}
    />
    <span class="grow"></span>
    <button class="circle-btn small" aria-label="Metti {item.name} in cima alla spesa" onclick={() => void addToShopping(item.name)}>
      <Icon name="cartPlus" size={21} />
    </button>
    <button class="act done-btn" aria-label="{item.name} finito" onclick={finish}>
      <span class="check"><Icon name="check" size={20} stroke={2.6} /></span>
      <span>Finito</span>
    </button>
  </div>
</article>

<style>
  .item {
    position: relative;
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 14px 14px 12px;
    overflow: hidden;
    transition: transform 240ms ease, opacity 240ms ease;
  }
  /* Bordo colorato solo per chi scade oggi o domani (o è già oltre): si nota anche senza leggere. */
  .item.rosso,
  .item.scaduto {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--red) 55%, transparent), var(--shadow);
  }
  .item.scaduto.tmc {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--amber) 60%, transparent), var(--shadow);
  }
  .item.done {
    transform: translateX(40px) scale(0.97);
    opacity: 0;
  }
  .main {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
    cursor: pointer;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-top: 3px;
  }
  .name {
    font-size: 1.0625rem;
    font-weight: 650;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .planned {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--accent-text);
    overflow-wrap: anywhere;
  }
  .meta {
    font-size: 0.875rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .badge-wrap {
    flex: none;
    padding-top: 2px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
  }
  .act {
    height: 44px;
    border: 0;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    transition: transform 120ms ease;
  }
  .act:active {
    transform: scale(0.94);
  }
  .done-btn {
    padding: 0 14px 0 5px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 650;
    font-size: 0.9375rem;
  }
  .check {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-contrast);
    display: grid;
    place-items: center;
  }
  .done .check {
    animation: tick 260ms ease-out;
  }
  @keyframes tick {
    50% {
      transform: scale(1.3);
    }
  }
</style>
