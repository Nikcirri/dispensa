// Casa condivisa: tiene in pari i dati del telefono (Dexie) con quelli della casa (Firebase, o un finto "remoto" nei test).
// Il telefono resta la fonte dei dati per l'app: questa parte manda le modifiche fatte qui e scrive quelle arrivate dagli altri.
// Funziona anche senza internet: lo "stato condiviso" (impronte dell'ultima versione uguale) dice cosa manca da mandare.
import Dexie from 'dexie';
import type { PantryDB } from '../db';
import { sanitizeItem, sanitizeShopping } from '../logic/backup';
import {
  HOUSE_TABLES,
  planApply,
  planPush,
  type AppliedChange,
  type HouseMember,
  type HouseTable,
  type RemoteDoc,
  type Shadow,
} from '../logic/house';
import { sanitizeMeal } from '../logic/meals';
import { getHouseShadow, saveHouseShadow } from '../repo';

/** Il collegamento con la casa (Firebase nell'app, un finto in memoria nei test). */
export interface HouseRemote {
  readonly uid: string;
  /** Ogni volta l'elenco completo dei documenti; `authoritative` se arriva dal server (non dalla memoria, ad esempio offline). */
  listenData(table: HouseTable, onDocs: (docs: RemoteDoc[], authoritative: boolean) => void, onError: (e: unknown) => void): () => void;
  listenMembers(onMembers: (members: HouseMember[]) => void, onError: (e: unknown) => void): () => void;
  /** Scrive e cancella (si risolve quando il server ha ricevuto tutto). */
  write(puts: readonly { table: HouseTable; id: string; json: string }[], deletes: readonly { table: HouseTable; id: string }[]): Promise<void>;
  /** Esce dalla casa (toglie questo telefono dai membri). */
  leave(): Promise<void>;
  /** Chiude il collegamento. */
  close(): Promise<void>;
}

export interface SyncHooks {
  /** Sono arrivate modifiche dalla casa e sono già sul telefono: l'app ricarica le tabelle cambiate. */
  onApplied(tables: HouseTable[], changes: AppliedChange[], initial: boolean): void | Promise<void>;
  onMembers(members: HouseMember[]): void;
  /** `online`: collegato al server; `sending`: modifiche del telefono in viaggio. */
  onStatus(status: { online: boolean; sending: boolean }): void;
  onError(e: unknown): void;
}

const SANITIZE: Record<HouseTable, (v: unknown) => { id: string } | null> = {
  items: sanitizeItem,
  shopping: sanitizeShopping,
  meals: sanitizeMeal,
};

/** Nome da mostrare nel messaggio "Mamma ha aggiunto …". */
function displayName(table: HouseTable, record: { id: string }): string {
  const r = record as { name?: unknown; title?: unknown };
  const name = table === 'meals' ? r.title : r.name;
  return typeof name === 'string' ? name : '';
}

export class HouseSync {
  private shadow: Shadow = {};
  private queue: Promise<void> = Promise.resolve();
  private pendingDocs = new Map<HouseTable, { docs: RemoteDoc[]; authoritative: boolean }>();
  private draining = false;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pushQueued = false;
  private stops: (() => void)[] = [];
  private started = false;
  private sending = false;
  private online = new Map<HouseTable, boolean>();
  private firstApply = new Set<HouseTable>(HOUSE_TABLES);
  private readonly onMutated = (parts: Record<string, unknown>) => {
    const prefix = `idb://${this.db.name}/`;
    if (Object.keys(parts).some((p) => HOUSE_TABLES.some((t) => p.startsWith(`${prefix}${t}/`)))) this.schedulePush();
  };

  constructor(
    private readonly db: PantryDB,
    private readonly remote: HouseRemote,
    private readonly hooks: SyncHooks,
    private readonly pushDelayMs = 900,
  ) {}

  get uid(): string {
    return this.remote.uid;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.shadow = await getHouseShadow(this.db);
    Dexie.on.storagemutated.subscribe(this.onMutated);
    this.stops.push(() => Dexie.on.storagemutated.unsubscribe(this.onMutated));
    for (const table of HOUSE_TABLES) {
      this.stops.push(
        this.remote.listenData(
          table,
          (docs, authoritative) => this.receive(table, docs, authoritative),
          (e) => this.hooks.onError(e),
        ),
      );
    }
    this.stops.push(this.remote.listenMembers((m) => this.hooks.onMembers(m), (e) => this.hooks.onError(e)));
    this.schedulePush(0);
  }

  /** Ferma tutto (il collegamento si chiude a parte, con `remote.close()`). */
  stop(): void {
    this.started = false;
    clearTimeout(this.pushTimer);
    for (const s of this.stops.splice(0)) s();
  }

