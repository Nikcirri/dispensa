import { describe, expect, it } from 'vitest';
import { boughtShoppingIds } from './match';
import { addReceiptPart, buildReceiptPrompt, needsDateCheck, parseReceipt, RECEIPT_SCHEMA } from './receipt';

const TODAY = '2026-11-18';

const line = (over: Record<string, unknown>) => ({
  line: 'X',
  name: 'Latte parzialmente scremato',
  brand: '',
  size: '',
  emoji: '🥛',
  location: 'frigo',
  quantity: 1,
  unit: 'pz',
  expiryKind: 'scadenza',
  shelfDays: 6,
  openDays: 3,
  ...over,
});

describe('scontrino', () => {
  it('prompt con le regole per leggere uno scontrino italiano', () => {
    const p = buildReceiptPrompt(TODAY);
    expect(p).toContain('SCONTRINO');
    expect(p).toContain('MOZZ.FDL 125G');
    expect(p).toContain('sacchetti');
    expect(RECEIPT_SCHEMA.required).toContain('purchaseDate');
    expect(JSON.stringify(RECEIPT_SCHEMA)).not.toContain('"expiry"');
  });

  it('prodotti con la data stimata (≈) dal giorno della spesa, righe uguali unite, niente sacchetti', () => {
    const text = JSON.stringify({
      store: 'Coop',
      purchaseDate: '2026-11-16',
      products: [
        line({ line: 'LATTE PS 1L', brand: 'Granarolo', size: '1 l' }),
        line({ line: 'LATTE PS 1L' }),
        line({ name: 'Shopper biodegradabile', emoji: '🛍️', location: 'dispensa' }),
        line({ line: 'POMODORI 0,456KG', name: 'Pomodori', emoji: '🍅', quantity: 456, unit: 'g', shelfDays: 5 }),
        line({ line: 'SPAGHETTI N5', name: 'Spaghetti', emoji: '🍝', location: 'dispensa', expiryKind: 'tmc', shelfDays: 540, openDays: 0 }),
      ],
      note: '',
    });
    const r = parseReceipt(text, TODAY)!;
    expect(r.store).toBe('Coop');
    expect(r.purchaseDate).toBe('2026-11-16');
    expect(r.products.map((p) => [p.name, p.quantity, p.unit])).toEqual([
      ['Latte parzialmente scremato', 2, 'pz'],
      ['Pomodori', 456, 'g'],
      ['Spaghetti', 1, 'pz'],
    ]);
    const latte = r.products[0]!;
    // 6 giorni dal 16 novembre (giorno della spesa), non da oggi.
    expect(latte).toMatchObject({ expiry: '2026-11-22', expiryEstimated: true, source: 'scontrino', receiptLine: 'LATTE PS 1L', brand: 'Granarolo' });
    expect(needsDateCheck(latte, TODAY)).toBe(true);
    expect(needsDateCheck(r.products[2]!, TODAY)).toBe(false);
  });

  it('scontrino vecchio o senza data: si stima da oggi; risposta tagliata: si tengono le righe complete', () => {
    const old = parseReceipt(JSON.stringify({ store: '', purchaseDate: '2026-09-01', products: [line({})], note: '' }), TODAY)!;
    expect(old.purchaseDate).toBe(TODAY);
    expect(old.products[0]!.expiry).toBe('2026-11-24');
    const full = JSON.stringify({ store: '', purchaseDate: '', products: [line({ name: 'Yogurt' }), line({ name: 'Burro' })], note: '' });
    const cut = parseReceipt(full.slice(0, full.indexOf('Burro')), TODAY)!;
    expect(cut.products.map((p) => p.name)).toEqual(['Yogurt']);
    expect(parseReceipt('niente', TODAY)).toBeNull();
  });

  it('scontrino lungo in più foto: i prodotti già trovati non si contano due volte', () => {
    const first = parseReceipt(JSON.stringify({ store: '', purchaseDate: '', products: [line({ name: 'Yogurt' }), line({ name: 'Burro' })], note: '' }), TODAY)!.products;
    first[0]!.expiry = '2026-12-01';
    first[0]!.expiryEstimated = false;
    const second = parseReceipt(JSON.stringify({ store: '', purchaseDate: '', products: [line({ name: 'Burro', quantity: 2 }), line({ name: 'Pane' })], note: '' }), TODAY)!.products;
    const all = addReceiptPart(first, second);
    expect(all.map((p) => [p.name, p.quantity])).toEqual([
      ['Yogurt', 1],
      ['Burro', 2],
      ['Pane', 1],
    ]);
    // La data corretta a mano resta.
    expect(all[0]!.expiry).toBe('2026-12-01');
  });

  it('la lista della spesa si spunta da sola con quello che è sullo scontrino', () => {
    const shopping = [
      { id: 'a', name: 'latte' },
      { id: 'b', name: 'Pomodori pelati' },
      { id: 'c', name: 'Caffè' },
      { id: 'd', name: 'pomodoro' },
    ];
    expect(boughtShoppingIds(shopping, ['Latte parzialmente scremato', 'Pomodori'])).toEqual(['a', 'd']);
  });
});
