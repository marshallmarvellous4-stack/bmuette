import { Alert, Platform } from 'react-native';
import { api } from '@/api/client';
import type { MenuAction } from '@/components/Sheet';
import { useMenu, useReport, type ReportTarget } from '@/state/menu';

const confirm = (title: string, message: string, action: string, run: () => void) => {
  if (Platform.OS === 'web') { if (globalThis.confirm?.(`${title}\n\n${message}`)) run(); return; }
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: run }]);
};
export { confirm };

/** The "..." menu on someone else's post, comment, listing or profile. */
export function openSafetyMenu(o: { target: ReportTarget; username?: string; blocked?: boolean; onBlock?: (block: boolean) => void; title?: string }) {
  const actions: MenuAction[] = [{ label: `Report ${o.target.type === 'user' ? 'account' : o.target.type === 'product' ? 'listing' : o.target.type}`, icon: 'flag', onPress: () => useReport.getState().start(o.target) }];
  if (o.username && o.onBlock) {
    actions.push({
      label: o.blocked ? `Unblock @${o.username}` : `Block @${o.username}`, icon: 'block',
      onPress: () => (o.blocked ? o.onBlock!(false) : confirm(`Block @${o.username}?`, 'They will not be able to message you, and you will not see their posts. They are not told.', 'Block', () => o.onBlock!(true))),
    });
  }
  useMenu.getState().show({ title: o.title, actions });
}

export const deletePost = (id: string) => api(`/posts/${id}`, { method: 'DELETE' });
export const deleteComment = (id: string) => api(`/comments/${id}`, { method: 'DELETE' });
