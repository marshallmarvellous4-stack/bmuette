// A tiny event bus: tapping the active tab again tells that screen to scroll back to the top.
type Fn = () => void;
const listeners = new Map<string, Set<Fn>>();
export const tabEvents = {
  onReselect(tab: string, fn: Fn) {
    if (!listeners.has(tab)) listeners.set(tab, new Set());
    listeners.get(tab)!.add(fn);
    return () => { listeners.get(tab)?.delete(fn); };
  },
  reselect(tab: string) { listeners.get(tab)?.forEach((f) => f()); },
};
