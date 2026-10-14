"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

// During client route transitions, React can retain two POS entry trees at once.
// Allow only one open-shift prompt per session while still promoting the next
// mounted entry gate when the first tree unmounts. This is presentation-only;
// server-side shift/session authorization is unchanged.
const owners = new Map<string, symbol[]>();
const subscribers = new Set<() => void>();

function notify() {
  for (const listener of subscribers) listener();
}

function register(sessionId: string, token: symbol) {
  const queue = owners.get(sessionId) ?? [];
  if (!queue.includes(token)) {
    owners.set(sessionId, [...queue, token]);
    notify();
  }
  return () => {
    const remaining = (owners.get(sessionId) ?? []).filter((item) => item !== token);
    if (remaining.length) owners.set(sessionId, remaining);
    else owners.delete(sessionId);
    notify();
  };
}

function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}

/** Prevents duplicated open-shift dialogs without changing shift enforcement. */
export function usePosShiftEntryLeader(sessionId: string | null) {
  const token = useRef(Symbol("pos-shift-entry"));
  const getSnapshot = useCallback(
    () => Boolean(sessionId && owners.get(sessionId)?.[0] === token.current),
    [sessionId]
  );
  const isLeader = useSyncExternalStore(subscribe, getSnapshot, () => false);
  useEffect(() => {
    if (!sessionId) return;
    return register(sessionId, token.current);
  }, [sessionId]);
  return isLeader;
}
