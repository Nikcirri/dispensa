<script lang="ts">
  import { reportError } from '../lib/errors';
  import { addDays } from '../lib/logic/dates';
  import { draftFromName, type ProductDraft } from '../lib/logic/drafts';
  import { isNative } from '../lib/platform';
  import { askNotificationPermission } from '../lib/services/notifications';
  import { addDrafts, app, scheduleNotifications, updateSettings } from '../lib/state/app.svelte';
  import Icon from '../lib/ui/Icon.svelte';

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

  async function start(withDemo: boolean) {
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
    } catch (e) {
      starting = false;
      reportError(e);
    }
  }
</script>

<div class="onb">
  <div class="logo" aria-hidden="true">
    <svg viewBox="0 0 108 108" width="96" height="96">
      <rect width="108" height="108" rx="28" fill="#4E8752" />
      <path d="M43 29h22a3 3 0 0 1 3 3v5H40v-5a3 3 0 0 1 3-3z" fill="#F2A65A" />
      <path d="M39 40h30a5 5 0 0 1 5 5v23a9 9 0 0 1-9 9H43a9 9 0 0 1-9-9V45a5 5 0 0 1 5-5z" fill="#fff" />
      <path d="M45 69C45 58 51 51 63 51C63 62 57 69 45 69Z" fill="#4E8752" />
      <path d="M45 69L57 57" stroke="#fff" stroke-width="2" stroke-linecap="round" />
    </svg>
  </div>
  <h1>Dispensa &amp; Cucina IA</h1>
  <p class="lead">Frigo e dispensa sotto controllo, zero sprechi.</p>

  <ul class="features">
    <li>
      <span class="ic"><Icon name="camera" /></span>
      <span><strong>Fotografa l’etichetta</strong>: leggo nome e scadenza in un colpo solo. Oppure il codice a barre, o lo scontrino.</span>
    </li>
    <li>
      <span class="ic red">⏰</span>
      <span><strong>Scadenze a colori</strong>: rosso oggi e domani, arancione entro 5 giorni. Ti avviso io.</span>
    </li>
    <li>
      <span class="ic"><Icon name="chef" /></span>
      <span><strong>Cosa cucino?</strong> Ricette con quello che sta per scadere.</span>
    </li>
  </ul>

  <div class="buttons">
    <button class="btn btn-primary btn-big btn-block" disabled={starting} onclick={() => start(false)}>Inizia</button>
    <button class="btn btn-ghost btn-block" disabled={starting} onclick={() => start(true)}>Inizia con qualche prodotto di prova</button>
  </div>
  <p class="note">Tutto resta sul tuo telefono. Android ti chiederà il permesso per gli avvisi delle scadenze.</p>
</div>

<style>
  .onb {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: calc(var(--safe-top) + 40px) 24px calc(var(--safe-bottom) + 24px);
    text-align: center;
    gap: 10px;
    max-width: 520px;
    margin: 0 auto;
  }
  .logo {
    animation: drop 500ms cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  @keyframes drop {
    from {
      transform: translateY(-20px) scale(0.8);
      opacity: 0;
    }
  }
  h1 {
    margin: 8px 0 0;
    font-size: 1.875rem;
  }
  .lead {
    margin: 0;
    color: var(--text-muted);
    font-size: 1.0625rem;
  }
  .features {
    list-style: none;
    margin: 20px 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    text-align: left;
  }
  .features li {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    line-height: 1.45;
  }
  .ic {
    flex: none;
    width: 46px;
    height: 46px;
    border-radius: 14px;
    background: var(--primary-soft);
    color: var(--primary-text);
    display: grid;
    place-items: center;
    font-size: 1.4rem;
  }
  .ic.red {
    background: var(--red-soft);
  }
  .buttons {
    width: 100%;
    margin-top: auto;
    padding-top: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
