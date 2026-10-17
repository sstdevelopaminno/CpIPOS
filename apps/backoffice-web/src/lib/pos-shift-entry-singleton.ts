"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/** Exactly one shift-entry prompt per browser document, not per session id.
 * Next.js can retain two route trees, and during login handoff those trees can
 * legitimately carry different session ids. Module-local maps are insufficient
 * when the route is present in multiple client chunks after navigation/HMR.
 *
 * The store is kept on window, shared across all client module instances.
 * A mounted contender is promoted automatically when its predecessor unmounts.
 * No server shift/session authorization is affected.
 */
type ShiftEntryStore = {
  owners: symbol[];
  subscribers: Set<() => void>;
};
type ShiftEntryWindow = Window & { __cpiposShiftEntryStore?: ShiftEntryStore };

function sharedStore(): ShiftEntryStore {
  const scope = window as ShiftEntryWindow;
  if (!scope.__cpiposShiftEntryStore) {
    scope.__cpiposShiftEntryStore = { owners: [], subscribers: new Set() };
  }
  return scope.__cpiposShiftEntryStore;
}

function notify(store: ShiftEntryStore) {
  for (const listener of store.subscribers) listener();
}

function register(token: symbol) {
  const store = sharedStore();
  if (!store.owners.includes(token)) {
    store.owners.push(token);
    notify(store);
  }
  return () => {
    const index = store.owners.indexOf(token);
    if (index !== -1) {
      store.owners.splice(index, 1);
      notify(store);
    }
  };
}

function subscribe(listener: () => void) {
  const store = sharedStore();
  store.subscribers.add(listener);
  return () => {
    store.subscribers.delete(listener);
  };
}

/** Browser-wide presentation leader for the shift-required dialog.
 * When a session is already in a shift, callers pass null and release the lock.
 */
export function usePosShiftEntryLeader(sessionId: string | null) {
  const token = useRef(Symbol("pos-shift-entry"));
  const getSnapshot = useCallback(
    () => Boolean(sessionId && sharedStore().owners[0] === token.current),
    [sessionId]
  );
  const leader = useSyncExternalStore(subscribe, getSnapshot, () => false);
  useEffect(() => {
    if (!sessionId) return;
    return register(token.current);
  }, [sessionId]);
  return leader;
}
