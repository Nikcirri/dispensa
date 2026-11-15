// Conoscenze di base sui cibi (senza internet): icona, dove si tiene, quanto dura chiuso e una volta aperto.
// Servono quando si scrive un prodotto a mano, dopo il codice a barre e per la lista della spesa.
import type { ExpiryKind, Location, Unit } from '../types';
import { normalize } from './text';

export interface FoodGuess {
  emoji: string;
  location: Location;
  /** Giorni che dura di solito da quando lo compri (null = non si sa). */
  shelfDays: number | null;
  /** Giorni entro cui consumarlo una volta aperto (null = non cambia). */
  openDays: number | null;
  kind: ExpiryKind;
}

interface Rule extends FoodGuess {
  re: RegExp;
}

const r = (re: RegExp, emoji: string, location: Location, shelfDays: number | null, openDays: number | null, kind: ExpiryKind = 'scadenza'): Rule => ({
  re,
  emoji,
  location,
  shelfDays,
  openDays,
  kind,
});

/** Regole in ordine: vince la prima che corrisponde (le più precise prima). Il nome è già normalizzato. */
const RULES: Rule[] = [
  // Surgelati
  r(/surgelat|congelat|frozen|bastoncin|sofficin|\bfindus\b/, '🧊', 'freezer', 180, 1, 'tmc'),
  r(/gelat|ghiacciol/, '🍨', 'freezer', 240, null, 'tmc'),
  // Latte e latticini (i formaggi freschi prima del latte: "fior di latte" è una mozzarella)
  r(/mozzarell|burrata|stracciatell|ricott|fior di latte|bufala/, '🧀', 'frigo', 7, 2),
  r(/latte.*(uht|lunga conservazione)|\buht\b/, '🥛', 'dispensa', 90, 4, 'tmc'),
  r(/latte di (soia|riso|avena|mandorl)|bevanda (di|alla|vegetale)/, '🥛', 'dispensa', 180, 5, 'tmc'),
  r(/\blatte\b/, '🥛', 'frigo', 6, 3),
  r(/yogurt|yogourt|skyr|kefir/, '🥣', 'frigo', 21, 2),
  r(/mascarpone|panna|besciamell/, '🥛', 'frigo', 14, 3),
  r(/\bburro\b/, '🧈', 'frigo', 60, 30, 'tmc'),
  r(/parmigian|grana|pecorino|stagionat/, '🧀', 'frigo', 90, 30, 'tmc'),
  r(/formagg|stracchino|crescenz|gorgonzola|scamorz|provol|fontina|emmental|asiago|brie|philadelphia|spalmabile|caciott|taleggio|robiola|feta|squacquerone/, '🧀', 'frigo', 20, 7),
  r(/\buov[ao]\b|\buova\b/, '🥚', 'frigo', 28, null, 'tmc'),
  // Salumi, carne, pesce
  r(/prosciutto|salame|mortadell|bresaola|speck|salum|affettat|\bcoppa\b|pancett|guancial|wurstel|wuerstel|cotto/, '🥓', 'frigo', 10, 4),
  r(/tonno|sgombro|sardin|acciugh|alici|salmone affumicat/, '🐟', 'dispensa', 900, 2, 'tmc'),
  r(/pollo|tacchino|petto|cosce|ali di|alette/, '🍗', 'frigo', 3, 1),
  r(/manzo|vitello|maiale|carne|macinat|hamburger|bistecc|salsicc|fettin|cotolett|spezzatin|arrosto|lonza|agnello|polpett/, '🥩', 'frigo', 3, 1),
  r(/salmone|pesce|merluzz|orata|branzin|gamber|cozze|vongol|calamar|polpo|seppi|trota|baccala|platessa|nasello/, '🐟', 'frigo', 2, 1),
  // Pasta fresca e piatti pronti
  r(/pasta fresca|tortellin|ravioli|cappellett|agnolott|gnocch|tagliatelle fresche|lasagne fresche|pasta all uovo fresca/, '🥟', 'frigo', 20, 2),
  r(/piadin|tortill|wrap/, '🫓', 'dispensa', 60, 5, 'tmc'),
  r(/pizza|insalata pronta|piatto pronto|zuppa pronta|minestron|vellutat/, '🍲', 'frigo', 5, 2),
  // Pane e forno
  r(/pancarre|bauletto|pane in cassetta|pan carre|tramezzin/, '🍞', 'dispensa', 20, 7, 'tmc'),
  r(/fette biscottate|cracker|grissin|tarall|gallette|crostin/, '🥨', 'dispensa', 180, 20, 'tmc'),
  r(/\bpane\b|panin|baguette|focacc|rosetta|ciabatta|filone/, '🍞', 'dispensa', 3, null),
  r(/biscott|frollin|wafer|merendin|cornett|brioche|croissant|plumcake|torta|crostat|pandoro|panettone/, '🍪', 'dispensa', 120, 20, 'tmc'),
  r(/cioccolat|nutella|crema spalmabile|cacao/, '🍫', 'dispensa', 240, 60, 'tmc'),
  r(/cereali|muesli|corn ?flakes|fiocchi d avena|granola/, '🥣', 'dispensa', 240, 60, 'tmc'),
  // Dispensa secca
  r(/spaghett|penne|fusill|rigaton|maccheron|farfall|linguin|bucatin|orecchiett|paccheri|mezze maniche|ditalin|\bpasta\b|tagliatell|lasagn|vermicell/, '🍝', 'dispensa', 540, null, 'tmc'),
  r(/\briso\b|risotto|basmati|carnaroli|arborio|farro|\borzo\b|quinoa|cous ?cous|bulgur|polenta/, '🍚', 'dispensa', 540, null, 'tmc'),
  r(/farina|lievito|pangrattato|semola|fecola|amido/, '🌾', 'dispensa', 300, 90, 'tmc'),
  r(/zucchero|miele|marmellat|confettur/, '🍯', 'dispensa', 540, 60, 'tmc'),
  r(/\bsale\b|pepe|spezi|origano|curry|paprika|cannella|noce moscata|dado|brodo granulare/, '🧂', 'dispensa', 720, null, 'tmc'),
  r(/\bolio\b|aceto/, '🫒', 'dispensa', 540, 180, 'tmc'),
  r(/passata|pelati|polpa di pomodor|concentrato di pomodor|sugo|ragu/, '🥫', 'dispensa', 540, 4, 'tmc'),
  r(/\bpesto\b/, '🌿', 'frigo', 30, 5),
  r(/maionese|ketchup|senape|salsa|hummus|guacamole/, '🫙', 'frigo', 120, 30, 'tmc'),
  r(/fagiol|ceci|lenticch|legum|piselli in scatola|borlott|cannellin/, '🫘', 'dispensa', 720, 3, 'tmc'),
  r(/mais|olive|capperi|sottaceti|sottolio|carciofini|funghi trifolati/, '🫙', 'dispensa', 540, 10, 'tmc'),
  r(/frutta secca|noci|mandorl|nocciol|pistacch|arachid|anacard|uvetta/, '🥜', 'dispensa', 240, 60, 'tmc'),
  r(/patatine|chips|popcorn|snack/, '🍿', 'dispensa', 120, 5, 'tmc'),
  // Bevande
  r(/caffe|\bte\b|\bthe\b|tisan|camomill|infuso/, '☕', 'dispensa', 365, 60, 'tmc'),
  r(/succo|spremut|nettare|aranciata|cola|bibita|tonica|gassosa|chinotto/, '🧃', 'dispensa', 270, 4, 'tmc'),
  r(/\bacqua\b/, '💧', 'dispensa', 365, 3, 'tmc'),
  r(/birra/, '🍺', 'dispensa', 270, 1, 'tmc'),
  r(/vino|prosecco|spumante/, '🍷', 'dispensa', 720, 4, 'tmc'),
  // Frutta
  r(/fragol|lampon|mirtill|more\b|ciliegi/, '🍓', 'frigo', 3, null),
  r(/banan/, '🍌', 'dispensa', 5, null),
  r(/\bmel[ae]\b|mele/, '🍎', 'frigo', 21, null),
  r(/\bper[ae]\b|pere/, '🍐', 'frigo', 7, null),
  r(/aranc|mandarin|clementin|pompelm/, '🍊', 'frigo', 14, null),
  r(/limon|lime/, '🍋', 'frigo', 21, null),
  r(/\buva\b/, '🍇', 'frigo', 5, null),
  r(/kiwi/, '🥝', 'frigo', 14, null),
  r(/pesc[ah]e?\b|albicocc|nettarin|susin|prugn/, '🍑', 'frigo', 4, null),
  r(/avocado/, '🥑', 'dispensa', 4, 1),
  r(/ananas|mango|papaya/, '🍍', 'dispensa', 5, 2),
  r(/melone|anguria|cocomero/, '🍉', 'frigo', 7, 3),
  // Verdura
  r(/insalat|lattug|rucola|spinac|valerian|songino|radicchi|indivia|scarola|bietol|cavolo nero/, '🥬', 'frigo', 4, null),
  r(/pomodor|ciliegin|datterin/, '🍅', 'frigo', 6, null),
  r(/zucchin|cetriol/, '🥒', 'frigo', 6, null),
  r(/melanzan/, '🍆', 'frigo', 6, null),
  r(/peperon/, '🫑', 'frigo', 7, null),
  r(/carot/, '🥕', 'frigo', 21, null),
  r(/patat/, '🥔', 'dispensa', 30, null),
  r(/cipoll|scalogn|porro/, '🧅', 'dispensa', 30, null),
  r(/aglio/, '🧄', 'dispensa', 60, null),
  r(/broccol|cavolfior|cavol|verza|cavoletti/, '🥦', 'frigo', 6, null),
  r(/funghi|champignon|porcini/, '🍄', 'frigo', 4, null),
  r(/zucca/, '🎃', 'dispensa', 30, 5),
  r(/basilic|prezzemol|rosmarin|salvia|menta|erba cipollina|aromi/, '🌿', 'frigo', 5, null),
  r(/finocch|sedano|asparag|fagiolin|carciof|piselli|cicori|verdur/, '🥗', 'frigo', 7, null),
];

