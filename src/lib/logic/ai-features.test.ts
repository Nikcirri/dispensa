import { describe, expect, it } from 'vitest';
import type { Item } from '../types';
import {
  buildRecipePrompt,
  DEFAULT_FILTERS,
  groupRecipes,
  onlyExpiringMessage,
  recipeGroup,
  wantsOnlyExpiring,
  parseRecipes,
  RECIPES_SCHEMA,
  recipeShareText,
  sanitizeRecipe,
  savedCount,
  sortRecipes,
  useStatuses,
} from './recipes';
import { buildScanPrompt, firstEmoji, parseAiDate, parseScan, SCAN_SCHEMA } from './scan';

const TODAY = '2026-11-15';

function item(over: Partial<Item>): Item {
  return {
    id: 'x',
    name: 'Latte',
    emoji: '🥛',
    location: 'frigo',
    quantity: 1,
    unit: 'pz',
    expiry: null,
    expiryKind: 'scadenza',
    expiryEstimated: false,
    openedAt: null,
    openDays: null,
    source: 'mano',
    addedAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('foto: date lette dall’IA', () => {
  it('formati italiani, solo mese e anno, date assurde', () => {
    expect(parseAiDate('2027-03-12', TODAY)).toBe('2027-03-12');
    expect(parseAiDate('12/03/27', TODAY)).toBe('2027-03-12');
    expect(parseAiDate('12.03.2027', TODAY)).toBe('2027-03-12');
    expect(parseAiDate('03/2027', TODAY)).toBe('2027-03-31');
    expect(parseAiDate('2028-02', TODAY)).toBe('2028-02-29');
    expect(parseAiDate('2027-02-30', TODAY)).toBeNull();
    expect(parseAiDate('1999-01-01', TODAY)).toBeNull();
    expect(parseAiDate('', TODAY)).toBeNull();
    expect(parseAiDate(null, TODAY)).toBeNull();
  });
  it('prima emoji', () => {
    expect(firstEmoji('🥛 latte')).toBe('🥛');
    expect(firstEmoji('latte')).toBe('');
  });
});

describe('foto: risposta', () => {
  it('legge un prodotto con la data letta', () => {
    const text = JSON.stringify({
      products: [
        {
          name: 'latte parzialmente scremato',
          brand: 'Granarolo',
          size: '1 l',
          emoji: '🥛',
          location: 'frigo',
          quantity: 1,
          unit: 'pz',
          expiry: '2026-11-21',
          expiryText: 'da consumarsi entro 21/11/26',
          expiryKind: 'scadenza',
          shelfDays: 6,
          openDays: 3,
        },
      ],
      note: '',
    });
    const r = parseScan(`\`\`\`json\n${text}\n\`\`\``, TODAY)!;
    expect(r.products).toHaveLength(1);
    expect(r.products[0]).toMatchObject({
      name: 'Latte parzialmente scremato',
      brand: 'Granarolo',
      expiry: '2026-11-21',
      expiryEstimated: false,
      openDays: 3,
      source: 'foto',
    });
  });
  it('senza data: si stima dalla durata; valori sbagliati corretti', () => {
    const text = JSON.stringify({
      products: [
        { name: 'Mozzarella', brand: '', size: '', emoji: 'x', location: 'cantina', quantity: -2, unit: 'scatole', expiry: '', expiryText: '', expiryKind: 'boh', shelfDays: 7, openDays: 0 },
        { name: '', expiry: '' },
      ],
      note: 'data coperta',
    });
    const r = parseScan(text, TODAY)!;
    expect(r.products).toHaveLength(1);
    expect(r.products[0]).toMatchObject({ emoji: '🧀', location: 'frigo', quantity: 1, unit: 'pz', expiry: '2026-11-22', expiryEstimated: true, openDays: null });
    expect(r.note).toBe('data coperta');
  });
  it('solo la data, senza nome, è tenuta', () => {
    const r = parseScan('{"products":[{"name":"","expiry":"2027-01-10"}],"note":""}', TODAY)!;
    expect(r.products[0]).toMatchObject({ name: '', expiry: '2027-01-10' });
  });
  it('risposte non valide', () => {
    expect(parseScan('ciao', TODAY)).toBeNull();
    expect(parseScan('{"x":1}', TODAY)).toBeNull();
  });
  it('istruzioni per le tre modalità e schema completo', () => {
    expect(buildScanPrompt('etichetta', TODAY)).toContain('UN solo prodotto');
    expect(buildScanPrompt('multi', TODAY)).toContain('scontrino');
    expect(buildScanPrompt('data', TODAY, 'Yogurt')).toContain('"Yogurt"');
    expect(buildScanPrompt('etichetta', TODAY)).toContain('2026-11-15');
    expect(SCAN_SCHEMA.properties.products.items.required).toContain('expiry');
  });
});

describe('ricette', () => {
  const items = [
    item({ id: 'a', name: 'Zucchine', expiry: '2026-11-16' }),
    item({ id: 'b', name: 'Latte', expiry: '2026-11-15' }),
    item({ id: 'c', name: 'Pasta', location: 'dispensa', expiry: '2027-05-01', expiryKind: 'tmc' }),
    item({ id: 'd', name: 'Prosciutto', expiry: '2026-11-10' }),
    item({ id: 'e', name: 'Biscotti', location: 'dispensa', expiry: '2026-11-10', expiryKind: 'tmc' }),
  ];

  it('elenco per l’IA: urgenti per primi, niente "da consumarsi entro" già passati, filtri', () => {
    const { prompt, refs } = buildRecipePrompt(items, TODAY, { ...DEFAULT_FILTERS, quick: true, vegetarian: true, servings: 3, extra: 'senza forno' }, { staples: ['sale', 'olio'], glutenFree: false });
    expect(refs.map((r) => r.itemId)).toEqual(['e', 'b', 'a', 'c']);
    expect(prompt).toContain('p2 | Latte | 1 pz | frigo | SCADE OGGI');
    expect(prompt).toContain('p3 | Zucchine | 1 pz | frigo | SCADE DOMANI');
    expect(prompt).not.toContain('Prosciutto');
    expect(prompt).toContain('20 minuti');
    expect(prompt).toContain('vegetariane');
    expect(prompt).toContain('3 persone');
    expect(prompt).toContain('"""senza forno"""');
    expect(prompt).toContain('sale, olio');
  });

  it('legge le ricette e collega i prodotti usati', () => {
    const { refs } = buildRecipePrompt(items, TODAY, DEFAULT_FILTERS, { staples: [], glutenFree: false });
    const text = JSON.stringify({
      recipes: [
        {
          title: 'Pasta zucchine e latte',
          emoji: '🍝',
          minutes: 25,
          difficulty: 'facile',
          servings: 2,
          uses: [
            { ref: 'p3', amount: '2' },
            { ref: 'P2', amount: '100 ml' },
            { ref: 'p99', amount: '?' },
            { ref: 'p3', amount: 'doppio' },
          ],
          missing: [{ name: 'Parmigiano', amount: '30 g' }, { name: '', amount: '' }],
          steps: ['1. Taglia le zucchine', 'Cuoci la pasta'],
          why: 'Usa latte e zucchine',
          tip: '',
        },
        { title: '', steps: [] },
      ],
    });
    const parsed = parseRecipes(text, refs, 2, 'now')!;
    expect(parsed.note).toBe('');
    const list = parsed.recipes;
    expect(list).toHaveLength(1);
    const r = list[0]!;
    expect(r.uses.map((u) => u.itemId)).toEqual(['a', 'b']);
    expect(r.missing).toEqual([{ name: 'Parmigiano', amount: '30 g' }]);
    expect(r.steps[0]).toBe('Taglia le zucchine');
    const st = useStatuses(r, items, TODAY);
    expect(st.map((s) => s.urgency)).toEqual(['rosso', 'rosso']);
    expect(savedCount(st)).toBe(2);
    expect(sanitizeRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(recipeShareText(r)).toContain('1. Taglia le zucchine');
    expect(parseRecipes('niente', refs, 2, 'now')).toBeNull();
  });

  it('prima le ricette che salvano più prodotti in scadenza', () => {
    const base = { emoji: '🍽️', minutes: 10, difficulty: 'facile' as const, servings: 2, missing: [], steps: ['x'], why: '', tip: '', createdAt: '' };
    const slow = { ...base, id: '1', title: 'Pasta', uses: [{ itemId: 'c', name: 'Pasta', emoji: '🍝', amount: '' }] };
    const saver = { ...base, id: '2', title: 'Frittata', uses: [{ itemId: 'a', name: 'Zucchine', emoji: '🥒', amount: '' }] };
    expect(sortRecipes([slow, saver], items, TODAY).map((r) => r.id)).toEqual(['2', '1']);
    expect(RECIPES_SCHEMA.properties.recipes.items.required).toContain('uses');
  });
});

describe('ricette: solo prodotti in scadenza', () => {
  const items = [
    item({ id: 'a', name: 'Zucchine', expiry: '2026-11-16' }),
    item({ id: 'b', name: 'Biscotti', location: 'dispensa', expiry: '2026-11-10', expiryKind: 'tmc' }),
    item({ id: 'c', name: 'Pasta', location: 'dispensa', expiry: '2027-05-01', expiryKind: 'tmc' }),
  ];
  const base = { emoji: '🍽️', minutes: 10, difficulty: 'facile' as const, servings: 2, missing: [], steps: ['x'], why: '', tip: '', createdAt: '' };
  const use = (itemId: string, name: string) => ({ itemId, name, emoji: '🛒', amount: '' });
  const onlyExp = { ...base, id: '1', title: 'Zucchine e biscotti', uses: [use('a', 'Zucchine'), use('b', 'Biscotti')] };
  const mixed = { ...base, id: '2', title: 'Pasta e zucchine', uses: [use('a', 'Zucchine'), use('c', 'Pasta')] };
  const other = { ...base, id: '3', title: 'Pasta in bianco', uses: [use('c', 'Pasta')] };

  it('divide le ricette: solo in scadenza (anche un TMC passato), miste, altre', () => {
    expect(recipeGroup(onlyExp, items, TODAY)).toBe('scadenza');
    expect(recipeGroup(mixed, items, TODAY)).toBe('misto');
    expect(recipeGroup(other, items, TODAY)).toBe('altro');
    expect(groupRecipes([other, mixed, onlyExp], items, TODAY).map((g) => g.id)).toEqual(['scadenza', 'misto', 'altro']);
  });

  it('messaggio quando nessuna, alcune o tutte usano solo prodotti in scadenza', () => {
    expect(onlyExpiringMessage(groupRecipes([mixed, other], items, TODAY))).toContain('Non ho trovato ricette con solo prodotti in scadenza');
    expect(onlyExpiringMessage(groupRecipes([onlyExp, mixed], items, TODAY))).toBe('Una ricetta usa solo prodotti in scadenza; l’altra li usa insieme ad altri prodotti.');
    expect(onlyExpiringMessage(groupRecipes([onlyExp], items, TODAY))).toContain('Ecco le ricette con solo prodotti in scadenza');
  });

  it('richiesta con la pillola o scritta in "Altro?", e istruzioni per l’IA', () => {
    expect(wantsOnlyExpiring({ onlyExpiring: false, extra: 'Solo in scadenza' })).toBe(true);
    expect(wantsOnlyExpiring({ onlyExpiring: false, extra: 'senza forno' })).toBe(false);
    const { prompt } = buildRecipePrompt(items, TODAY, { ...DEFAULT_FILTERS, onlyExpiring: true }, { staples: [], glutenFree: false });
    expect(prompt).toContain('Usa SOLO i prodotti in scadenza');
    expect(RECIPES_SCHEMA.required).toContain('note');
    expect(parseRecipes('{"recipes":[],"note":"Con i soli prodotti in scadenza non viene niente"}', [], 2, 'now')!.note).toContain('soli prodotti');
  });
});
