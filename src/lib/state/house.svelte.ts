// Casa condivisa: stato per l'interfaccia (collegata, membri, errori) e azioni (crea, entra, esci, invita).
// Firebase si carica solo quando serve (`services/firebase.ts`); la sincronizzazione è in `services/houseSync.ts`.
import { db } from '../db';
import { UserError } from '../errors';
import {
  changeSummary,
  cleanMemberName,
  firebaseConfigProblem,
  houseErrorText,
  inviteMessage,
  makeInviteCode,
  parseFirebaseConfig,
  readInvite,
  type HouseInfo,
  type HouseMember,
  type HouseTable,
} from '../logic/house';
import { clearHouse, clearSharedData, getHouse, saveHouse, saveHouseShadow } from '../repo';
import { HouseSync, type HouseRemote } from '../services/houseSync';
import { reloadItems, reloadMeals, reloadShopping } from './app.svelte';
import { showToast } from './ui.svelte';

export type HouseStatus = 'off' | 'connecting' | 'online' | 'offline' | 'error';

export const house = $state({
  /** Il telefono fa parte di una casa. */
  joined: false,
  status: 'off' as HouseStatus,
  error: '',
  /** Il mio nome nella casa. */
  name: '',
  projectId: '',
  members: [] as HouseMember[],
  myUid: '',
  /** Modifiche del telefono in viaggio verso la casa. */
  sending: false,
});

let info: HouseInfo | null = null;
let sync: HouseSync | null = null;
let remote: HouseRemote | null = null;

const loadFirebase = () => import('../services/firebase');

function setJoined(i: HouseInfo): void {
  house.joined = true;
  house.name = i.name;
  house.projectId = i.firebase.projectId;
}

function resetState(): void {
  house.joined = false;
  house.status = 'off';
  house.error = '';
  house.name = '';
  house.projectId = '';
  house.members = [];
  house.myUid = '';
  house.sending = false;
}

/** All'apertura dell'app: se il telefono è in una casa si ricollega (senza aspettare internet). */
export async function initHouse(): Promise<void> {
  info = await getHouse(db);
  if (!info) return;
  setJoined(info);
  await connect(false);
}

async function stopSync(): Promise<void> {
  sync?.stop();
  sync = null;
  const r = remote;
  remote = null;
  await r?.close();
}

async function connect(waitServer: boolean): Promise<void> {
  if (!info) return;
  await stopSync();
  house.status = 'connecting';
  house.error = '';
  try {
    const fb = await loadFirebase();
    const r = await fb.joinHouse(info, waitServer);
    remote = r;
    await startSync(r);
  } catch (e) {
    house.status = 'error';
    house.error = houseErrorText(e);
  }
}

async function reloadTables(tables: readonly HouseTable[]): Promise<void> {
  if (tables.includes('items')) await reloadItems();
  if (tables.includes('shopping')) await reloadShopping();
  if (tables.includes('meals')) await reloadMeals();
}

function memberNames(): Map<string, string> {
  return new Map(house.members.map((m) => [m.uid, m.name]));
}

async function startSync(r: HouseRemote): Promise<void> {
  house.myUid = r.uid;
  const s = new HouseSync(db, r, {
    onApplied: async (tables, changes, initial) => {
      await reloadTables(tables);
      if (initial) return;
      const text = changeSummary(changes, memberNames());
      if (text) showToast(text, { duration: 4000 });
    },
    onMembers: (members) => {
      house.members = members;
    },
    onStatus: ({ online, sending }) => {
      house.sending = sending;
      if (house.status !== 'error') house.status = online ? 'online' : 'offline';
    },
    onError: (e) => {
      house.status = 'error';
      house.error = houseErrorText(e);
    },
  });
  sync = s;
  await s.start();
}

/** Crea la casa con la configurazione copiata dalla console di Firebase. */
export async function createSharedHouse(configText: string, name: string): Promise<void> {
  const firebase = parseFirebaseConfig(configText);
  if (!firebase) throw new UserError(firebaseConfigProblem(configText) || 'Incolla la configurazione di Firebase.');
  if (!cleanMemberName(name)) throw new UserError('Scrivi il tuo nome: lo vedono gli altri della casa.');
  await stopSync();
  house.status = 'connecting';
  try {
    const fb = await loadFirebase();
    const res = await fb.createHouse(firebase, name);
    info = res.info;
    await saveHouseShadow(db, {});
    await saveHouse(db, info);
    setJoined(info);
    remote = res.remote;
    await startSync(res.remote);
  } catch (e) {
    house.status = 'off';
    throw new UserError(houseErrorText(e));
  }
}

/** Entra in una casa con l'invito. `keepLocal`: i dati di questo telefono si aggiungono alla casa; altrimenti si tolgono. */
export async function joinSharedHouse(inviteText: string, name: string, keepLocal: boolean): Promise<void> {
  const invite = readInvite(inviteText);
  if (!invite) throw new UserError('Non trovo il codice dell’invito: incolla tutto il messaggio che hai ricevuto.');
  if (!cleanMemberName(name)) throw new UserError('Scrivi il tuo nome: lo vedono gli altri della casa.');
  const next: HouseInfo = { ...invite, name: cleanMemberName(name) };
  await stopSync();
  house.status = 'connecting';
  let r: HouseRemote;
  try {
    const fb = await loadFirebase();
    r = await fb.joinHouse(next, true);
  } catch (e) {
    house.status = 'off';
    throw new UserError(houseErrorText(e, true));
  }
  if (!keepLocal) await clearSharedData(db);
  await saveHouseShadow(db, {});
  info = next;
  await saveHouse(db, info);
  setJoined(info);
  remote = r;
  await Promise.all([reloadItems(), reloadShopping(), reloadMeals()]);
  await startSync(r);
}

/** Esce dalla casa: i dati restano sul telefono ma non si aggiornano più. */
export async function leaveSharedHouse(): Promise<void> {
  const s = sync;
  const r = remote;
  // Prima si prova a mandare le ultime modifiche (senza aspettare troppo se non c'è internet).
  if (s) await Promise.race([s.flush(), new Promise((res) => setTimeout(res, 6000))]).catch(() => undefined);
  if (r) await r.leave().catch(() => undefined);
  await stopSync();
  await clearHouse(db);
  info = null;
  resetState();
}

/** Riprova a collegarsi (dopo un errore). */
export async function retryHouse(): Promise<void> {
  await connect(true);
}

/** L'app torna in primo piano: manda quello che manca, o riprova se prima non c'era internet. */
export function resumeHouse(): void {
  if (!info) return;
  if (house.status === 'error' && /internet/.test(house.error)) void connect(false);
  else sync?.schedulePush(0);
}

/** L'invito da mandare (codice e messaggio completo). */
export function currentInvite(): { code: string; message: string } | null {
  if (!info) return null;
  const code = makeInviteCode(info);
  return { code, message: inviteMessage(code, info.name) };
}
