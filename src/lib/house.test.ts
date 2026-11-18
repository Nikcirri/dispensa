import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PantryDB } from './db';
import { draftFromName, itemFromDraft } from './logic/drafts';
import {
  changeSummary,
  firebaseConfigProblem,
  HOUSE_TABLES,
  houseErrorText,
  inviteMessage,
  makeInviteCode,
  parseFirebaseConfig,
  planApply,
  planPush,
  randomCode,
  readInvite,
  recordHash,
  type AppliedChange,
  type HouseMember,
  type HouseTable,
  type RemoteDoc,
} from './logic/house';
import { mealFromText } from './logic/meals';
import { addShopping, allItems, allShopping, clearSharedData, getHouseShadow, saveHouse, getHouse } from './repo';
import { HouseSync, type HouseRemote } from './services/houseSync';
import type { Item } from './types';

const TODAY = '2026-11-18';

const CONSOLE_SNIPPET = `// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
const firebaseConfig = {
  apiKey: "AIzaSyD-abcdefghijklmnopqrstuvwxyz012345",
  authDomain: "dispensa-casa-3f2a1.firebaseapp.com",
  projectId: "dispensa-casa-3f2a1",
  storageBucket: "dispensa-casa-3f2a1.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef0123456789abcdef"
};`;

describe('casa condivisa: configurazione e invito', () => {
  it('legge la configurazione copiata dalla console di Firebase (anche come JSON)', () => {
    const c = parseFirebaseConfig(CONSOLE_SNIPPET)!;
    expect(c).toEqual({
      apiKey: 'AIzaSyD-abcdefghijklmnopqrstuvwxyz012345',
      authDomain: 'dispensa-casa-3f2a1.firebaseapp.com',
      projectId: 'dispensa-casa-3f2a1',
      appId: '1:123456789012:web:abcdef0123456789abcdef',
    });
    expect(parseFirebaseConfig(JSON.stringify({ apiKey: c.apiKey, projectId: c.projectId }))?.authDomain).toBe('dispensa-casa-3f2a1.firebaseapp.com');
    expect(parseFirebaseConfig('ciao')).toBeNull();
    expect(firebaseConfigProblem('ciao')).toContain('const firebaseConfig');
    expect(firebaseConfigProblem(CONSOLE_SNIPPET.replace('apiKey: "AIzaSyD-abcdefghijklmnopqrstuvwxyz012345",', ''))).toContain('apiKey');
    expect(firebaseConfigProblem(CONSOLE_SNIPPET)).toBe('');
  });

  it('l’invito si legge anche da tutto il messaggio di WhatsApp; uno rovinato no', () => {
    const firebase = parseFirebaseConfig(CONSOLE_SNIPPET)!;
    const houseId = randomCode(20);
    const code = randomCode(24);
    expect(houseId).toMatch(/^[A-Za-z0-9]{20}$/);
    const invite = makeInviteCode({ firebase, houseId, code });
    const msg = inviteMessage(invite, 'Nicola');
    expect(msg).toContain('Nicola ti invita');
    expect(msg).toContain('github.com/Nikcirri/dispensa/releases/latest');
    expect(readInvite(`[18/11, 16:20] Nicola: ${msg}`)).toEqual({ firebase, houseId, code });
    expect(readInvite(invite.slice(0, 30))).toBeNull();
    expect(readInvite('DSP1.' + 'x'.repeat(60))).toBeNull();
  });

  it('errori di Firebase in parole semplici', () => {
    expect(houseErrorText({ code: 'auth/operation-not-allowed', message: '' })).toContain('Anonimo');
    expect(houseErrorText({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }, true)).toContain('Invito non valido');
    expect(houseErrorText({ code: 'permission-denied', message: '' })).toContain('regole');
    expect(houseErrorText(new Error('The database (default) does not exist for project x'))).toContain('Firestore Database');
  });
});

async function shop(db: PantryDB, ...names: string[]) {
  for (const n of names) await addShopping(db, n);
}

const item = (name: string, at = `${TODAY}T08:00:00.000Z`): Item => itemFromDraft(draftFromName(name, TODAY), at);

