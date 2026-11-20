<script lang="ts">
  // Un prodotto della lista della spesa: nome, nota e specifiche (es. Pasta → 2 × penne rigate, 2 × spaghetti).
  // Si salva chiudendo il foglio o con "Fatto".
  import { untrack } from 'svelte';
  import { db } from '../../lib/db';
  import { reportError } from '../../lib/errors';
  import { guessFood } from '../../lib/logic/foods';
  import { cleanDetails, MAX_DETAIL_QTY, MAX_DETAILS } from '../../lib/logic/shopping';
  import { capitalize } from '../../lib/logic/text';
  import { tapFeedback } from '../../lib/platform';
  import { updateShopping } from '../../lib/repo';
  import { app, reloadShopping, sheets } from '../../lib/state/app.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import { blurOnEnter } from '../../lib/ui/keyboard';
  import Sheet from '../../lib/ui/Sheet.svelte';
  import type { ShoppingDetail, ShoppingItem } from '../../lib/types';

  let { id }: { id: string } = $props();
  const itemId = untrack(() => id);
  const start = untrack(() => app.shopping.find((s) => s.id === itemId));
  const original: ShoppingItem | null = start ? ($state.snapshot(start) as ShoppingItem) : null;

  let name = $state(original?.name ?? '');
  let note = $state(original?.note ?? '');
  let details = $state<ShoppingDetail[]>(original?.details ? original.details.map((d) => ({ ...d })) : []);
  let newText = $state('');
  let newInput = $state<HTMLInputElement | null>(null);
  let saved = false;

  const emoji = $derived(guessFood(name || original?.name || '').emoji || original?.emoji || '🛒');

  function addDetail() {
    const text = newText.replace(/\s+/g, ' ').trim();
    if (!text || details.length >= MAX_DETAILS) return;
    details = [...details, { text, qty: 1 }];
    newText = '';
    void tapFeedback();
    newInput?.focus();
  }

  function changeQty(i: number, dir: 1 | -1) {
    const d = details[i];
    if (!d) return;
    const next = Math.min(MAX_DETAIL_QTY, Math.max(1, d.qty + dir));
    if (next === d.qty) return;
    d.qty = next;
    void tapFeedback();
  }

  function removeDetail(i: number) {
    details = details.filter((_, k) => k !== i);
    void tapFeedback();
  }

  async function save(): Promise<void> {
    if (saved || !original) return;
    saved = true;
    // Una specifica scritta ma non ancora aggiunta col "+" non si perde.
    const all = newText.trim() ? [...details, { text: newText, qty: 1 }] : details;
    const clean = cleanDetails($state.snapshot(all));
    const cleanName = capitalize(name.replace(/\s+/g, ' ').trim()).slice(0, 60) || original.name;
    const change: Partial<ShoppingItem> = { name: cleanName, note: note.trim().slice(0, 40), details: clean.length ? clean : undefined };
    if (cleanName !== original.name) change.emoji = guessFood(cleanName).emoji;
    const same =
      cleanName === original.name &&
      change.note === original.note &&
      JSON.stringify(clean) === JSON.stringify(original.details ?? []);
    if (same) return;
    try {
      await updateShopping(db, original.id, change);
      await reloadShopping();
    } catch (e) {
      reportError(e);
    }
  }

  async function close() {
    await save();
    sheets.shoppingItem = null;
  }
</script>

<Sheet title="Da comprare" onclose={() => void close()}>
  {#if !original}
    <p class="lead">Questo prodotto non è più nella lista.</p>
  {:else}
    <div class="stack">
      <div class="head">
        <span class="emoji" aria-hidden="true">{emoji}</span>
        <input class="input name" bind:value={name} aria-label="Nome" maxlength="60" enterkeyhint="done" onkeydown={blurOnEnter} />
      </div>

      <section>
        <h3 class="label">Specifiche</h3>
        <p class="hint">Che tipo, che marca, quanti: es. 2 × “penne rigate”, 1 × “spaghetti integrali”. Quando lo metti in dispensa diventa un prodotto per ogni specifica.</p>
        {#if details.length}
          <ul class="details">
            {#each details as d, i (i)}
              <li>
                <div class="qty" aria-label="Quanti">
                  <button aria-label="Uno in meno di {d.text}" disabled={d.qty <= 1} onclick={() => changeQty(i, -1)}><Icon name="minus" size={16} /></button>
                  <span class="num">{d.qty}</span>
                  <button aria-label="Uno in più di {d.text}" disabled={d.qty >= MAX_DETAIL_QTY} onclick={() => changeQty(i, 1)}><Icon name="plus" size={16} /></button>
                </div>
                <input class="input text" bind:value={d.text} aria-label="Specifica" maxlength="80" enterkeyhint="done" onkeydown={blurOnEnter} />
                <button class="icon-btn" aria-label="Togli {d.text}" onclick={() => removeDetail(i)}><Icon name="close" size={20} /></button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if details.length < MAX_DETAILS}
          <form
            class="adder"
            onsubmit={(e) => {
              e.preventDefault();
              addDetail();
            }}
          >
            <input
              class="input"
              bind:this={newInput}
              bind:value={newText}
              placeholder={details.length ? 'Un’altra specifica…' : 'Es. penne rigate'}
              maxlength="80"
              autocomplete="off"
              enterkeyhint="done"
            />
            <button class="circle-btn lime" type="submit" aria-label="Aggiungi la specifica" disabled={!newText.trim()}><Icon name="plus" size={22} stroke={2.6} /></button>
          </form>
        {/if}
      </section>

      <label class="field">
        <span class="label">Nota</span>
        <input class="input" bind:value={note} placeholder="Es. 1 kg, quello in offerta…" maxlength="40" enterkeyhint="done" onkeydown={blurOnEnter} />
      </label>
    </div>
  {/if}

  {#snippet footer()}
    <button class="btn btn-primary btn-big btn-block" onclick={() => void close()}><Icon name="check" /> Fatto</button>
  {/snippet}
</Sheet>

<style>
  .lead {
    margin: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .emoji {
    font-size: 1.8rem;
    width: 52px;
    height: 52px;
    flex: none;
    border-radius: 16px;
    background: var(--surface-2);
    display: grid;
    place-items: center;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 650;
    font-size: 1.0625rem;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .label {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 650;
  }
  .hint {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
    line-height: 1.45;
  }
  .details {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .details li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border-radius: 18px;
    background: var(--surface-2);
  }
  .qty {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: none;
    padding: 2px;
    border-radius: 999px;
    background: var(--surface);
  }
  .qty button {
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: inherit;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .qty button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .qty .num {
    min-width: 24px;
    text-align: center;
    font-weight: 700;
  }
  .text {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 6px 12px;
  }
  .adder {
    display: flex;
    gap: 8px;
  }
  .adder .input {
    flex: 1;
    min-width: 0;
  }
  .adder .circle-btn {
    width: 52px;
    height: 52px;
    flex: none;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
