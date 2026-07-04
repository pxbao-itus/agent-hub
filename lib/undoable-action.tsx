import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

const UNDO_WINDOW_MS = 5000;

// Module-level, not component state: a pending action must still fire (or
// stay cancellable) across client-side navigation, since the Toaster lives
// at the layout level, not the page level. A real reload/tab close does
// lose it — accepted limitation, see plans/45-perf-ux-p3.md §3 B1.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Delayed-execute pattern for destructive actions (Phase 45 B1 — "Undo").
 * Shows a toast with an Undo action; `commit()` only runs once the grace
 * window elapses uncancelled. No schema change needed — the mutation
 * itself is a normal, immediate call, just deferred a few seconds.
 */
export function runUndoable(opts: {
  /** Identifies this pending action — a second call with the same key replaces it. */
  key: string;
  message: string;
  commit: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const { key, message, commit, onCancel } = opts;

  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    timers.delete(key);
    void commit();
  }, UNDO_WINDOW_MS);
  timers.set(key, timer);

  toast({
    title: message,
    duration: UNDO_WINDOW_MS,
    action: (
      <ToastAction
        altText="Undo"
        onClick={() => {
          const pending = timers.get(key);
          if (!pending) return; // already committed
          clearTimeout(pending);
          timers.delete(key);
          onCancel?.();
        }}
      >
        Undo
      </ToastAction>
    ),
  });
}
