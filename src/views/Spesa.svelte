<script lang="ts">
  // Scheda "Spesa": cosa comprare, i suggerimenti, gli ingredienti dei pasti in programma.
  import { flip } from 'svelte/animate';
  import { db } from '../lib/db';
  import { reportError } from '../lib/errors';
  import { addDays } from '../lib/logic/dates';
  import { draftFromName, draftFromTemplate, templateKey, type ProductDraft } from '../lib/logic/drafts';
  import { badgeText, daysLeft } from '../lib/logic/expiry';
  import { formatQuantity } from '../lib/logic/foods';
  import { findInPantry } from '../lib/logic/match';
  import { shoppingForMeals } from '../lib/logic/meals';
  import { shoppingShareText, sortShopping, splitNames } from '../lib/logic/shopping';
  import { normalize, plural } from '../lib/logic/text';
  import { isNative, tapFeedback } from '../lib/platform';
  import { addShopping, deleteShopping, updateShopping } from '../lib/repo';
  import { shareText } from '../lib/services/share';
  import { app, reloadShopping, sheets } from '../lib/state/app.svelte';
  import { startReceipt } from '../lib/state/add.svelte';
  import { addMissingToShopping } from '../lib/state/meals.svelte';
  import { showToast, showUndoToast } from '../lib/state/ui.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import type { ShoppingItem } from '../lib/types';

  let text = $state('');
  const sorted = $derived(sortShopping(app.shopping));
  const todo = $derived(sorted.filter((s) => !s.done));
  const done = $derived(sorted.filter((s) => s.done));

  // Prodotti che compri di solito ma che adesso non sono né in dispensa né nella lista.
  const suggestions = $derived.by(() => {
    const inPantry = new Set(app.items.map((i) => normalize(i.name)));
    const inList = new Set(app.shopping.map((s) => normalize(s.name)));
    return app.templates.filter((t) => !inPantry.has(normalize(t.name)) && !inList.has(normalize(t.name))).slice(0, 8);
  });

  /** "Ne hai già 1 pz (scade tra 3 giorni)": per non comprare un doppione senza volerlo. */
  function haveText(name: string): string {
    const item = findInPantry(name, app.items);
    if (!item) return '';
    const d = daysLeft(item, app.today);
    const when = d === null ? '' : d < 0 ? ', scaduto' : ` (${badgeText(d, item.expiryKind).toLowerCase()})`;
    return `In dispensa: ${formatQuantity(item.quantity, item.unit)}${when}`;
  }

  // Ingredienti che mancano per i pasti dei prossimi 7 giorni (e non sono già nella lista).
  const nextDays = $derived(Array.from({ length: 7 }, (_, i) => addDays(app.today, i)));
  const forMeals = $derived(shoppingForMeals(app.meals, nextDays, app.items, app.shopping, app.today));

  async function add() {
    const names = splitNames(text);
    if (!names.length) return;
    try {
      for (const n of names.reverse()) await addShopping(db, n);
      text = '';
      await reloadShopping();
      void tapFeedback();
    } catch (e) {
      reportError(e);
    }
  }

  async function addSuggestion(name: string) {
    await addShopping(db, name);
    await reloadShopping();
    void tapFeedback();
  }

  async function toggle(s: ShoppingItem) {
    void tapFeedback();
    await updateShopping(db, s.id, { done: !s.done });
    await reloadShopping();
  }

  async function remove(s: ShoppingItem) {
    const copy = $state.snapshot(s) as ShoppingItem;
    await deleteShopping(db, [s.id]);
    await reloadShopping();
    showUndoToast(`${s.name} tolto dalla lista`, async () => {
      await db.shopping.put(copy);
      await reloadShopping();
    });
  }

  async function clearDone() {
    const copies = $state.snapshot(done) as ShoppingItem[];
    await deleteShopping(db, copies.map((s) => s.id));
    await reloadShopping();
    showUndoToast(`${plural(copies.length, 'prodotto tolto', 'prodotti tolti')} dalla lista`, async () => {
      await db.shopping.bulkPut(copies);
      await reloadShopping();
    });
  }

  /** I prodotti comprati vanno in dispensa: si controllano dove vanno e le date. */
  function moveToPantry() {
    const drafts: ProductDraft[] = done.map((s) => {
      const t = app.templates.find((x) => x.key === templateKey({ name: s.name }) || normalize(x.name) === normalize(s.name));
      return t ? { ...draftFromTemplate(t, app.today), source: 'spesa' as const } : draftFromName(s.name, app.today, 'spesa');
    });
    if (!drafts.length) return;
    sheets.multi = { drafts, note: '', kind: 'spesa', shoppingIds: done.map((s) => s.id) };
  }

  async function share() {
    try {
      const ok = await shareText('Lista della spesa', shoppingShareText(app.shopping));
      if (ok && !isNative()) {
        showToast('Lista copiata negli appunti');
      }
    } catch (e) {
      reportError(e);
    }
  }
</script>

<header class="page-top">
  <div class="grow">
    <p class="hello">Lista della spesa</p>
    <h1>Da comprare</h1>
  </div>
  <button class="circle-btn" aria-label="Condividi la lista" disabled={!todo.length} onclick={share}>
    <Icon name="share" size={22} />
  </button>
</header>

