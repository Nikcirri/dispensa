<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { reportError } from './lib/errors';
  import { repeatInForeground } from './lib/foreground';
  import { onBackButton, onResume, tapFeedback } from './lib/platform';
  import { onNotificationTap } from './lib/services/notifications';
  import { onWidgetAction, onWidgetShoppingChanged } from './lib/services/widgets';
  import { app, applyWidgetShopping, closeAllSheets, initApp, refreshAll, scheduleNotifications, sheets, tickToday, type Tab } from './lib/state/app.svelte';
  import { showToast } from './lib/state/ui.svelte';
  import { initHouse, resumeHouse } from './lib/state/house.svelte';
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
    { id: 'ricette', label: 'Ricette', icon: 'chef' },
    { id: 'aggiungi', label: 'Aggiungi', icon: 'camera' },
    { id: 'pasti', label: 'Pasti', icon: 'calendar' },
    { id: 'spesa', label: 'Spesa', icon: 'cart' },
  ];

  const toBuy = $derived(app.shopping.filter((s) => !s.done).length);

  let main = $state<HTMLElement | null>(null);

  // ---------- Trascina in giù per aggiornare (come in Nutrizione; non nella fotocamera) ----------
  const PULL_TRIGGER = 64;
  let pull = $state(0);
  let refreshing = $state(false);
  let pullStart: number | null = null;
  const canPull = $derived(app.ready && app.settings.onboarded && app.tab !== 'aggiungi');

  function onTouchStart(e: TouchEvent) {
    pullStart = canPull && !refreshing && main && main.scrollTop <= 0 ? (e.touches[0]?.clientY ?? null) : null;
  }

  function onTouchMove(e: TouchEvent) {
    if (pullStart === null || !main) return;
    const dy = (e.touches[0]?.clientY ?? pullStart) - pullStart;
    pull = dy > 0 && main.scrollTop <= 0 ? Math.min(110, dy * 0.5) : 0;
  }

  async function onTouchEnd() {
    if (pullStart === null) return;
    pullStart = null;
    if (pull < PULL_TRIGGER) {
      pull = 0;
      return;
    }
    refreshing = true;
    pull = 56;
    void tapFeedback();
    try {
      resumeHouse();
      await Promise.all([refreshAll(), refreshUpdate().catch(() => undefined)]);
      showToast('Aggiornato ✓');
    } catch (e) {
      reportError(e);
    } finally {
      refreshing = false;
      pull = 0;
    }
  }

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
        // Casa condivisa: si ricollega in sottofondo (Firebase si carica solo se il telefono è in una casa).
        void initHouse().catch((e: unknown) => console.warn('Casa condivisa non collegata', e));
        // Notifica "scade oggi": si apre la scheda delle ricette (anche se l'app era chiusa: Android tiene il tocco).
        onNotificationTap(() => {
          if (!app.settings.onboarded) return;
          closeAllSheets();
          app.tab = 'ricette';
        });
        // Toccando un widget della schermata Home si apre la scheda giusta.
        onWidgetAction((action) => {
          if (!app.settings.onboarded) return;
          closeAllSheets();
          app.tab = action === 'scrivi-spesa' ? 'spesa' : action;
          main?.scrollTo({ top: 0 });
          if (action === 'scrivi-spesa') app.focusShopping = true;
        });
        // Spunte fatte nel widget della spesa: si salvano all'apertura e subito se l'app è aperta in sottofondo.
        void applyWidgetShopping();
        onWidgetShoppingChanged(() => void applyWidgetShopping());
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
        resumeHouse();
        void applyWidgetShopping();
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
    {#if pull > 0}
      <div class="ptr" style:transform="translate(-50%, {pull - 44}px)" style:opacity={Math.min(1, pull / PULL_TRIGGER)} aria-hidden="true">
        <span class:spin={refreshing} style:transform={refreshing ? undefined : `rotate(${pull * 4}deg)`}><Icon name="refresh" size={20} /></span>
      </div>
    {/if}
    <main
      bind:this={main}
      class:camera={app.tab === 'aggiungi'}
      ontouchstart={onTouchStart}
      ontouchmove={onTouchMove}
      ontouchend={onTouchEnd}
      ontouchcancel={onTouchEnd}
    >
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
          {:else if app.tab === 'pasti'}
            {#await load.pasti() then m}<m.default />{/await}
          {:else if app.tab === 'spesa'}
            {#await load.spesa() then m}<m.default />{/await}
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
            <span class="fab"><Icon name={t.icon} size={26} stroke={2.2} /></span>
            <span class="label">{t.label}</span>
          </button>
        {:else}
          <button class="tab" class:active={app.tab === t.id} aria-current={app.tab === t.id ? 'page' : undefined} onclick={() => selectTab(t.id)}>
            <span class="ico">
              <Icon name={t.icon} size={26} />
              {#if t.id === 'spesa' && toBuy}<span class="badge num" aria-label="{toBuy} da comprare">{toBuy > 99 ? '99+' : toBuy}</span>{/if}
            </span>
            <span class="label">{t.label}</span>
          </button>
        {/if}
      {/each}
    </nav>
  </div>

  <!-- I fogli si caricano la prima volta che servono (di solito sono già pronti, vedi lazy.ts). -->
  <!-- In ordine: quelli che si aprono sopra gli altri vengono dopo (un pasto apre la ricetta, la ricetta apre "Quando la cucini?"). -->
  {#if sheets.settings}{#await load.settings() then m}<m.default />{/await}{/if}
  {#if sheets.stats}{#await load.stats() then m}<m.default />{/await}{/if}
  {#if sheets.house}{#await load.house() then m}<m.default />{/await}{/if}
  {#if sheets.planAi}{#await load.planAi() then m}<m.default />{/await}{/if}
  {#if sheets.meal}{#await load.meal() then m}<m.default request={sheets.meal} />{/await}{/if}
  {#if sheets.recipe}{#await load.recipe() then m}<m.default recipe={sheets.recipe} />{/await}{/if}
  {#if sheets.plan}{#await load.plan() then m}<m.default request={sheets.plan} />{/await}{/if}
  {#if sheets.editRecipe}{#await load.editRecipe() then m}<m.default request={sheets.editRecipe} />{/await}{/if}
  {#if sheets.product}{#await load.product() then m}<m.default request={sheets.product} />{/await}{/if}
  {#if sheets.shoppingItem}{#await load.shoppingItem() then m}<m.default id={sheets.shoppingItem} />{/await}{/if}
  {#if sheets.multi}{#await load.multi() then m}<m.default request={sheets.multi} />{/await}{/if}
  {#if sheets.cooked}{#await load.cooked() then m}<m.default request={sheets.cooked} />{/await}{/if}
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
  .ptr {
    position: fixed;
    left: 50%;
    top: calc(var(--safe-top) + 8px);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.15);
    color: var(--accent-text);
    display: grid;
    place-items: center;
    z-index: 30;
    pointer-events: none;
  }
  .ptr span {
    display: grid;
  }
  .spin {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
    border: 1px solid var(--accent);
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
    background: var(--accent);
    transition: width 200ms ease;
  }
  .navbar {
    flex: none;
    display: flex;
    align-items: center;
    background: var(--surface);
    border-top: 1px solid var(--border);
    padding: 0 6px var(--safe-bottom);
    z-index: 20;
    box-shadow: 0 -4px 20px rgb(20 30 20 / 0.04);
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
  .tab.active {
    color: var(--accent-text);
  }
  .label {
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .ico {
    position: relative;
    display: grid;
  }
  .badge {
    position: absolute;
    top: -6px;
    right: -12px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--red);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    display: grid;
    place-items: center;
    border: 2px solid var(--surface);
  }
  .center {
    justify-content: flex-end;
    padding-bottom: 8px;
  }
  /* Pulsante tondo lime in mezzo (come il + di Nutrizione): apre la fotocamera. */
  .fab {
    width: 60px;
    height: 60px;
    margin-top: -24px;
    border-radius: 50%;
    border: 5px solid var(--bg);
    background: var(--accent);
    color: var(--accent-contrast);
    display: grid;
    place-items: center;
    box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 45%, transparent);
    transition: transform 150ms ease;
  }
  .center:active .fab {
    transform: scale(0.96);
  }
  .center.active .label {
    color: var(--accent-text);
  }
</style>