describe('casa condivisa: cosa mandare e cosa ricevere', () => {
  it('manda solo i record nuovi o cambiati e quelli tolti', () => {
    const a = item('Latte');
    const b = item('Uova');
    const first = planPush('items', [a, b], {});
    expect(first.puts.map((p) => p.id)).toEqual([a.id, b.id]);
    const shadow = Object.fromEntries(first.puts.map((p) => [`items/${p.id}`, p.hash]));
    expect(planPush('items', [a, b], shadow)).toEqual({ puts: [], deletes: [] });
    const changed = planPush('items', [{ ...a, quantity: 3 } as Item], shadow);
    expect(changed.puts.map((p) => p.id)).toEqual([a.id]);
    expect(changed.deletes).toEqual([{ table: 'items', id: b.id }]);
  });

  it('una modifica del telefono non ancora mandata vince; una cancellazione dalla casa toglie il record', () => {
    const a = item('Latte');
    const b = item('Uova');
    const shadow = { [`items/${a.id}`]: recordHash(a), [`items/${b.id}`]: recordHash(b) };
    const remoteA: RemoteDoc = { id: a.id, json: JSON.stringify({ ...a, quantity: 5 }), by: 'mamma', at: 1 };
    // Sul telefono A non è cambiato: si prende la versione della casa. B non c'è più nella casa: si toglie.
    const p1 = planApply('items', [remoteA], true, [a, b], shadow, (v) => v as Item);
    expect(p1.puts.map((p) => p.record.quantity)).toEqual([5]);
    expect(p1.deletes).toEqual([b.id]);
    // Ma se sul telefono A è cambiato (e non è ancora partito) resta quello del telefono.
    const p2 = planApply('items', [remoteA], true, [{ ...a, quantity: 2 }, b], shadow, (v) => v as Item);
    expect(p2.puts).toEqual([]);
    // Elenco non dal server (offline): niente cancellazioni.
    expect(planApply('items', [remoteA], false, [a, b], shadow, (v) => v as Item).deletes).toEqual([]);
  });

  it('messaggio quando un altro della casa aggiunge qualcosa', () => {
    const names = new Map([['m', 'Mamma']]);
    const c: AppliedChange[] = [{ table: 'shopping', added: [{ name: 'Latte', by: 'm' }], changed: 0, removed: 0 }];
    expect(changeSummary(c, names)).toBe('🏠 Mamma ha aggiunto Latte alla spesa');
    expect(changeSummary([{ table: 'items', added: [], changed: 2, removed: 0 }], names)).toBe('🏠 Dispensa aggiornata');
    expect(changeSummary([], names)).toBe('');
  });
});

// ---------- Due telefoni e un server finto ----------

type Listener = { table: HouseTable; cb: (docs: RemoteDoc[], authoritative: boolean) => void };

class FakeServer {
  docs = new Map<string, RemoteDoc>();
  members = new Map<string, HouseMember>();
  listeners = new Set<Listener>();
  memberListeners = new Set<(m: HouseMember[]) => void>();
  online = true;
  private waiting: (() => void)[] = [];

  list(table: HouseTable): RemoteDoc[] {
    return [...this.docs.entries()].filter(([k]) => k.startsWith(`${table}/`)).map(([, d]) => d);
  }

  notify(tables: Iterable<HouseTable>) {
    for (const t of new Set(tables)) for (const l of this.listeners) if (l.table === t) l.cb(this.list(t), true);
  }

  async write(uid: string, puts: readonly { table: HouseTable; id: string; json: string }[], deletes: readonly { table: HouseTable; id: string }[]) {
    if (!this.online) await new Promise<void>((r) => this.waiting.push(r));
    for (const p of puts) this.docs.set(`${p.table}/${p.id}`, { id: p.id, json: p.json, by: uid, at: Date.now() });
    for (const d of deletes) this.docs.delete(`${d.table}/${d.id}`);
    this.notify([...puts.map((p) => p.table), ...deletes.map((d) => d.table)]);
  }

  goOnline() {
    this.online = true;
    for (const r of this.waiting.splice(0)) r();
  }

  remote(uid: string, name: string): HouseRemote {
    const server = this;
    server.members.set(uid, { uid, name, seenAt: 1 });
    return {
      uid,
      listenData(table, cb) {
        const l: Listener = { table, cb };
        server.listeners.add(l);
        setTimeout(() => cb(server.list(table), true), 0);
        return () => server.listeners.delete(l);
      },
      listenMembers(cb) {
        server.memberListeners.add(cb);
        cb([...server.members.values()]);
        return () => server.memberListeners.delete(cb);
      },
      write: (puts, deletes) => server.write(uid, puts, deletes),
      async leave() {
        server.members.delete(uid);
      },
      async close() {},
    };
  }
}

interface Phone {
  db: PantryDB;
  sync: HouseSync;
  applied: { tables: HouseTable[]; changes: AppliedChange[]; initial: boolean }[];
}

const phones: Phone[] = [];

async function phone(server: FakeServer, uid: string, name: string): Promise<Phone> {
  const db = new PantryDB(`casa-${uid}-${Math.random()}`);
  await db.open();
  const applied: Phone['applied'] = [];
  const sync = new HouseSync(
    db,
    server.remote(uid, name),
    {
      onApplied: (tables, changes, initial) => void applied.push({ tables, changes, initial }),
      onMembers: () => undefined,
      onStatus: () => undefined,
      onError: (e) => {
        throw e;
      },
    },
    5,
  );
  const p = { db, sync, applied };
  phones.push(p);
  return p;
}

/** Aspetta che i telefoni abbiano finito di mandare e ricevere. */
async function settle(...ps: Phone[]) {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 20));
    for (const p of ps) await p.sync.flush();
  }
}

afterEach(() => {
  for (const p of phones.splice(0)) p.sync.stop();
});

