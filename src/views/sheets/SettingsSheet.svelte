<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '../../lib/db';
  import { reportError } from '../../lib/errors';
  import { modelLabel } from '../../lib/logic/gemini';
  import { RELEASES_PAGE } from '../../lib/logic/updates';
  import { APP_VERSION, isNative, openExternal } from '../../lib/platform';
  import { setAiKey } from '../../lib/repo';
  import { modelsFor, type ModelInfo } from '../../lib/services/gemini';
  import { askNotificationPermission, notificationsAllowed } from '../../lib/services/notifications';
  import { readBackupFile, restoreBackup, shareBackup } from '../../lib/services/share';
  import { app, initApp, scheduleNotifications, sheets, updateSettings } from '../../lib/state/app.svelte';
  import { recipes } from '../../lib/state/recipes.svelte';
  import { checkUpdateNow, installUpdate } from '../../lib/state/update.svelte';
  import { confirmDialog, showToast, withBusy } from '../../lib/state/ui.svelte';
  import AiKeyForm from '../../lib/ui/AiKeyForm.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';
  import { pickFile } from '../../lib/ui/pickFile';

  let models = $state<ModelInfo | null>(null);
  let changingKey = $state(false);
  let notifBlocked = $state(false);
  let checking = $state(false);
  let staple = $state('');

  const time = $derived(`${String(app.settings.notify.hour).padStart(2, '0')}:${String(app.settings.notify.minute).padStart(2, '0')}`);

  onMount(() => {
    void refreshModels();
    void refreshNotif();
  });

  async function refreshModels() {
    if (!app.aiKey) return;
    models = await modelsFor(app.aiKey).catch(() => null);
  }

  async function refreshNotif() {
    if (!isNative() || !app.settings.notify.enabled) return;
    notifBlocked = !(await notificationsAllowed().catch(() => true));
  }

  function close() {
    sheets.settings = false;
  }

  async function disconnect() {
    const ok = await confirmDialog({
      title: 'Scollegare Gemini?',
      message: 'Senza la chiave non posso leggere le foto né proporre ricette. Codice a barre e inserimento a mano continuano a funzionare.',
      confirmLabel: 'Scollega',
      danger: true,
    });
    if (!ok) return;
    await setAiKey(db, '');
    app.aiKey = '';
    models = null;
    showToast('Gemini scollegato');
  }

  async function toggleNotify(on: boolean) {
    if (on && isNative()) {
      const allowed = await askNotificationPermission().catch(() => false);
      notifBlocked = !allowed;
    }
    await updateSettings((s) => {
      s.notify.enabled = on;
    });
    scheduleNotifications();
  }

  async function setTime(v: string) {
    const m = /^(\d{1,2}):(\d{2})/.exec(v);
    if (!m) return;
    await updateSettings((s) => {
      s.notify.hour = Math.min(23, Number(m[1]));
      s.notify.minute = Math.min(59, Number(m[2]));
    });
    scheduleNotifications();
  }

  async function setGluten(on: boolean) {
    await updateSettings((s) => {
      s.recipes.glutenFree = on;
    });
  }

  async function addStaple() {
    const v = staple.trim().toLowerCase();
    if (!v || app.settings.recipes.staples.includes(v)) {
      staple = '';
      return;
    }
    await updateSettings((s) => {
      s.recipes.staples = [...s.recipes.staples, v].slice(0, 30);
    });
    staple = '';
  }

  async function removeStaple(v: string) {
    await updateSettings((s) => {
      s.recipes.staples = s.recipes.staples.filter((x) => x !== v);
    });
  }

  async function backup() {
    try {
      await shareBackup();
    } catch (e) {
      reportError(e, 'Non riesco a creare il backup.');
    }
  }

  async function restore() {
    try {
      const file = await pickFile('application/json,.json');
      if (!file) return;
      const data = await readBackupFile(file);
      const ok = await confirmDialog({
        title: 'Ripristinare il backup?',
        message: `Contiene ${data.items.length} prodotti e ${data.shopping.length} voci della spesa. I dati attuali saranno sostituiti.`,
        confirmLabel: 'Ripristina',
        danger: true,
      });
      if (!ok) return;
      await withBusy('Ripristino i dati…', () => restoreBackup(data));
      recipes.loaded = false;
      await initApp();
      showToast('Backup ripristinato');
    } catch (e) {
      reportError(e);
    }
  }

  async function checkUpdates() {
    checking = true;
    try {
      const r = await checkUpdateNow();
      if (r.kind === 'available') {
        const ok = await confirmDialog({
          title: `Nuova versione ${r.release.version}`,
          message: r.release.notes.length ? r.release.notes.map((n) => `• ${n}`).join('\n') : 'È disponibile un aggiornamento.',
          confirmLabel: 'Aggiorna',
        });
        if (ok) await installUpdate();
      } else if (r.kind === 'current') {
        showToast('Hai già l’ultima versione.');
      } else if (r.kind === 'offline') {
        showToast('Sei offline: collegati a internet e riprova.');
      } else {
        showToast('Non riesco a controllare gli aggiornamenti adesso.');
      }
    } finally {
      checking = false;
    }
  }
</script>

