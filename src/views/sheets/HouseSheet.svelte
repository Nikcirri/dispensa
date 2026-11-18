<script lang="ts">
  // Casa condivisa: crearla (con il progetto gratuito di Firebase), entrarci con un invito, invitare, uscire.
  import { untrack } from 'svelte';
  import { renderSVG } from 'uqr';
  import RULES from '../../../firestore.rules?raw';
  import { reportError } from '../../lib/errors';
  import { firebaseConfigProblem, parseFirebaseConfig, readInvite } from '../../lib/logic/house';
  import { plural } from '../../lib/logic/text';
  import { isNative, openExternal } from '../../lib/platform';
  import { scanQrCode } from '../../lib/services/barcode';
  import { copyText, shareText } from '../../lib/services/share';
  import { app, sheets } from '../../lib/state/app.svelte';
  import { createSharedHouse, currentInvite, house, joinSharedHouse, leaveSharedHouse, retryHouse } from '../../lib/state/house.svelte';
  import { confirmDialog, showToast, withBusy } from '../../lib/state/ui.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Sheet from '../../lib/ui/Sheet.svelte';

  const FIREBASE_CONSOLE = 'https://console.firebase.google.com/';

  type View = 'start' | 'join' | 'create';
  let view = $state<View>(untrack(() => (sheets.house === 'join' ? 'join' : 'start')));
  let inviteText = $state('');
  let configText = $state('');
  let name = $state('');
  let keepLocal = $state(true);
  let showQr = $state(false);
  let showRules = $state(false);
  let working = $state(false);

  const invite = $derived(readInvite(inviteText));
  const config = $derived(parseFirebaseConfig(configText));
  const configProblem = $derived(firebaseConfigProblem(configText));
  const localCount = $derived({ items: app.items.length, shopping: app.shopping.length, meals: app.meals.length });
  const hasLocal = $derived(localCount.items + localCount.shopping + localCount.meals > 0);
  const others = $derived(house.members.filter((m) => m.uid !== house.myUid));
  const qrSvg = $derived.by(() => {
    if (!showQr) return '';
    const inv = currentInvite();
    return inv ? renderSVG(inv.code, { border: 2, pixelSize: 6, ecc: 'L' }) : '';
  });

  function close() {
    sheets.house = null;
  }

  function back() {
    view = 'start';
  }

  async function scan() {
    try {
      const text = await scanQrCode(() => showToast('Preparo lo scanner di Google… (solo la prima volta)', { duration: 6000 }));
      if (!text) return;
      if (!readInvite(text)) {
        showToast('Questo QR non è un invito di Dispensa.');
        return;
      }
      inviteText = text;
    } catch (e) {
      reportError(e);
    }
  }

  async function join() {
    if (working) return;
    working = true;
    try {
      await withBusy('Entro nella casa…', () => joinSharedHouse(inviteText, name, keepLocal));
      showToast('🏠 Sei nella casa: dispensa, spesa e pasti ora sono in comune', { duration: 4500 });
    } catch (e) {
      reportError(e);
    } finally {
      working = false;
    }
  }

  async function create() {
    if (working) return;
    working = true;
    try {
      await withBusy('Creo la casa…', () => createSharedHouse(configText, name));
      showToast('🏠 Casa creata: ora invita chi vive con te', { duration: 4500 });
    } catch (e) {
      reportError(e);
    } finally {
      working = false;
    }
  }

  async function copyRules() {
    if (await copyText(RULES)) showToast('Regole copiate: incollale in Firebase e tocca Pubblica');
    else showRules = true;
  }

  async function shareInvite() {
    const inv = currentInvite();
    if (!inv) return;
    try {
      await shareText('Invito alla casa di Dispensa', inv.message);
      if (!isNative()) showToast('Invito copiato: incollalo in un messaggio');
    } catch (e) {
      reportError(e);
    }
  }

  async function copyInvite() {
    const inv = currentInvite();
    if (inv && (await copyText(inv.message))) showToast('Invito copiato');
  }

  async function leave() {
    const ok = await confirmDialog({
      title: 'Uscire dalla casa?',
      message: 'Dispensa, spesa e pasti restano su questo telefono, ma non si aggiornano più con gli altri. Potrai rientrare con un nuovo invito.',
      confirmLabel: 'Esci',
      danger: true,
    });
    if (!ok) return;
    try {
      await withBusy('Esco dalla casa…', () => leaveSharedHouse());
      view = 'start';
      showToast('Sei uscito dalla casa condivisa');
    } catch (e) {
      reportError(e);
    }
  }

  async function retry() {
    await withBusy('Mi ricollego…', () => retryHouse());
    if (house.status === 'error') showToast(house.error, { duration: 4500 });
  }
