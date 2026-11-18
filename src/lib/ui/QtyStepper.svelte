<script lang="ts">
  import { formatQuantity, quantityStep, roundQuantity } from '../logic/foods';
  import { tapFeedback } from '../platform';
  import type { Unit } from '../types';
  import Icon from './Icon.svelte';

  // Quantità modificabile al volo con − e +. Con "−" sull'ultima unità chiama `onempty` (prodotto finito).
  let {
    quantity,
    unit,
    onchange,
    onempty,
    compact = false,
  }: { quantity: number; unit: Unit; onchange: (q: number) => void; onempty?: () => void; compact?: boolean } = $props();

  let bump = $state(0);

  function change(dir: 1 | -1) {
    const step = quantityStep(unit, quantity);
    const next = roundQuantity(quantity + dir * step);
    void tapFeedback();
    if (next <= 0) {
      if (onempty) onempty();
      return;
    }
    bump++;
    onchange(next);
  }
</script>

<div class="stepper" class:compact>
  <button class="step" aria-label="Meno" onclick={() => change(-1)}><Icon name="minus" size={compact ? 18 : 20} /></button>
  {#key bump}<span class="value num">{formatQuantity(quantity, unit)}</span>{/key}
  <button class="step plus" aria-label="Più" onclick={() => change(1)}><Icon name="plus" size={compact ? 18 : 20} /></button>
</div>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface-2);
  }
  .step {
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: var(--surface);
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--text);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.06);
    transition: transform 100ms ease;
  }
  .step:active {
    transform: scale(0.9);
  }
  .step.plus {
    background: var(--accent);
    color: var(--accent-contrast);
    box-shadow: none;
  }
  .compact .step {
    width: 36px;
    height: 36px;
  }
  .compact .value {
    min-width: 48px;
    padding: 0 2px;
  }
  .value {
    min-width: 58px;
    text-align: center;
    font-weight: 650;
    font-size: 0.9375rem;
    padding: 0 4px;
    animation: pop 220ms ease-out;
  }
  @keyframes pop {
    40% {
      transform: scale(1.15);
    }
  }
</style>
