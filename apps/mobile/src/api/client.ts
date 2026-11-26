import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Where the API lives. On a real phone use your computer's address, e.g. EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
function resolveBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  let url = fromEnv || fromConfig || 'http://localhost:3000';
  if (Platform.OS === 'android') url = url.replace('//localhost', '//10.0.2.2'); // Android emulator's name for your computer
  return url.replace(/\/$/, '');
}
export const API_URL = resolveBase();

// Media links saved while the server believed it lived at "localhost" cannot be opened from a phone.
// Point them at the address the app actually uses, so videos and pictures load without touching the database.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0)(:\d+)?(?=\/)/;
function fixUrls<T>(v: T): T {
  if (typeof v === 'string') return (LOCAL_ORIGIN.test(v) ? v.replace(LOCAL_ORIGIN, API_URL) : v) as T;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = fixUrls(v[i]); return v; }
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; for (const k of Object.keys(o)) o[k] = fixUrls(o[k]); }
  return v;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: { path: string; message: string }[], public code?: string) {
    super(message);
  }
}

// ---- token storage: secure store on phones, localStorage on web ----
const KEY = 'bmuette.tokens';
type Tokens = { access: string; refresh: string };
let memory: Tokens | null = null;

export async function loadTokens(): Promise<Tokens | null> {
  try {
    const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    memory = raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    memory = null;
  }
  return memory;
}
export async function saveTokens(t: Tokens | null) {
  memory = t;
  try {
    if (Platform.OS === 'web') {
      if (t) globalThis.localStorage?.setItem(KEY, JSON.stringify(t));
      else globalThis.localStorage?.removeItem(KEY);
    } else if (t) await SecureStore.setItemAsync(KEY, JSON.stringify(t));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // storage unavailable: the session just will not survive a restart
  }
}
export const hasTokens = () => !!memory;
export const getAccessToken = () => memory?.access ?? null;

let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };

let refreshing: Promise<boolean> | null = null;
function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      if (!memory?.refresh) return false;
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: memory.refresh }) });
        if (!res.ok) return false;
        const j = (await res.json()) as { accessToken: string; refreshToken: string };
        await saveTokens({ access: j.accessToken, refresh: j.refreshToken });
        return true;
      } catch {
        return false;
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

type Opts = { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal };

async function send(path: string, o: Opts) {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.auth !== false && memory?.access) headers.Authorization = `Bearer ${memory.access}`;
  return fetch(`${API_URL}${path}`, { method: o.method ?? 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, signal: o.signal });
}

export async function api<T>(path: string, o: Opts = {}): Promise<T> {
  let res: Response;
  try {
    res = await send(path, o);
    if (res.status === 401 && o.auth !== false && memory?.refresh) {
      if (await refreshOnce()) res = await send(path, o);
      else { await saveTokens(null); onSignedOut?.(); }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, `Cannot reach BMUETTE at ${API_URL}. Check that the server is running and the address is right.`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = Array.isArray(json?.message) ? json.message.join(', ') : json?.message;
    const issues = json?.issues as { path: string; message: string }[] | undefined;
    throw new ApiError(res.status, issues?.[0]?.message || msg || `Something went wrong (${res.status})`, issues, typeof json?.code === 'string' ? json.code : typeof json?.message?.code === 'string' ? json.message.code : undefined);
  }
  return (API_URL.includes('localhost') ? json : fixUrls(json)) as T;
}