const DEFAULT: FoodGuess = { emoji: '🛒', location: 'dispensa', shelfDays: null, openDays: null, kind: 'scadenza' };

/** Indovina icona, posto e durata dal nome del prodotto. */
export function guessFood(name: string): FoodGuess {
  const n = normalize(name);
  if (!n) return { ...DEFAULT };
  const rule = RULES.find((x) => x.re.test(n));
  if (!rule) return { ...DEFAULT };
  const { re: _re, ...guess } = rule;
  return guess;
}

/** Vero se la regola ha riconosciuto qualcosa (non è l'icona di riserva). */
export function isKnownFood(name: string): boolean {
  const n = normalize(name);
  return !!n && RULES.some((x) => x.re.test(n));
}

// ---------- Quantità ----------

export const UNITS: { id: Unit; label: string }[] = [
  { id: 'pz', label: 'pezzi' },
  { id: 'conf', label: 'confezioni' },
  { id: 'g', label: 'grammi' },
  { id: 'kg', label: 'kg' },
  { id: 'ml', label: 'ml' },
  { id: 'l', label: 'litri' },
];

export function isUnit(v: unknown): v is Unit {
  return v === 'pz' || v === 'conf' || v === 'g' || v === 'kg' || v === 'ml' || v === 'l';
}

/** Passo dei pulsanti + e −. */
export function quantityStep(unit: Unit, quantity: number): number {
  switch (unit) {
    case 'g':
    case 'ml':
      return quantity > 200 ? 50 : 10;
    case 'kg':
    case 'l':
      return 0.25;
    default:
      return 1;
  }
}

/** Arrotonda per non mostrare 0.30000000000000004. */
export function roundQuantity(q: number): number {
  return Math.round(q * 100) / 100;
}

/** "2 pz", "1 conf.", "500 g", "1,5 l". */
export function formatQuantity(quantity: number, unit: Unit): string {
  const n = roundQuantity(quantity).toLocaleString('it-IT', { maximumFractionDigits: 2 });
  const u = unit === 'conf' ? 'conf.' : unit;
  return `${n} ${u}`;
}

/** Quantità iniziale ragionevole per un'unità. */
export function defaultQuantity(unit: Unit): number {
  if (unit === 'g' || unit === 'ml') return 500;
  return 1;
}
