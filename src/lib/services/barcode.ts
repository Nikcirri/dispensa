// Scanner dei codici a barre: usa lo scanner di Google (Google Play services), che non chiede
// il permesso della fotocamera all'app. La prima volta Android può doverlo scaricare.
import {
  BarcodeFormat,
  BarcodeScanner,
  GoogleBarcodeScannerModuleInstallState,
} from '@capacitor-mlkit/barcode-scanning';
import { UserError } from '../errors';
import { isNative } from '../platform';

const INSTALL_TIMEOUT_MS = 90_000;

async function ensureScannerModule(onInstalling: () => void): Promise<void> {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (available) return;
  onInstalling();
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(new UserError('Lo scanner non si è installato in tempo. Riprova tra poco.')), INSTALL_TIMEOUT_MS);
    const handle = BarcodeScanner.addListener('googleBarcodeScannerModuleInstallProgress', (event) => {
      if (event.state === GoogleBarcodeScannerModuleInstallState.COMPLETED) finish();
      else if (
        event.state === GoogleBarcodeScannerModuleInstallState.FAILED ||
        event.state === GoogleBarcodeScannerModuleInstallState.CANCELED
      ) {
        finish(new UserError('Non riesco a installare lo scanner di Google. Controlla internet e Google Play.'));
      }
    });
    function finish(error?: Error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void handle.then((h) => h.remove());
      if (error) reject(error);
      else resolve();
    }
    BarcodeScanner.installGoogleBarcodeScannerModule().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      // "già installato" non è un errore
      if (/already/i.test(msg)) finish();
      else finish(new UserError('Non riesco a installare lo scanner di Google. Controlla internet e Google Play.'));
    });
  });
}

/** Apre lo scanner. Restituisce il codice letto, oppure null se l'utente chiude. */
export async function scanBarcode(onInstalling: () => void = () => undefined): Promise<string | null> {
  return scan([BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE], onInstalling);
}

/** Inquadra un codice QR (l'invito della casa condivisa mostrato sull'altro telefono). */
export async function scanQrCode(onInstalling: () => void = () => undefined): Promise<string | null> {
  return scan([BarcodeFormat.QrCode], onInstalling, 'Lo scanner funziona solo nell’app Android: incolla il messaggio dell’invito.');
}

async function scan(formats: BarcodeFormat[], onInstalling: () => void, webText = 'Lo scanner funziona solo nell’app Android. Puoi scrivere il codice a mano.'): Promise<string | null> {
  if (!isNative()) throw new UserError(webText);
  const { supported } = await BarcodeScanner.isSupported();
  if (!supported) throw new UserError('Questo telefono non supporta lo scanner di Google.');
  await ensureScannerModule(onInstalling);
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats, autoZoom: true });
    const code = barcodes.find((b) => b.rawValue)?.rawValue?.trim();
    return code || null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return null;
    throw e;
  }
}
