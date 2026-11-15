// Fotocamera: mirino dentro l'app (scheda Aggiungi) con la fotocamera posteriore, scatto della parte
// inquadrata, torcia; di riserva la fotocamera del telefono e la galleria (plugin Camera).
import { Camera, CameraDirection, MediaTypeSelection } from '@capacitor/camera';
import { UserError } from '../errors';
import { looksBlank } from '../logic/gemini';
import { isNative } from '../platform';

export type CameraProblem = 'unsupported' | 'denied' | 'none' | 'busy' | 'error';

export class CameraUnavailable extends Error {
  constructor(readonly problem: CameraProblem) {
    super(problem);
  }
}

export interface Viewfinder {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** La fotocamera ha la torcia. */
  hasTorch: boolean;
}

/** Accende il mirino nel `<video>`. Lancia CameraUnavailable se la fotocamera non si può usare. */
export async function openViewfinder(video: HTMLVideoElement): Promise<Viewfinder> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraUnavailable('unsupported');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraUnavailable('denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraUnavailable('none');
    if (name === 'NotReadableError' || name === 'AbortError') throw new CameraUnavailable('busy');
    throw new CameraUnavailable('error');
  }
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraUnavailable('none');
  }
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', '');
  try {
    await video.play();
  } catch {
    // Alcuni telefoni partono da soli appena il video è visibile.
  }
  const caps = (typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}) as Record<string, unknown>;
  // Messa a fuoco continua (utile per le date piccole), se il telefono la permette.
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
  }
  return { stream, track, hasTorch: caps.torch === true };
}

export function closeViewfinder(v: Viewfinder | null, video?: HTMLVideoElement | null): void {
  v?.stream.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
}

export async function setTorch(v: Viewfinder, on: boolean): Promise<boolean> {
  try {
    await v.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return on;
  } catch {
    return false;
  }
}

/** Riquadro (in pixel dello schermo, relativo al video) da ritagliare. */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fotografa quello che si vede nel mirino. Con `frame` ritaglia il riquadro del mirino (più un po' di
 * margine), così la data piccola resta nitida anche rimpicciolendo la foto.
 */
export function captureFrame(video: HTMLVideoElement, frame: FrameRect | null): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new UserError('La fotocamera non è ancora pronta: riprova tra un attimo.');
  const ew = video.clientWidth || vw;
  const eh = video.clientHeight || vh;
  // Il video riempie il riquadro ("cover"): si calcola quale parte si vede davvero.
  const scale = Math.max(ew / vw, eh / vh);
  const visW = ew / scale;
  const visH = eh / scale;
  let sx = (vw - visW) / 2;
  let sy = (vh - visH) / 2;
  let sw = visW;
  let sh = visH;
  if (frame) {
    const margin = 0.12;
    const fx = Math.max(0, frame.x - frame.width * margin);
    const fy = Math.max(0, frame.y - frame.height * margin);
    const fw = Math.min(ew - fx, frame.width * (1 + 2 * margin));
    const fh = Math.min(eh - fy, frame.height * (1 + 2 * margin));
    sx += fx / scale;
    sy += fy / scale;
    sw = fw / scale;
    sh = fh / scale;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas non disponibile');
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ---------- Fotocamera del telefono e galleria (di riserva) ----------

const CAMERA_SIDE = 2000;

function isCancel(e: unknown): boolean {
  const text = `${(e as { code?: string })?.code ?? ''} ${(e as Error)?.message ?? e}`;
  return /cancel|annull|OS-PLUG-CAMR-0006|OS-PLUG-CAMR-0020/i.test(text);
}

async function webPathToBlob(webPath: string): Promise<Blob> {
  const res = await fetch(webPath);
  if (!res.ok) throw new Error('Impossibile leggere la foto');
  return res.blob();
}

function pickFromInput(capture: boolean): Promise<Blob | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    let done = false;
    const finish = (file: Blob | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}

/** Scatta con l'app Fotocamera del telefono (messa a fuoco migliore per le date piccole). null se si annulla. */
export async function takePhoto(): Promise<Blob | null> {
  if (!isNative()) return pickFromInput(true);
  try {
    const res = await Camera.takePhoto({
      quality: 88,
      targetWidth: CAMERA_SIDE,
      targetHeight: CAMERA_SIDE,
      correctOrientation: true,
      cameraDirection: CameraDirection.Rear,
      editable: 'no',
      saveToGallery: false,
    });
    return res.webPath ? await webPathToBlob(res.webPath) : null;
  } catch (e) {
    if (isCancel(e)) return null;
    throw e;
  }
}

/** Sceglie una foto dalla galleria. null se si annulla. */
export async function choosePhoto(): Promise<Blob | null> {
  if (!isNative()) return pickFromInput(false);
  try {
    const res = await Camera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo,
      allowMultipleSelection: false,
      limit: 1,
      correctOrientation: true,
      quality: 88,
      targetWidth: CAMERA_SIDE,
      targetHeight: CAMERA_SIDE,
    });
    const path = res.results[0]?.webPath;
    return path ? await webPathToBlob(path) : null;
  } catch (e) {
    if (isCancel(e)) return null;
    throw e;
  }
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas non disponibile');
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

// ---------- Preparazione per l'IA ----------

export interface PreparedImage {
  base64: string;
  mime: string;
  /** Anteprima da mostrare mentre l'IA lavora. */
  dataUrl: string;
  /** Miniatura quadrata (160 px) da salvare con il prodotto. */
  thumb: string;
}

function isBlank(source: HTMLCanvasElement): boolean {
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 24;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, 24, 24);
  return looksBlank(ctx.getImageData(0, 0, 24, 24).data);
}

function scaled(source: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(source.width, source.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(source.width * s));
  c.height = Math.max(1, Math.round(source.height * s));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas non disponibile');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/** Miniatura quadrata dal centro della foto. */
export function makeThumb(source: HTMLCanvasElement, side = 160): string {
  const s = Math.min(source.width, source.height);
  const c = document.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (source.width - s) / 2, (source.height - s) / 2, s, s, 0, 0, side, side);
  return c.toDataURL('image/jpeg', 0.7);
}

/**
 * Rimpicciolisce la foto (lato lungo `maxSide`) e la trasforma in JPEG. Rifiuta le foto nere o vuote.
 * Per le etichette 1024 px bastano a leggere la data nel riquadro; per scontrini e spesa intera 1280.
 */
export function prepareCanvas(source: HTMLCanvasElement, maxSide: number): PreparedImage {
  if (isBlank(source)) {
    throw new UserError('La foto è venuta nera o vuota. Riprova con più luce (c’è anche la torcia).');
  }
  const c = scaled(source, maxSide);
  const dataUrl = c.toDataURL('image/jpeg', 0.82);
  return { dataUrl, mime: 'image/jpeg', base64: dataUrl.slice(dataUrl.indexOf(',') + 1), thumb: makeThumb(source) };
}