describe('casa condivisa: due telefoni', () => {
  it('quello che aggiunge uno compare sull’altro, anche le cancellazioni e i pasti', async () => {
    const server = new FakeServer();
    const io = await phone(server, 'nicola', 'Nicola');
    await io.db.items.bulkPut([item('Latte'), item('Uova')]);
    await io.sync.start();
    await settle(io);
    expect(server.list('items')).toHaveLength(2);

    const mamma = await phone(server, 'mamma', 'Mamma');
    await mamma.sync.start();
    await settle(io, mamma);
    expect((await allItems(mamma.db)).map((i) => i.name).sort()).toEqual(['Latte', 'Uova']);
    // Il primo arrivo non fa comparire avvisi ("Mamma ha aggiunto…").
    expect(mamma.applied.every((a) => a.initial)).toBe(true);

    // Mamma aggiunge il pane alla spesa: lo vedo anch'io, con il suo nome.
    await shop(mamma.db, 'pane');
    await settle(io, mamma);
    expect((await allShopping(io.db)).map((s) => s.name)).toEqual(['Pane']);
    const last = io.applied.at(-1)!;
    expect(last.initial).toBe(false);
    expect(changeSummary(last.changes, new Map([['mamma', 'Mamma']]))).toBe('🏠 Mamma ha aggiunto Pane alla spesa');

    // Io finisco il latte (tolto dalla dispensa): sparisce anche da lei.
    const latte = (await allItems(io.db)).find((i) => i.name === 'Latte')!;
    await io.db.items.delete(latte.id);
    await settle(io, mamma);
    expect((await allItems(mamma.db)).map((i) => i.name)).toEqual(['Uova']);

    // Lei cambia la quantità delle uova; io metto un pasto nel piano.
    const uova = (await allItems(mamma.db))[0]!;
    await mamma.db.items.update(uova.id, { quantity: 6 });
    await io.db.meals.put(mealFromText('Frittata', '2026-11-19', 'cena', `${TODAY}T09:00:00.000Z`));
    await settle(io, mamma);
    expect((await allItems(io.db))[0]!.quantity).toBe(6);
    expect((await mamma.db.meals.toArray()).map((m) => m.title)).toEqual(['Frittata']);
    // Le ricette salvate e la chiave di Gemini non si condividono.
    expect(HOUSE_TABLES).not.toContain('recipes');
  });

  it('senza internet le modifiche aspettano e partono dopo; quelle fatte offline non si perdono', async () => {
    const server = new FakeServer();
    const io = await phone(server, 'nicola', 'Nicola');
    const mamma = await phone(server, 'mamma', 'Mamma');
    await io.sync.start();
    await mamma.sync.start();
    await settle(io, mamma);

    server.online = false;
    await shop(io.db, 'caffè');
    await new Promise((r) => setTimeout(r, 40));
    expect(server.list('shopping')).toHaveLength(0);
    server.goOnline();
    await settle(io, mamma);
    expect((await allShopping(mamma.db)).map((s) => s.name)).toEqual(['Caffè']);
    // Lo stato condiviso è uguale sui due telefoni: niente da mandare.
    expect(await getHouseShadow(io.db)).toEqual(await getHouseShadow(mamma.db));
  });

  it('cancellato nella casa mentre il telefono era spento: alla riapertura si toglie anche qui', async () => {
    const server = new FakeServer();
    const io = await phone(server, 'nicola', 'Nicola');
    const mamma = await phone(server, 'mamma', 'Mamma');
    await shop(io.db, 'zucchero', 'farina');
    await io.sync.start();
    await mamma.sync.start();
    await settle(io, mamma);
    io.sync.stop();
    // Mentre io sono "spento" lei toglie lo zucchero.
    const zucchero = (await allShopping(mamma.db)).find((s) => s.name === 'Zucchero')!;
    await mamma.db.shopping.delete(zucchero.id);
    await settle(mamma);
    // Riapro l'app.
    const again = new HouseSync(io.db, server.remote('nicola', 'Nicola'), { onApplied: () => undefined, onMembers: () => undefined, onStatus: () => undefined, onError: (e) => { throw e; } }, 5);
    phones.push({ db: io.db, sync: again, applied: [] });
    await again.start();
    await settle({ db: io.db, sync: again, applied: [] }, mamma);
    expect((await allShopping(io.db)).map((s) => s.name)).toEqual(['Farina']);
  });

  it('entrando in una casa si possono tenere solo i dati della casa; la casa resta salvata fuori dai backup', async () => {
    const db = new PantryDB(`casa-solo-${Math.random()}`);
    await db.open();
    await shop(db, 'sale');
    await clearSharedData(db);
    expect(await allShopping(db)).toEqual([]);
    const firebase = parseFirebaseConfig(CONSOLE_SNIPPET)!;
    await saveHouse(db, { firebase, houseId: 'abcdefghijklmnopqrst', code: 'abcdefghijklmnopqrstuvwx', name: 'Mamma' });
    expect((await getHouse(db))?.name).toBe('Mamma');
  });
});
