<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '../../lib/db';
  import { reportError } from '../../lib/errors';
  import { formatShort } from '../../lib/logic/dates';
  import { mostWasted, recentMonths } from '../../lib/logic/pantry';
  import { allHistory } from '../../lib/repo';
  import { app, sheets } from '../../lib/state/app.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';
  import type { HistoryEntry } from '../../lib/types';

  let history = $state<HistoryEntry[] | null>(null);

  onMount(() => {
    allHistory(db)
      .then((h) => (history = h))
      .catch((e: unknown) => reportError(e));
  });

  const months = $derived(history ? recentMonths(history, app.today, 6) : []);
  const thisMonth = $derived(months[0]);
  const max = $derived(Math.max(1, ...months.map((m) => m.consumed + m.wasted)));
  const wasted = $derived(history ? mostWasted(history) : []);
  const recent = $derived(history ? history.slice(0, 30) : []);

  function close() {
    sheets.stats = false;
  }

  function cheer(pct: number | null): string {
    if (pct === null) return 'Quando finisci o butti un prodotto, qui vedi come va.';
    if (pct >= 95) return 'Spreco quasi zero: complimenti! 🏆';
    if (pct >= 80) return 'Ottimo lavoro: sprechi pochissimo. 🌱';
    if (pct >= 60) return 'Bene! Le ricette con i prodotti in scadenza aiutano a salvarne ancora di più.';
    return 'Prova a guardare ogni giorno i prodotti in rosso: le ricette IA ti aiutano a usarli.';
  }
</script>

<Sheet title="Il tuo anti-spreco" onclose={close}>
  {#if !history}
    <p class="empty">Carico…</p>
  {:else}
    {#if thisMonth}
      <div class="hero card">
        <p class="month">{thisMonth.label}</p>
        <div class="nums">
          <div><strong class="num">{thisMonth.consumed}</strong><span>consumati</span></div>
          <div><strong class="num bad">{thisMonth.wasted}</strong><span>buttati</span></div>
          <div><strong class="num good">{thisMonth.savedPct === null ? '–' : `${thisMonth.savedPct}%`}</strong><span>salvati</span></div>
        </div>
        <p class="cheer">{cheer(thisMonth.savedPct)}</p>
      </div>
    {/if}

    <h3 class="section-title">Ultimi 6 mesi</h3>
    <div class="card bars" aria-label="Prodotti consumati e buttati per mese">
      {#each [...months].reverse() as m (m.month)}
        <div class="bar">
          <div class="stack-bar" style:height="{((m.consumed + m.wasted) / max) * 100}%">
            {#if m.wasted}<span class="w" style:flex={m.wasted}></span>{/if}
            {#if m.consumed}<span class="c" style:flex={m.consumed}></span>{/if}
          </div>
          <span class="lbl">{m.label.slice(0, 3)}</span>
        </div>
      {/each}
    </div>
    <p class="legend"><span class="c"></span> consumati <span class="w"></span> buttati</p>

    {#if wasted.length}
      <h3 class="section-title">Butti più spesso</h3>
      <div class="list">
        {#each wasted as w (w.name)}
          <div class="row static">
            <span class="emoji" aria-hidden="true">{w.emoji}</span>
            <span class="grow"><span class="title">{w.name}</span><span class="sub">Buttato {w.count} volte: prova a comprarne meno</span></span>
          </div>
        {/each}
      </div>
    {/if}

    {#if recent.length}
      <h3 class="section-title">Ultimi prodotti tolti</h3>
      <div class="list">
        {#each recent as h, i (h.id ?? i)}
          <div class="row static">
            <span class="emoji" aria-hidden="true">{h.emoji}</span>
            <span class="grow"><span class="title">{h.name}</span><span class="sub">{formatShort(h.date, app.today)}</span></span>
            <span class="out {h.outcome}">{h.outcome === 'consumato' ? '✓ Finito' : 'Buttato'}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</Sheet>

<style>
  .hero {
    text-align: center;
    background: linear-gradient(145deg, var(--primary-soft), var(--surface));
  }
  .month {
    margin: 0 0 10px;
    font-weight: 650;
    color: var(--text-muted);
    text-transform: capitalize;
  }
  .nums {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .nums div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nums strong {
    font-size: 2rem;
    line-height: 1.1;
  }
  .nums span {
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .bad {
    color: var(--red-text);
  }
  .good {
    color: var(--primary-text);
  }
  .cheer {
    margin: 12px 0 0;
    line-height: 1.5;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    height: 170px;
    padding-bottom: 12px;
  }
  .bar {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
  }
  .stack-bar {
    width: 100%;
    max-width: 34px;
    min-height: 4px;
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface-2);
  }
  .c {
    background: var(--primary);
  }
  .w {
    background: var(--coral);
  }
  .lbl {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: capitalize;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 4px 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .legend span {
    width: 12px;
    height: 12px;
    border-radius: 4px;
    display: inline-block;
  }
  .legend .w {
    margin-left: 10px;
  }
  .static {
    cursor: default;
  }
  .emoji {
    font-size: 1.4rem;
  }
  .out {
    flex: none;
    font-size: 0.8125rem;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 999px;
  }
  .out.consumato {
    background: var(--green-soft);
    color: var(--green-text);
  }
  .out.buttato {
    background: var(--red-soft);
    color: var(--red-text);
  }
</style>
