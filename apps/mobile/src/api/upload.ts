import { API_URL, api, ApiError } from './client';
import type { Media } from './types';

type Slot = { id: string; uploadUrl: string; method: 'PUT' | 'POST'; headers?: Record<string, string>; formField?: string };
export type PickedFile = { uri: string; mimeType?: string | null; width?: number; height?: number; fileName?: string | null };

// Three steps: ask for an upload slot, send the file straight to storage, tell the API it arrived.
export async function uploadMedia(file: PickedFile, kind: 'image' | 'video' | 'audio', token: string | null): Promise<Media> {
  const blob = await (await fetch(file.uri)).blob();
  // Browsers report things like "audio/webm;codecs=opus"; the server wants the plain type.
  const mime = (file.mimeType || blob.type || (kind === 'image' ? 'image/jpeg' : kind === 'audio' ? 'audio/mp4' : 'video/mp4')).split(';')[0].trim();
  const slot = await api<Slot>('/media/uploads', { method: 'POST', body: { kind, mime, bytes: blob.size, width: file.width, height: file.height } });

  let res: Response;
  if (slot.formField) {
    const form = new FormData();
    form.append(slot.formField, blob as unknown as Blob, file.fileName ?? 'upload');
    res = await fetch(slot.uploadUrl, { method: 'POST', body: form });
  } else {
    const headers: Record<string, string> = { ...(slot.headers ?? {}), 'Content-Type': mime };
    // In development the file goes to our own API, which wants to know who is uploading.
    if (token && slot.uploadUrl.startsWith(API_URL)) headers.Authorization = `Bearer ${token}`;
    res = await fetch(slot.uploadUrl, { method: slot.method, headers, body: blob });
  }
  if (!res.ok) throw new ApiError(res.status, 'The upload did not go through. Try again.');
  return api<Media>(`/media/${slot.id}/complete`, { method: 'POST' });
}
