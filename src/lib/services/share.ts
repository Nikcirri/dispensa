// Condivisione (WhatsApp, note, email…) e salvataggio del backup.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { db } from '../db';
import { backupFileName, makeBackup, parseBackup, type BackupData } from '../logic/backup';
import { todayKey } from '../logic/dates';
import { APP_VERSION, isNative } from '../platform';
import { exportAll, importAll } from '../repo';

const isCancel = (e: unknown) => /cancel/i.test(String(e instanceof Error ? e.message : e));

/** Condivide un testo. Nel browser lo copia negli appunti. Restituisce false se si annulla. */
export async function shareText(title: string, text: string): Promise<boolean> {
  if (!isNative()) {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    return true;
  }
  try {
    await Share.share({ title, text, dialogTitle: title });
    return true;
  } catch (e) {
    if (isCancel(e)) return false;
    throw e;
  }
}

/** Copia un testo negli appunti. false se il telefono non lo permette. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Riserva per le WebView che non hanno gli appunti "moderni".
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** Crea il backup e apre "Condividi" (Drive, email, WhatsApp…). false se si chiude senza scegliere. */
export async function shareBackup(): Promise<boolean> {
  const text = makeBackup(await exportAll(db), APP_VERSION);
  const name = backupFileName(todayKey());
  if (!isNative()) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  }
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title: name, files: [uri], dialogTitle: 'Salva il backup' });
    return true;
  } catch (e) {
    if (isCancel(e)) return false;
    throw e;
  }
}

export async function readBackupFile(file: File): Promise<BackupData> {
  return parseBackup(await file.text());
}

export async function restoreBackup(data: BackupData): Promise<void> {
  await importAll(db, data);
}
