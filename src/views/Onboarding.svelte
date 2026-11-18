<script lang="ts">
  import { reportError } from '../lib/errors';
  import { addDays } from '../lib/logic/dates';
  import { draftFromName, type ProductDraft } from '../lib/logic/drafts';
  import { isNative } from '../lib/platform';
  import { askNotificationPermission } from '../lib/services/notifications';
  import { addDrafts, app, scheduleNotifications, sheets, updateSettings } from '../lib/state/app.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Ring from '../lib/ui/Ring.svelte';

  let starting = $state(false);

  const DEMO: [string, number | null][] = [
    ['Mozzarella fior di latte', 0],
    ['Latte parzialmente scremato', 1],
    ['Zucchine', 2],
    ['Yogurt greco bianco', 4],
    ['Uova', 12],
    ['Spaghetti', 320],
    ['Passata di pomodoro', 400],
    ['Piselli surgelati', 150],
  ];

  /** `invite`: chi ha ricevuto un invito entra subito nella casa condivisa (senza prodotti di prova). */
  async function start(withDemo: boolean, invite = false) {
    if (starting) return;
    starting = true;
    try {
      if (withDemo) {
        const drafts: ProductDraft[] = DEMO.map(([name, days]) => {
          const d = draftFromName(name, app.today);
          return { ...d, expiry: days === null ? null : addDays(app.today, days), expiryEstimated: false };
        });
        await addDrafts(drafts);
      }
      if (isNative()) await askNotificationPermission().catch(() => false);
      await updateSettings((s) => {
        s.onboarded = true;
      });
      scheduleNotifications();
      if (invite) sheets.house = 'join';
    } catch (e) {
      starting = false;
      reportError(e);
    }
  }
</script>

<div class="screen">
  <div class="bar">
    <span class="brand"><Icon name="jar" size={20} /> Dispensa</span>
  </div>

  <section class="welcome">
    <h1>Niente più<br />sprechi in cucina.</h1>
    <div class="hero-card">
      <Ring value={0.7} size={116} stroke={11} color="var(--ring-on-lime)" track="var(--ring-track-on-lime)">
        <span class="num ring-n">3</span>
        <span class="ring-c">da usare<br />oggi</span>
      </Ring>
      <ul>
        <li><Icon name="camera" size={18} /> Foto dell’etichetta: nome e scadenza</li>
        <li><Icon name="barcode" size={18} /> Codice a barre e scontrino</li>
        <li><Icon name="clock" size={18} /> Scadenze a colori e avvisi</li>
        <li><Icon name="chef" size={18} /> Ricette con quello che scade</li>
      </ul>
    </div>
    <p class="lead">Rosso se scade oggi o domani, arancione entro 5 giorni. Ti avviso io e ti propongo cosa cucinare. I dati restano solo sul telefono.</p>
  </section>

  <div class="footer">
    <button class="go" disabled={starting} onclick={() => start(false)}>
      <span class="go-icon"><Icon name="chevronRight" /></span>
      <span class="go-text">Iniziamo</span>
      <span class="go-end"><Icon name="check" size={18} /></span>
    </button>
    <button class="btn btn-ghost btn-block" disabled={starting} onclick={() => start(true)}>Inizia con qualche prodotto di prova</button>
    <button class="btn btn-ghost btn-block invite" disabled={starting} onclick={() => start(false, true)}><Icon name="home" size={20} /> Ho un invito per una casa condivisa</button>
    <p class="note center">Android ti chiederà il permesso per gli avvisi delle scadenze.</p>
  </div>
</div>

<style>
  .screen {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    padding: calc(var(--safe-top) + 12px) 20px calc(var(--safe-bottom) + 16px);
    max-width: 560px;
    margin: 0 auto;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    color: var(--accent-text);
    white-space: nowrap;
  }
  section {
    flex: 1;
    padding-top: 16px;
  }
  h1 {
    font-size: 2.5rem;
    line-height: 1.05;
    margin: 12px 0 20px;
  }
  .lead {
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
  }
  .hero-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 18px;
    border-radius: var(--radius);
    background: var(--lime-card);
    color: var(--lime-card-text);
    margin-bottom: 18px;
    animation: rise 450ms cubic-bezier(0.2, 1.2, 0.4, 1);
  }
  @keyframes rise {
    from {
      transform: translateY(14px);
      opacity: 0;
    }
  }
  .ring-n {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1;
  }
  .ring-c {
    font-size: 0.6875rem;
    line-height: 1.2;
    opacity: 0.75;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 0.9375rem;
    font-weight: 600;
    min-width: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    line-height: 1.25;
  }
  .footer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 16px;
  }
  .center {
    text-align: center;
  }
</style>
