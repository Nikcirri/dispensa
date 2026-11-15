<script lang="ts">
  import { badgeText, urgencyOf } from '../logic/expiry';
  import type { ExpiryKind } from '../types';

  // Bollino a colori: rosso oggi/domani, arancione entro 5 giorni, verde più avanti.
  let { days, kind, estimated = false }: { days: number | null; kind: ExpiryKind; estimated?: boolean } = $props();
  const urgency = $derived(urgencyOf(days));
  // Un "preferibilmente entro" passato non è un allarme: colore ambra invece che rosso.
  const tone = $derived(urgency === 'scaduto' && kind === 'tmc' ? 'arancione' : urgency);
</script>

<span class="badge {tone}" class:expired={urgency === 'scaduto'}>
  {#if urgency === 'rosso' || urgency === 'scaduto'}<span class="pulse" aria-hidden="true"></span>{/if}
  {estimated && days !== null ? '≈ ' : ''}{badgeText(days, kind)}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 0.8125rem;
    font-weight: 700;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .rosso,
  .scaduto {
    background: var(--red-soft);
    color: var(--red-text);
  }
  .arancione {
    background: var(--amber-soft);
    color: var(--amber-text);
  }
  .verde {
    background: var(--green-soft);
    color: var(--green-text);
  }
  .nessuna {
    background: var(--grey-soft);
    color: var(--grey-text);
  }
  .expired.scaduto {
    background: var(--red);
    color: #fff;
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
</style>