<div class="stack">
  <form
    class="adder"
    onsubmit={(e) => {
      e.preventDefault();
      void add();
    }}
  >
    <input class="input" bind:value={text} placeholder="Aggiungi: latte, pane, uova…" autocomplete="off" enterkeyhint="done" />
    <button class="circle-btn lime addbtn" type="submit" aria-label="Aggiungi alla lista" disabled={!text.trim()}><Icon name="plus" size={24} stroke={2.6} /></button>
  </form>

  <button class="card receipt" onclick={startReceipt}>
    <span class="icon-tile"><Icon name="receipt" /></span>
    <span class="grow">
      <strong>Hai fatto la spesa?</strong>
      <span>Fotografa lo scontrino: metto tutto in dispensa e tolgo dalla lista quello che hai comprato.</span>
    </span>
    <Icon name="chevronRight" size={20} />
  </button>

  {#if forMeals.length}
    <section class="card meals-card">
      <p class="meals-title"><span aria-hidden="true">📅</span> Per i pasti in programma ti {forMeals.length === 1 ? 'manca' : 'mancano'}:</p>
      <ul class="meals-list">
        {#each forMeals.slice(0, 6) as m (m.name)}
          <li><strong>{m.name}</strong>{m.amount ? ` (${m.amount})` : ''} <span class="for">· {m.for}</span></li>
        {/each}
        {#if forMeals.length > 6}<li class="for">e altri {forMeals.length - 6}</li>{/if}
      </ul>
      <button class="btn btn-soft btn-small" onclick={() => void addMissingToShopping(forMeals)}><Icon name="cartPlus" size={20} /> Aggiungi alla lista</button>
    </section>
  {/if}

  {#if suggestions.length}
    <div>
      <p class="label">Compri di solito, ma ora non c’è:</p>
      <div class="chips scroll">
        {#each suggestions as t (t.key)}
          <button class="chip" onclick={() => void addSuggestion(t.name)}><span aria-hidden="true">{t.emoji}</span> {t.name} <Icon name="plus" size={16} /></button>
        {/each}
      </div>
    </div>
  {/if}

  {#if todo.length}
    <ul class="list items card">
      {#each todo as s (s.id)}
        <li animate:flip={{ duration: 200 }}>
          <button class="tick" aria-label="Preso: {s.name}" onclick={() => void toggle(s)}></button>
          <span class="emoji" aria-hidden="true">{s.emoji}</span>
          <span class="grow">
            <span class="title">{s.name}</span>
            {#if s.note}<span class="sub">{s.note}</span>{/if}
            {#if haveText(s.name)}<span class="have">🏠 {haveText(s.name)}</span>{/if}
          </span>
          <button class="icon-btn" aria-label="Togli {s.name}" onclick={() => void remove(s)}><Icon name="close" size={20} /></button>
        </li>
      {/each}
    </ul>
  {:else if !done.length}
    <div class="empty">
      <div class="big" aria-hidden="true">🛒</div>
      La lista è vuota. Scrivi qui sopra, oppure tocca il carrello <Icon name="cartPlus" size={18} /> su un prodotto della dispensa.
    </div>
  {:else}
    <p class="empty">Hai preso tutto! 🎉</p>
  {/if}

  {#if done.length}
    <h3 class="section-title">Nel carrello · {done.length}</h3>
    <ul class="list items card">
      {#each done as s (s.id)}
        <li class="done" animate:flip={{ duration: 200 }}>
          <button class="tick on" aria-label="Rimetti da comprare: {s.name}" onclick={() => void toggle(s)}><Icon name="check" size={18} stroke={3} /></button>
          <span class="emoji" aria-hidden="true">{s.emoji}</span>
          <span class="grow"><span class="title">{s.name}</span></span>
        </li>
      {/each}
    </ul>
    <div class="done-actions">
      <button class="go" onclick={moveToPantry}>
        <span class="go-icon"><Icon name="jar" size={22} /></span>
        <span class="go-text">Metti in dispensa</span>
        <span class="go-end"><Icon name="chevronRight" size={20} /></span>
      </button>
      <button class="btn btn-ghost btn-block" onclick={() => void clearDone()}>Togli dalla lista senza metterli in dispensa</button>
    </div>
  {/if}

  {#if todo.length}
    <button class="btn btn-block share" onclick={share}><Icon name="share" /> Condividi la lista</button>
  {/if}
</div>

<style>
  .adder {
    display: flex;
    gap: 8px;
  }
  .adder .input {
    flex: 1;
  }
  .addbtn {
    width: 52px;
    height: 52px;
    flex: none;
  }
  .meals-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .meals-title {
    margin: 0;
    font-weight: 600;
  }
  .meals-list {
    margin: 0;
    padding-left: 22px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .receipt {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
    width: 100%;
  }
  .receipt .grow {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .receipt .grow span {
    font-size: 0.875rem;
    color: var(--text-muted);
    line-height: 1.4;
  }
  .have {
    display: block;
    font-size: 0.8125rem;
    color: var(--accent-text);
    font-weight: 600;
  }
  .for {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .label {
    margin: 0 0 8px 2px;
    font-size: 0.875rem;
    color: var(--text-muted);
    font-weight: 600;
  }
  .items {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow: hidden;
  }
  .items li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 60px;
    padding: 6px 4px 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .items li:last-child {
    border-bottom: 0;
  }
  .tick {
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--border);
    background: transparent;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--accent-contrast);
    transition: background 150ms ease, transform 120ms ease;
  }
  .tick:active {
    transform: scale(0.85);
  }
  .tick.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .emoji {
    font-size: 1.4rem;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .title {
    display: block;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .sub {
    display: block;
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .done .title {
    text-decoration: line-through;
    color: var(--text-muted);
  }
  .done-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .big {
    font-size: 3rem;
    margin-bottom: 8px;
  }
  .empty :global(svg) {
    display: inline-block;
    vertical-align: middle;
  }
</style>
