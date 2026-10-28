import { useEffect, useState } from "react";

const EVENT = "nexus:reservations-changed";
const STORAGE_KEY = "nexus.reservations.changed";

/** No user data is shared between tabs; they reload through their own session. */
export function publishReservationChange() {
  window.dispatchEvent(new Event(EVENT));
  try { window.localStorage.setItem(STORAGE_KEY, `${Date.now()}-${Math.random()}`); } catch { /* Refresh on focus/poll still works. */ }
}

/** Refresh open calendars after mutations, on return to the tab and every 20 s. */
export function useReservationUpdates() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") setRevision((value) => value + 1); };
    const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) refresh(); };
    window.addEventListener(EVENT, refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 20_000);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, []);
  return revision;
}
