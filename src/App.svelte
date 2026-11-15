<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { reportError } from './lib/errors';
  import { repeatInForeground } from './lib/foreground';
  import { onBackButton, onResume, tapFeedback } from './lib/platform';
  import { onNotificationTap } from './lib/services/notifications';
  import { app, closeAllSheets, initApp, scheduleNotifications, sheets, tickToday, type Tab } from './lib/state/app.svelte';
  import { announceNewVersion, installUpdate, refreshUpdate, resumeUpdate, update } from './lib/state/update.svelte';
  import { closeTopOverlay } from './lib/state/ui.svelte';
  import BusyOverlay from './lib/ui/BusyOverlay.svelte';
  import DialogHost from './lib/ui/DialogHost.svelte';
  import Icon, { type IconName } from './lib/ui/Icon.svelte';
  import Toast from './lib/ui/Toast.svelte';
  import { load, preloadAll } from './lazy';
  import Dispensa from './views/Dispensa.svelte';

  const TABS: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'dispensa', label: 'Dispensa', icon: 'jar' },
    { id: 'aggiungi', label: 'Aggiungi', icon: 'camera' },
    { id: 'ricette', label: 'Ricette IA', icon: 'chef' },
  ];

  let main = $state<HTMLElement | null>(null);

  function selectTab(tab: Tab) {
    if (app.tab === tab) {
      main?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    void tapFeedback();
    app.tab = tab;
    main?.scrollTo({ top: 0 });
  }

  onMount(() => {
    initApp()
      .then(async () => {
        preloadAll();
        // Notifica "scade oggi": si apre la scheda delle ricette (anche se l'app era chiusa: Android tiene il tocco).
        onNotificationTap(() => {
          if (!app.settings.onboarded) return;
          closeAllSheets();
          app.tab = 'ricette';
        });
        await announceNewVersion().catch(() => undefined);
        if (app.settings.onboarded) await refreshUpdate();
      })
      .catch((e: unknown) => reportError(e, 'Non riesco a leggere i dati dell’app.'));

    onBackButton(() => {
      if (closeTopOverlay()) return true;
      if (app.tab !== 'dispensa') {
        app.tab = 'dispensa';
        return true;
      }
      return false;
    });
    onResume(() => {
      tickToday();
      void resumeUpdate();
      if (app.settings.onboarded) {
        void refreshUpdate();
        scheduleNotifications();
      }
    });
    return repeatInForeground(tickToday, 30_000);
  });
</script>

{#if !app.ready}
  <div class="splash" aria-hidden="true"></div>
{:else if !app.settings.onboarded}
  {#await load.onboarding() then m}<m.default />{/await}
{:else}
  <div class="shell">
    <main bind:this={main} class:camera={app.tab === 'aggiungi'}>
      {#if update.available && (!update.dismissed || update.phase !== 'idle') && app.tab !== 'aggiungi'}
        <div class="update card" role="status">
          {#if update.phase === 'download'}
            <strong>Scarico la versione {update.available.version}… {update.percent}%</strong>
            <div class="progress"><div style:width="{update.percent}%"></div></div>
            <span>Puoi continuare a usare l’app intanto.</span>
          {:else if update.phase === 'install'}
            <strong>Quasi fatto</strong>
            <span>Tocca <b>Aggiorna</b> (o <b>Installa</b>) nella finestra di Android. Poi tocca <b>Apri</b>: i tuoi dati restano.</span>
            <div class="update-actions">
              <button class="btn btn-ghost btn-small" onclick={() => installUpdate()}>Riprova</button>
            </div>
          {:else if update.phase === 'permission'}
            <strong>Dai il permesso e torna qui</strong>
            <span>Attiva <b>Consenti da questa origine</b>, poi torna indietro: l’aggiornamento parte da solo.</span>
          {:else}
            <div>
              <strong>Nuova versione {update.available.version}</strong>
              <span>Si installa sopra quella attuale: i dati restano.</span>
              {#if update.available.notes.length}
                <ul>
                  {#each update.available.notes.slice(0, 3) as n (n)}<li>{n}</li>{/each}
                </ul>
              {/if}
            </div>
            <div class="update-actions">
              <button class="btn btn-ghost btn-small" onclick={() => (update.dismissed = true)}>Dopo</button>
              <button class="btn btn-primary btn-small" onclick={() => installUpdate()}>Aggiorna</button>
            </div>
          {/if}
        </div>
      {/if}
      {#key app.tab}
        <div class="page" in:fly={{ y: 10, duration: 200 }}>
          {#if app.tab === 'dispensa'}
            <Dispensa />
          {:else if app.tab === 'aggiungi'}
            {#await load.aggiungi() then m}<m.default />{/await}
          {:else}
            {#await load.ricette() then m}<m.default />{/await}
          {/if}
        </div>
      {/key}
    </main>

    <nav class="navbar" aria-label="Sezioni">
      {#each TABS as t (t.id)}
        {#if t.id === 'aggiungi'}
          <button class="tab center" class:active={app.tab === t.id} aria-current={app.tab === t.id ? 'page' : undefined} onclick={() => selectTab(t.id)}>
            <span class="fab"><Icon name={t.icon} size={28} /></span>
            <span class="label">{t.label}</span>
          </button>
        {:else}
          <button class="tab" class:active={app.tab === t.id} aria-current={app.tab === t.id ? 'page' : undefined} onclick={() => selectTab(t.id)}>
            <span class="pill"><Icon name={t.icon} /></span>
            <span class="label">{t.label}</span>
          </button>
        {/if}
      {/each}
    </nav>
  </div>

  <!-- I fogli si caricano la prima volta che servono (di solito sono già pronti, vedi lazy.ts). -->
  <!-- In ordine: quelli che si aprono sopra gli altri vengono dopo (la spesa apre "Metti in dispensa"). -->
  {#if sheets.shopping}{#await load.shopping() then m}<m.default />{/await}{/if}
  {#if sheets.settings}{#await load.settings() then m}<m.default />{/await}{/if}
  {#if sheets.stats}{#await load.stats() then m}<m.default />{/await}{/if}
  {#if sheets.recipe}{#await load.recipe() then m}<m.default recipe={sheets.recipe} />{/await}{/if}
  {#if sheets.product}{#await load.product() then m}<m.default request={sheets.product} />{/await}{/if}
  {#if sheets.multi}{#await load.multi() then m}<m.default request={sheets.multi} />{/await}{/if}
  {#if sheets.cooked}{#await load.cooked() then m}<m.default recipe={sheets.cooked} />{/await}{/if}
  {#if sheets.aiKey}{#await load.aiKey() then m}<m.default />{/await}{/if}
{/if}

<BusyOverlay />
<DialogHost />
<Toast />

<style>
  .splash {
    height: 100%;
    background: var(--bg);
  }
  .shell {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
    background: var(--bg);
  }
  main {
    flex: 1;
    overflow-y: auto;
    padding: 8px 16px 28px;
    -webkit-overflow-scrolling: touch;
  }
  main.camera {
    padding: 8px 12px 12px;
    display: flex;
    flex-direction: column;
  }
  main.camera .page {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .update {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 12px;
    border: 1px solid var(--primary);
  }
  .update span {
    display: block;
    font-size: 0.875rem;
    color: var(--text-muted);
    margin-top: 4px;
    line-height: 1.4;
  }
  .update-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .update ul {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: 0.875rem;
    color: var(--text-muted);
    line-height: 1.4;
  }
  .progress {
    height: 8px;
    border-radius: 4px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .progress div {
    height: 100%;
    background: var(--primary);
    transition: width 200ms ease;
  }
  .navbar {
    flex: none;
    display: flex;
    align-items: stretch;
    background: var(--surface);
    border-top: 1px solid var(--border);
    padding: 0 8px var(--safe-bottom);
    z-index: 20;
    box-shadow: 0 -4px 20px rgb(20 30 22 / 0.05);
  }
  .tab {
    flex: 1;
    height: var(--navbar-h);
    border: 0;
    background: transparent;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .pill {
    width: 60px;
    height: 32px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    transition: background 200ms ease, color 200ms ease;
  }
  .tab.active {
    color: var(--primary-text);
  }
  .tab.active .pill {
    background: var(--primary-soft);
  }
  .label {
    font-size: 0.8125rem;
    font-weight: 650;
  }
  .center {
    justify-content: flex-end;
    padding-bottom: 9px;
  }
  .fab {
    width: 62px;
    height: 62px;
    margin-top: -26px;
    border-radius: 50%;
    border: 5px solid var(--bg);
    background: var(--primary);
    color: var(--on-primary);
    display: grid;
    place-items: center;
    box-shadow: 0 6px 16px color-mix(in srgb, var(--primary) 40%, transparent);
    transition: transform 150ms ease;
  }
  .center:active .fab {
    transform: scale(0.94);
  }
  .center.active .fab {
    background: var(--primary-strong);
  }
</style>
