import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { IS_NATIVE } from './native';

/** A Blob as base64, the form the phone's file system takes. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves a file made in the app (CSV, PDF report, data export) under its name: the browser's
 * download on the web; in the phone app, which cannot download, the file is written to the app's
 * cache and the phone's share sheet opens (Files, Drive, email, WhatsApp…). Closing the sheet
 * without choosing is not an error.
 */
export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (IS_NATIVE) {
    const { uri } = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache });
    try {
      await Share.share({ title: name, files: [uri] });
    } catch (error) {
      if (!/cancel/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
