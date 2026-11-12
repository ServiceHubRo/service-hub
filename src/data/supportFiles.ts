import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { failure, FILE_ERRORS, FileError, RpcError, type FileErrorCode } from './rpc';
import { supabase, supabaseConfig } from './supabase';

/**
 * The files of support requests (A3b): uploaded and opened only through the Edge Function
 * support-files, which checks the real type and soundness of every file from its bytes, removes the
 * personal metadata of photos, and writes every opening to the audit log. The bucket is private; a
 * file opens through a signed link valid 60 seconds.
 */

export const SUPPORT_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export const SUPPORT_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORT_FILES_PER_MESSAGE = 5;

/** A file uploaded and not sent yet (sent with the request or the message). */
export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
}

/** A file sent with a request: its description (no message) or a message. */
export interface RequestFile extends UploadedFile {
  message_id: string | null;
  from_staff: boolean;
  created_at: string;
  /** The admin only: who opened it and when, newest first. */
  opens?: { at: string; by: string | null; name: string | null; role: string | null }[];
}

/** Why the Edge Function refused a file (the database's refusals come as RpcError); shared with the fleet files (A6). */
export { FILE_ERRORS, FileError, type FileErrorCode } from './rpc';

async function call(body: FormData | Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new RpcError('network');
  const { data, error } = await supabase.functions.invoke('support-files', { method: 'POST', body });
  if (!error) return data;
  if (error instanceof FunctionsFetchError) throw new RpcError('network');
  if (error instanceof FunctionsHttpError) {
    let code: unknown;
    try {
      code = ((await (error.context as Response).json()) as { error?: unknown }).error;
    } catch {
      code = null;
    }
    if ((FILE_ERRORS as readonly unknown[]).includes(code)) throw new FileError(code as FileErrorCode);
    throw failure({ message: code }, 'support-files');
  }
  throw new RpcError('unknown');
}

export async function uploadSupportFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append('file', file, file.name);
  return (await call(form)) as UploadedFile;
}

/** A link to the file, valid 60 seconds (opening it is logged). A PDF downloads. */
export async function openSupportFile(fileId: string): Promise<{ url: string; name: string; mime: string }> {
  const r = (await call({ action: 'open', file_id: fileId })) as { url: string; name: string; mime: string };
  if (!supabaseConfig.ok) throw new RpcError('network');
  return { ...r, url: `${supabaseConfig.url}${r.url}` };
}
