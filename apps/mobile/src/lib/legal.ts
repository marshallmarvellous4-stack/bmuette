import * as WebBrowser from 'expo-web-browser';
import { API_URL } from '@/api/client';

export type LegalPage = 'terms' | 'privacy' | 'community';
// The legal pages are served by the backend, so they are always the current version.
export const openLegal = (page: LegalPage) => WebBrowser.openBrowserAsync(`${API_URL}/legal/${page}`);
