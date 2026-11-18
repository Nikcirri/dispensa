// Collegamento alla casa condivisa con Firebase (il progetto gratuito dell'utente): accesso anonimo + Firestore.
// Si carica solo se il telefono è in una casa (o ne sta creando una): chi non la usa non scarica niente di Firebase.
// Struttura su Firestore (regole in firestore.rules):
//   houses/{casa}                 { code, owner, createdAt }
//   houses/{casa}/members/{uid}   { code, name, seenAt }  ← si entra solo conoscendo il codice dell'invito
//   houses/{casa}/{tabella}/{id}  { json, by, at }        ← items, shopping, meals
import { deleteApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, indexedDBLocalPersistence, initializeAuth, signInAnonymously } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  setDoc,
  terminate,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { cleanMemberName, isEmulatorProject, randomCode, type FirebaseSettings, type HouseInfo, type HouseMember, type HouseTable, type RemoteDoc } from '../logic/house';
import type { HouseRemote } from './houseSync';

const APP_NAME = 'dispensa-casa';
const EMULATOR_HOST = '127.0.0.1';
/** Operazioni per ogni scrittura (Firestore ne accetta al massimo 500). */
const BATCH_SIZE = 400;
const CONNECT_TIMEOUT_MS = 25_000;

interface Opened {
  app: FirebaseApp;
  fs: Firestore;
  uid: string;
}

function withTimeout<T>(p: Promise<T>, ms = CONNECT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Apre Firebase e fa l'accesso anonimo (lo stesso "utente" resta finché non si cancellano i dati dell'app). */
async function open(settings: FirebaseSettings): Promise<Opened> {
  for (const old of getApps()) if (old.name === APP_NAME) await deleteApp(old);
  const app = initializeApp(
    { apiKey: settings.apiKey, authDomain: settings.authDomain, projectId: settings.projectId, ...(settings.appId ? { appId: settings.appId } : {}) },
    APP_NAME,
  );
  try {
    // initializeAuth senza la parte dei popup: nell'app Android il popup non serve e farebbe aspettare.
    const auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
    const emulator = isEmulatorProject(settings.projectId);
    if (emulator) connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
    await auth.authStateReady();
    const user = auth.currentUser ?? (await withTimeout(signInAnonymously(auth))).user;
    const fs = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
    if (emulator) connectFirestoreEmulator(fs, EMULATOR_HOST, 8080);
    return { app, fs, uid: user.uid };
  } catch (e) {
    await deleteApp(app).catch(() => undefined);
    throw e;
  }
}

function remoteFor(o: Opened, houseId: string): HouseRemote {
  const { fs, uid } = o;
  const houseRef = doc(fs, 'houses', houseId);
  let closed = false;
  return {
    uid,
    listenData(table: HouseTable, onDocs, onError) {
      return onSnapshot(
        collection(houseRef, table),
        { includeMetadataChanges: true },
        (snap) => {
          const docs: RemoteDoc[] = snap.docs.map((d) => {
            const v = d.data() as { json?: unknown; by?: unknown; at?: unknown };
            return { id: d.id, json: typeof v.json === 'string' ? v.json : '', by: typeof v.by === 'string' ? v.by : '', at: typeof v.at === 'number' ? v.at : 0 };
          });
          onDocs(docs, !snap.metadata.fromCache);
        },
        onError,
      );
    },
    listenMembers(onMembers, onError) {
      return onSnapshot(
        collection(houseRef, 'members'),
        (snap) => {
          onMembers(
            snap.docs.map((d) => {
              const v = d.data() as { name?: unknown; seenAt?: unknown };
              return { uid: d.id, name: typeof v.name === 'string' ? v.name : '', seenAt: typeof v.seenAt === 'number' ? v.seenAt : 0 } satisfies HouseMember;
            }),
          );
        },
        onError,
      );
    },
    async write(puts, deletes) {
      const ops = [...puts.map((p) => ({ kind: 'put' as const, ...p })), ...deletes.map((d) => ({ kind: 'del' as const, ...d, json: '' }))];
      for (let i = 0; i < ops.length; i += BATCH_SIZE) {
        const batch = writeBatch(fs);
        for (const op of ops.slice(i, i + BATCH_SIZE)) {
          const ref = doc(houseRef, op.table, op.id);
          if (op.kind === 'put') batch.set(ref, { json: op.json, by: uid, at: Date.now() });
          else batch.delete(ref);
        }
        await batch.commit();
      }
    },
    async leave() {
      await withTimeout(deleteDoc(doc(houseRef, 'members', uid)));
    },
    async close() {
      if (closed) return;
      closed = true;
      await terminate(fs).catch(() => undefined);
      await deleteApp(o.app).catch(() => undefined);
    },
  };
}

/** Si segna (o si risegna) come membro della casa: serve il codice dell'invito. */
function markMember(o: Opened, info: Pick<HouseInfo, 'houseId' | 'code' | 'name'>): Promise<void> {
  return setDoc(doc(o.fs, 'houses', info.houseId, 'members', o.uid), { code: info.code, name: cleanMemberName(info.name), seenAt: Date.now() });
}

/** Crea una casa nuova nel progetto Firebase dell'utente. */
export async function createHouse(firebase: FirebaseSettings, name: string): Promise<{ info: HouseInfo; remote: HouseRemote }> {
  const o = await open(firebase);
  try {
    const info: HouseInfo = { firebase, houseId: randomCode(20), code: randomCode(24), name: cleanMemberName(name) };
    await withTimeout(setDoc(doc(o.fs, 'houses', info.houseId), { code: info.code, owner: o.uid, createdAt: Date.now() }));
    await withTimeout(markMember(o, info));
    return { info, remote: remoteFor(o, info.houseId) };
  } catch (e) {
    await terminate(o.fs).catch(() => undefined);
    await deleteApp(o.app).catch(() => undefined);
    throw e;
  }
}

/** Entra in una casa con l'invito (o ci si ricollega all'apertura dell'app con `waitServer` falso). */
export async function joinHouse(info: HouseInfo, waitServer = true): Promise<HouseRemote> {
  const o = await open(info.firebase);
  try {
    if (waitServer) {
      await withTimeout(markMember(o, info));
      // Controlla davvero di poter leggere la casa (codice giusto, regole pubblicate).
      const snap = await withTimeout(getDoc(doc(o.fs, 'houses', info.houseId)));
      if (!snap.exists()) throw Object.assign(new Error('casa non trovata'), { code: 'permission-denied' });
    } else {
      // All'apertura dell'app non si aspetta il server (potrebbe non esserci internet): la conferma arriva dopo.
      void markMember(o, info).catch(() => undefined);
    }
    return remoteFor(o, info.houseId);
  } catch (e) {
    await terminate(o.fs).catch(() => undefined);
    await deleteApp(o.app).catch(() => undefined);
    throw e;
  }
}
