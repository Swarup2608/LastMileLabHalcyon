// The newest inbox emails for staff, shared by every screen that keeps them live (Orders, Exceptions and the sidebar's
// Exceptions badge): one poll every 15 seconds while any of them is mounted, so a client answering in the portal reaches
// staff within seconds. Each poll also seeds the request edits (order-request.ts).
import { useSyncExternalStore } from "react";
import { emailsApi, type InboundEmail } from "./emails";
import { seedEdits } from "./order-request";

const WINDOW = 200;
const EVERY = 15_000;

export interface InboxState {
  emails: InboundEmail[] | null;
  failed: boolean;
  // When the last poll came back, epoch ms; 0 before the first.
  at: number;
}

const INITIAL: InboxState = { emails: null, failed: false, at: 0 };
let state = INITIAL;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
const notify = () => listeners.forEach((l) => l());

// Polls now, outside the schedule too (e.g. after "Analyze now").
export function refreshInbox() {
  emailsApi.list(WINDOW, 0).then(
    (page) => {
      // Ignored emails (blank, repeats, no order, or set aside by staff) only show under Order requests → Ignored.
      const emails = page.emails.filter((e) => !e.ignored);
      seedEdits(emails);
      state = { emails, failed: false, at: Date.now() };
      notify();
    },
    () => {
      state = { ...state, failed: true, at: Date.now() };
      notify();
    },
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    refreshInbox();
    timer = setInterval(refreshInbox, EVERY);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) clearInterval(timer);
  };
}

const NOT_SUBSCRIBED = () => () => {};

// Staff only; pass enabled = false elsewhere so nothing polls.
export function useStaffInbox(enabled = true): InboxState {
  return useSyncExternalStore(enabled ? subscribe : NOT_SUBSCRIBED, () => state, () => INITIAL);
}