<Sheet title="Impostazioni" onclose={close}>
  <h3 class="section-title first">Intelligenza artificiale</h3>
  <div class="card">
    {#if app.aiKey && !changingKey}
      <p class="ok"><Icon name="sparkles" size={20} /> Gemini è collegato</p>
      <p class="note">
        Legge le etichette e propone le ricette.
        {#if models}Modelli in uso: {models.models.slice(0, 3).map(modelLabel).join(', ')}{models.fromList ? ' (aggiornati da Google ogni giorno)' : ''}.{/if}
      </p>
      <div class="actions">
        <button class="btn btn-small" onclick={() => (changingKey = true)}>Cambia chiave</button>
        <button class="btn btn-small btn-ghost danger" onclick={disconnect}>Scollega</button>
      </div>
    {:else}
      <AiKeyForm
        onsaved={(k) => {
          app.aiKey = k;
          changingKey = false;
          void refreshModels();
        }}
      />
      {#if changingKey}<button class="btn btn-ghost btn-small" onclick={() => (changingKey = false)}>Annulla</button>{/if}
    {/if}
  </div>

  <h3 class="section-title">Avvisi delle scadenze</h3>
  <div class="list">
    <label class="switch-row">
      <span class="grow">
        <span class="title">Avvisami quando qualcosa scade</span>
        <span class="sub">Una notifica solo nei giorni in cui un prodotto scade oggi o domani</span>
      </span>
      <input class="switch" type="checkbox" checked={app.settings.notify.enabled} onchange={(e) => void toggleNotify((e.currentTarget as HTMLInputElement).checked)} />
    </label>
    {#if app.settings.notify.enabled}
      <label class="switch-row">
        <span class="grow"><span class="title">Ora dell’avviso</span></span>
        <input class="input time" type="time" value={time} onchange={(e) => void setTime((e.currentTarget as HTMLInputElement).value)} />
      </label>
    {/if}
  </div>
  {#if notifBlocked && app.settings.notify.enabled}
    <p class="warning spaced">Android blocca le notifiche di Dispensa: attivale da Impostazioni di Android → App → Dispensa → Notifiche.</p>
  {/if}

  <h3 class="section-title">Ricette</h3>
  <div class="list">
    <label class="switch-row">
      <span class="grow">
        <span class="title">Senza glutine</span>
        <span class="sub">Tutte le ricette senza glutine</span>
      </span>
      <input class="switch" type="checkbox" checked={app.settings.recipes.glutenFree} onchange={(e) => void setGluten((e.currentTarget as HTMLInputElement).checked)} />
    </label>
    <div class="staples">
      <span class="title">Sempre in casa</span>
      <span class="sub">Non servono in dispensa e non finiscono tra gli ingredienti da comprare</span>
      <div class="chips">
        {#each app.settings.recipes.staples as s (s)}
          <button class="chip small" onclick={() => void removeStaple(s)} aria-label="Togli {s}">{s} <Icon name="close" size={14} /></button>
        {/each}
      </div>
      <form
        class="add-staple"
        onsubmit={(e) => {
          e.preventDefault();
          void addStaple();
        }}
      >
        <input class="input" bind:value={staple} placeholder="Es. zucchero, farina, aglio" maxlength="40" />
        <button class="btn btn-soft" type="submit" disabled={!staple.trim()}>Aggiungi</button>
      </form>
    </div>
  </div>

  <h3 class="section-title">Backup</h3>
  <div class="list">
    <button class="row" onclick={backup}>
      <Icon name="download" />
      <span class="grow"><span class="title">Salva un backup</span><span class="sub">Su Drive, email o WhatsApp: tutti i prodotti, la spesa e le ricette</span></span>
    </button>
    <button class="row" onclick={restore}>
      <Icon name="upload" />
      <span class="grow"><span class="title">Ripristina un backup</span><span class="sub">Scegli il file salvato prima</span></span>
    </button>
  </div>

  <h3 class="section-title">Aggiornamenti</h3>
  <div class="list">
    <button class="row" onclick={checkUpdates} disabled={checking}>
      <Icon name="refresh" />
      <span class="grow"><span class="title">{checking ? 'Controllo…' : 'Controlla aggiornamenti'}</span><span class="sub">Versione installata: {APP_VERSION}</span></span>
    </button>
    <button class="row" onclick={() => openExternal(RELEASES_PAGE)}>
      <Icon name="download" />
      <span class="grow"><span class="title">Scarica da GitHub</span><span class="sub">Apre la pagina delle versioni nel browser</span></span>
    </button>
  </div>

  <p class="note about">
    I dati restano solo su questo telefono. Le foto vanno a Google Gemini solo quando le fai leggere; i codici a barre si cercano su Open Food Facts
    (database libero, licenza ODbL).
  </p>
</Sheet>

<style>
  .section-title.first {
    margin-top: 4px;
  }
  .ok {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 650;
    color: var(--primary-text);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .danger {
    color: var(--danger);
  }
  .title {
    display: block;
    font-weight: 600;
  }
  .sub {
    display: block;
    font-size: 0.875rem;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .time {
    width: auto;
    min-height: 44px;
    flex: none;
  }
  .spaced {
    margin-top: 10px;
  }
  .staples {
    padding: 12px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .chip.small {
    min-height: 36px;
    padding: 0 12px;
    font-size: 0.875rem;
  }
  .add-staple {
    display: flex;
    gap: 8px;
  }
  .add-staple .input {
    flex: 1;
    min-width: 0;
  }
  .about {
    margin-top: 20px;
  }
</style>