</script>

{#snippet actions()}
  {#if view === 'join'}
    <button class="btn btn-primary btn-big btn-block" disabled={!invite || !name.trim() || working} onclick={join}><Icon name="home" /> Entra nella casa</button>
  {:else}
    <button class="btn btn-primary btn-big btn-block" disabled={!config || !name.trim() || working} onclick={create}><Icon name="home" /> Crea la casa</button>
  {/if}
{/snippet}

<Sheet title="Casa condivisa" onclose={close} footer={!house.joined && view !== 'start' ? actions : undefined}>
  {#if house.joined}
    <div class="status card" class:bad={house.status === 'error'}>
      <span class="dot {house.status}" aria-hidden="true"></span>
      <div class="grow">
        {#if house.status === 'online'}
          <strong>Collegata</strong>
          <span>{house.sending ? 'Invio le tue modifiche…' : 'Le modifiche arrivano a tutti in pochi secondi.'}</span>
        {:else if house.status === 'connecting'}
          <strong>Mi collego…</strong>
          <span>Un momento.</span>
        {:else if house.status === 'offline'}
          <strong>In attesa di internet</strong>
          <span>Puoi usare l’app lo stesso: le modifiche partono appena torna la connessione.</span>
        {:else}
          <strong>Qualcosa non va</strong>
          <span>{house.error}</span>
          <button class="btn btn-small btn-soft retry" onclick={retry}>Riprova</button>
        {/if}
      </div>
    </div>

    <h3 class="section-title">In casa</h3>
    <ul class="list members">
      <li class="member"><span class="avatar">{(house.name || '?').charAt(0).toUpperCase()}</span><span class="grow">{house.name} <em>(tu)</em></span></li>
      {#each others as m (m.uid)}
        <li class="member"><span class="avatar">{(m.name || '?').charAt(0).toUpperCase()}</span><span class="grow">{m.name || 'Senza nome'}</span></li>
      {/each}
    </ul>
    {#if !others.length}
      <p class="note">Per ora ci sei solo tu: manda l’invito a chi vive con te.</p>
    {/if}

    <h3 class="section-title">Invita qualcuno</h3>
    <div class="card invite">
      <p>Manda l’invito su WhatsApp: chi lo riceve installa Dispensa e incolla il messaggio. Se siete vicini, può anche inquadrare il QR.</p>
      <div class="row-btns">
        <button class="btn btn-primary grow" onclick={shareInvite}><Icon name="share" size={20} /> Manda l’invito</button>
        <button class="btn" onclick={() => (showQr = !showQr)} aria-pressed={showQr}><Icon name="qr" size={20} /> QR</button>
      </div>
      {#if showQr}
        <div class="qr">
          {@html qrSvg}
          <p>Sull’altro telefono: ⚙️ Impostazioni → Casa condivisa → Ho un invito → <strong>Inquadra il QR</strong>.</p>
        </div>
      {/if}
      <button class="btn btn-ghost btn-small" onclick={copyInvite}><Icon name="copy" size={18} /> Copia l’invito</button>
    </div>

    <p class="note shared">
      Si condividono <strong>dispensa, lista della spesa e pasti</strong>. Restano solo tue: ricette salvate, statistiche, avvisi e la chiave di Gemini.
      I dati della casa stanno nel tuo progetto Firebase “{house.projectId}”.
    </p>

    <div class="list">
      <button class="row danger" onclick={leave}>
        <Icon name="close" />
        <span class="grow"><span class="title">Esci dalla casa</span><span class="sub">I dati restano su questo telefono</span></span>
      </button>
    </div>
  {:else if view === 'start'}
    <div class="hero card">
      <span class="icon-tile"><Icon name="home" /></span>
      <p>
        Tu e chi vive con te vedete <strong>la stessa dispensa, la stessa lista della spesa e gli stessi pasti</strong>. Quando uno aggiunge o spunta
        qualcosa, l’altro lo vede dopo pochi secondi.
      </p>
    </div>
    <div class="list">
      <button class="row" onclick={() => (view = 'join')}>
        <Icon name="users" />
        <span class="grow"><span class="title">Ho un invito</span><span class="sub">Qualcuno della casa ti ha mandato un messaggio o ti mostra un QR</span></span>
        <Icon name="chevronRight" size={20} />
      </button>
      <button class="row" onclick={() => (view = 'create')}>
        <Icon name="home" />
        <span class="grow"><span class="title">Crea la casa</span><span class="sub">La prepari tu, una volta sola, con un progetto gratuito di Firebase (circa 10 minuti)</span></span>
        <Icon name="chevronRight" size={20} />
      </button>
    </div>
    <p class="note">Restano solo tue: ricette salvate, statistiche, avvisi e la chiave di Gemini. Funziona anche senza internet: le modifiche partono quando torna.</p>
  {:else if view === 'join'}
    <button class="btn btn-ghost btn-small backlink" onclick={back}><Icon name="chevronLeft" size={18} /> Indietro</button>
    <label class="field">
      <span class="label">1. Incolla il messaggio dell’invito</span>
      <textarea class="input" rows="4" bind:value={inviteText} placeholder="Tieni premuto qui e scegli Incolla"></textarea>
    </label>
    {#if inviteText.trim()}
      <p class="check" class:ok={!!invite}>{invite ? '✓ Invito valido' : '✗ Non trovo il codice: incolla tutto il messaggio ricevuto'}</p>
    {/if}
    {#if isNative()}
      <button class="btn btn-block" onclick={scan}><Icon name="qr" size={20} /> Inquadra il QR</button>
    {/if}
    <label class="field">
      <span class="label">2. Il tuo nome</span>
      <input class="input" bind:value={name} placeholder="Es. Mamma" maxlength="30" autocomplete="off" />
      <span class="sub">Lo vedono gli altri della casa (es. “Mamma ha aggiunto il latte alla spesa”).</span>
    </label>
    {#if hasLocal}
      <fieldset class="choice">
        <legend class="label">
          3. Su questo telefono hai già {plural(localCount.items, 'prodotto', 'prodotti')}, {plural(localCount.shopping, 'cosa', 'cose')} da comprare e
          {plural(localCount.meals, 'pasto', 'pasti')}:
        </legend>
        <label class="opt">
          <input type="radio" name="keep" checked={keepLocal} onchange={() => (keepLocal = true)} />
          <span><strong>Aggiungili alla casa</strong><span class="sub">Li vedranno anche gli altri</span></span>
        </label>
        <label class="opt">
          <input type="radio" name="keep" checked={!keepLocal} onchange={() => (keepLocal = false)} />
          <span><strong>Usa solo quelli della casa</strong><span class="sub">Quelli di questo telefono si cancellano</span></span>
        </label>
      </fieldset>
    {/if}
  {:else}
    <button class="btn btn-ghost btn-small backlink" onclick={back}><Icon name="chevronLeft" size={18} /> Indietro</button>
    <p class="note intro">
      Firebase è il servizio di Google che tiene i dati della casa. Il piano gratuito non chiede la carta e non costa niente: per una famiglia basta e
      avanza. Fai questi passi una volta sola, dal browser del telefono.
    </p>
    <ol class="steps">
      <li>
        <strong>Apri Firebase</strong> e accedi con il tuo account Google. Tocca <em>Crea un progetto</em> (o <em>Inizia</em>), chiamalo per esempio
        “Dispensa casa” e vai avanti: Google Analytics non serve, puoi disattivarlo.
        <button class="btn btn-small btn-soft" onclick={() => openExternal(FIREBASE_CONSOLE)}><Icon name="share" size={16} /> Apri Firebase</button>
      </li>
      <li>
        Nel menu (☰) apri <em>Firestore Database</em> (a volte è sotto “Database e storage” o “Crea”) e tocca <em>Crea database</em>. Scegli una località
        in Europa (es. <em>europe-west8 – Milano</em>) e <em>Modalità produzione</em>.
      </li>
      <li>
        Nella pagina del database apri la scheda <em>Regole</em>, cancella tutto il testo, incolla le regole di Dispensa e tocca <em>Pubblica</em>.
        <span class="row-btns">
          <button class="btn btn-small btn-soft" onclick={copyRules}><Icon name="copy" size={16} /> Copia le regole</button>
          <button class="btn btn-small btn-ghost" onclick={() => (showRules = !showRules)}>{showRules ? 'Nascondi' : 'Guarda'}</button>
        </span>
        {#if showRules}<textarea class="input rules" readonly rows="8" value={RULES}></textarea>{/if}
      </li>
      <li>
        Nel menu apri <em>Authentication</em> → <em>Inizia</em> → scheda <em>Metodo di accesso</em> → <em>Anonimo</em>: attivalo e tocca <em>Salva</em>.
      </li>
      <li>
        Torna alla pagina principale del progetto e tocca l’icona <em>Web</em> <code>&lt;/&gt;</code> (“Aggiungi app”). Dai un nome (es. Dispensa) e tocca
        <em>Registra app</em>. Copia <strong>tutto</strong> il riquadro che inizia con <code>const firebaseConfig = &#123;</code>.
        <span class="sub">Se l’hai già fatto: ⚙️ Impostazioni progetto → Le tue app → Configurazione.</span>
      </li>
    </ol>
    <label class="field">
      <span class="label">6. Incolla qui la configurazione</span>
      <textarea class="input" rows="5" bind:value={configText} placeholder="const firebaseConfig = &#123; apiKey: …"></textarea>
    </label>
    {#if configText.trim()}
      <p class="check" class:ok={!!config}>{config ? `✓ Progetto “${config.projectId}”` : `✗ ${configProblem}`}</p>
    {/if}
    <label class="field">
      <span class="label">7. Il tuo nome</span>
      <input class="input" bind:value={name} placeholder="Es. Nicola" maxlength="30" autocomplete="off" />
      <span class="sub">Lo vedono gli altri della casa.</span>
    </label>
    {#if hasLocal}
      <p class="note">Quello che hai già su questo telefono (dispensa, spesa e pasti) va nella casa.</p>
    {/if}
  {/if}

</Sheet>

<style>
  .status {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 14px 16px;
  }
  .status .grow {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .status span {
    color: var(--text-muted);
    font-size: 0.9375rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .status.bad {
    border: 1px solid var(--danger);
  }
  .retry {
    align-self: flex-start;
    margin-top: 6px;
  }
  .dot {
    flex: none;
    width: 12px;
    height: 12px;
    margin-top: 6px;
    border-radius: 50%;
    background: var(--amber);
  }
  .dot.online {
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .dot.error {
    background: var(--danger);
  }
  .members {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .member {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    overflow-wrap: anywhere;
  }
  .member:last-child {
    border-bottom: 0;
  }
  .member em {
    color: var(--text-muted);
    font-style: normal;
  }
  .avatar {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 700;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .invite {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .invite p {
    margin: 0;
    line-height: 1.45;
  }
  .row-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }
  .qr {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-radius: 18px;
    background: #fff;
    color: #111;
  }
  .qr :global(svg) {
    width: min(260px, 100%);
    height: auto;
  }
  .qr p {
    font-size: 0.875rem;
    text-align: center;
  }
  .shared {
    margin-top: 14px;
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
    font-weight: 400;
  }
  .hero {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 14px;
  }
  .hero p {
    margin: 0;
    line-height: 1.45;
  }
  .backlink {
    align-self: flex-start;
    margin-bottom: 6px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 12px 0 4px;
  }
  .label {
    font-weight: 650;
    line-height: 1.35;
  }
  textarea.input {
    min-height: 0;
    resize: vertical;
    font-size: 0.9375rem;
    line-height: 1.4;
  }
  .rules {
    margin-top: 8px;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
  }
  .check {
    margin: 4px 2px 8px;
    color: var(--danger);
    font-weight: 600;
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }
  .check.ok {
    color: var(--accent-text);
  }
  .choice {
    border: 0;
    margin: 12px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .choice legend {
    padding: 0;
    margin-bottom: 8px;
  }
  .opt {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--surface-2);
  }
  .opt input {
    width: 22px;
    height: 22px;
    flex: none;
    margin-top: 2px;
    accent-color: var(--accent);
  }
  .intro {
    margin-top: 0;
  }
  .steps {
    margin: 12px 0 0;
    padding-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    line-height: 1.5;
  }
  .steps li {
    overflow-wrap: anywhere;
  }
  .steps .btn {
    margin-top: 6px;
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.875em;
    background: var(--surface-2);
    padding: 1px 5px;
    border-radius: 6px;
  }
</style>
