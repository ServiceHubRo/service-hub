import { shrinkImage } from '../lib/image';
import { failure, RpcError } from './rpc';
import { supabase } from './supabase';

/** A photo of the workshop (T28b), in the public bucket `shop-photos` under the shop's folder. */
export interface ShopPhoto {
  id: string;
  url: string;
  path: string;
  position: number;
}

export const PHOTO_LIMIT = 10;
/** What a phone may hand over before it is shrunk (the bucket itself takes 5 MB). */
export const PHOTO_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** The picture could not be decoded here (an unusual format): nothing was uploaded. */
export class PhotoReadError extends Error {}

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

export async function fetchShopPhotos(shopId: string): Promise<ShopPhoto[]> {
  const { data, error } = await db()
    .from('shop_photos')
    .select('id, url, path, position')
    .eq('shop_id', shopId)
    .order('position')
    .order('created_at');
  if (error) throw failure(error);
  return data;
}

/** Shrinks the picture, uploads it into the shop's folder and adds it at the end. */
export async function addShopPhoto(shopId: string, file: File, position: number): Promise<ShopPhoto> {
  let blob: Blob;
  try {
    blob = await shrinkImage(file);
  } catch {
    throw new PhotoReadError('unreadable');
  }
  const path = `${shopId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const bucket = db().storage.from('shop-photos');
  const up = await bucket.upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
  if (up.error) throw failure(up.error);
  const url = bucket.getPublicUrl(path).data.publicUrl;
  const { data, error } = await db()
    .from('shop_photos')
    .insert({ shop_id: shopId, path, url, position })
    .select('id, url, path, position')
    .single();
  if (error) {
    await bucket.remove([path]).catch(() => undefined);
    throw failure(error);
  }
  return data;
}

export async function removeShopPhoto(photo: ShopPhoto): Promise<void> {
  const { error } = await db().from('shop_photos').delete().eq('id', photo.id);
  if (error) throw failure(error);
  // Best effort: an orphaned file costs nothing visible.
  await db().storage.from('shop-photos').remove([photo.path]).then(
    () => undefined,
    () => undefined,
  );
}

/** Writes the order shown (0, 1, 2…) for the photos whose place changed. */
export async function saveShopPhotoOrder(photos: ShopPhoto[]): Promise<ShopPhoto[]> {
  const next = photos.map((p, i) => ({ ...p, position: i }));
  for (const p of next) {
    if (photos.find((x) => x.id === p.id)?.position === p.position) continue;
    const { error } = await db().from('shop_photos').update({ position: p.position }).eq('id', p.id);
    if (error) throw failure(error);
  }
  return next;
}