  /** Manda le modifiche del telefono poco dopo l'ultima (più modifiche vicine partono insieme). */
  schedulePush(delay = this.pushDelayMs): void {
    if (!this.started) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      if (this.pushQueued) return;
      this.pushQueued = true;
      void this.enqueue(async () => {
        this.pushQueued = false;
        await this.push();
      });
    }, delay);
  }

  /** Aspetta che tutto quello che è in coda sia finito (serve ai test e all'uscita dalla casa). */
  async idle(): Promise<void> {
    let last: Promise<void> | null = null;
    while (last !== this.queue) {
      last = this.queue;
      await last;
    }
  }

  /** Manda subito tutto quello che manca (prima di uscire dalla casa o nei test). */
  async flush(): Promise<void> {
    clearTimeout(this.pushTimer);
    await this.enqueue(() => this.push());
    await this.idle();
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job).catch((e: unknown) => this.hooks.onError(e));
    this.queue = run;
    return run;
  }

  private status(): void {
    const online = HOUSE_TABLES.every((t) => this.online.get(t) === true);
    this.hooks.onStatus({ online, sending: this.sending });
  }

  private receive(table: HouseTable, docs: RemoteDoc[], authoritative: boolean): void {
    this.online.set(table, authoritative);
    this.status();
    // Conta solo l'ultimo elenco arrivato per ogni tabella: è lo stato attuale della casa.
    this.pendingDocs.set(table, { docs, authoritative });
    if (this.draining) return;
    this.draining = true;
    void this.enqueue(async () => {
      this.draining = false;
      const batch = [...this.pendingDocs.entries()];
      this.pendingDocs.clear();
      const changes: AppliedChange[] = [];
      const tables: HouseTable[] = [];
      let initial = false;
      for (const [t, { docs: d, authoritative: a }] of batch) {
        const change = await this.apply(t, d, a);
        if (this.firstApply.has(t) && a) {
          this.firstApply.delete(t);
          initial = true;
        }
        if (change) {
          tables.push(t);
          changes.push(change);
        }
      }
      if (tables.length) await this.hooks.onApplied(tables, changes, initial);
    });
  }

  /** Scrive sul telefono quello che è cambiato nella casa. Restituisce cosa è cambiato (null se niente). */
  private async apply(table: HouseTable, docs: readonly RemoteDoc[], authoritative: boolean): Promise<AppliedChange | null> {
    const store = this.db.table(table);
    const local = (await store.toArray()) as { id: string }[];
    const plan = planApply(table, docs, authoritative, local, this.shadow, SANITIZE[table]);
    const hasShadow = Object.keys(plan.shadowSet).length > 0 || plan.shadowDelete.length > 0;
    if (!plan.puts.length && !plan.deletes.length && !hasShadow) return null;
    if (plan.puts.length || plan.deletes.length) {
      await this.db.transaction('rw', store, async () => {
        if (plan.puts.length) await store.bulkPut(plan.puts.map((p) => p.record));
        if (plan.deletes.length) await store.bulkDelete(plan.deletes);
      });
    }
    Object.assign(this.shadow, plan.shadowSet);
    for (const k of plan.shadowDelete) delete this.shadow[k];
    await saveHouseShadow(this.db, this.shadow);
    if (!plan.puts.length && !plan.deletes.length) return null;
    const others = plan.puts.filter((p) => p.by !== this.remote.uid);
    return {
      table,
      added: others.filter((p) => p.isNew).map((p) => ({ name: displayName(table, p.record), by: p.by })),
      changed: others.filter((p) => !p.isNew).length,
      removed: plan.deletes.length,
    };
  }

  /** Manda alla casa i record cambiati o tolti sul telefono. */
  private async push(): Promise<void> {
    const puts: { table: HouseTable; id: string; json: string; hash: string }[] = [];
    const deletes: { table: HouseTable; id: string }[] = [];
    for (const table of HOUSE_TABLES) {
      const local = (await this.db.table(table).toArray()) as { id: string }[];
      const plan = planPush(table, local, this.shadow);
      puts.push(...plan.puts);
      deletes.push(...plan.deletes);
    }
    if (!puts.length && !deletes.length) return;
    this.sending = true;
    this.status();
    try {
      await this.remote.write(
        puts.map(({ table, id, json }) => ({ table, id, json })),
        deletes,
      );
    } finally {
      this.sending = false;
      this.status();
    }
    for (const p of puts) this.shadow[`${p.table}/${p.id}`] = p.hash;
    for (const d of deletes) delete this.shadow[`${d.table}/${d.id}`];
    await saveHouseShadow(this.db, this.shadow);
  }
}
