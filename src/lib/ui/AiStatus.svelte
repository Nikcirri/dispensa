<script lang="ts">
  // Cosa sta facendo l'IA: una frase e, sotto, i modelli di Gemini al lavoro con i secondi.
  import { liveStatusText, modelLabel, progressHeadline, type AiProgress } from '../logic/gemini';

  let { progress, message = '', dark = false }: { progress: AiProgress | null; message?: string; dark?: boolean } = $props();
</script>

<div class="ai-status" class:dark role="status" aria-live="polite">
  <p class="head">
    <span class="spinner" aria-hidden="true"></span>
    <span class="grow">{message || progressHeadline(progress)}</span>
    <span class="secs num">{progress?.seconds ?? 0} s</span>
  </p>
  {#if message}<p class="sub">{progressHeadline(progress)}</p>{/if}
  {#if progress?.attempts.length}
    <ul>
      {#each progress.attempts as a, i (i)}
        <li class={a.status}>
          <span class="dot" aria-hidden="true"></span>
          <span class="model">Gemini {modelLabel(a.model)}</span>
          <span class="state">{liveStatusText(a.status)}{a.note ? ` (${a.note})` : ''}</span>
          <span class="num">{a.seconds} s</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ai-status {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 16px;
    border-radius: 20px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
  }
  .dark {
    background: rgb(0 0 0 / 0.62);
    box-shadow: none;
    color: #fff;
  }
  p {
    margin: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    line-height: 1.35;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .secs {
    flex: none;
    font-size: 0.875rem;
    opacity: 0.7;
  }
  .sub {
    font-size: 0.875rem;
    opacity: 0.75;
    padding-left: 32px;
  }
  .spinner {
    width: 22px;
    height: 22px;
    flex: none;
    border-radius: 50%;
    border: 3px solid var(--accent-soft);
    border-top-color: var(--accent);
    animation: spin 0.9s linear infinite;
  }
  .dark .spinner {
    border-color: rgb(255 255 255 / 0.3);
    border-top-color: #fff;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  ul {
    list-style: none;
    margin: 4px 0 0;
    padding: 0 0 0 32px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.875rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .model {
    font-weight: 600;
  }
  .state {
    flex: 1;
    min-width: 0;
    opacity: 0.8;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--amber);
    flex: none;
  }
  .running .dot {
    background: var(--accent);
    animation: blink 1s ease-in-out infinite;
  }
  .ok .dot {
    background: var(--accent);
  }
  .slower .dot {
    background: var(--text-muted);
  }
  @keyframes blink {
    50% {
      opacity: 0.3;
    }
  }
</style>
