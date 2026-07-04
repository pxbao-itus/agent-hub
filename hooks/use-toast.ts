"use client";

import * as React from "react";
import type { ToastProps } from "@/components/ui/toast";

const TOAST_LIMIT = 5;
const TOAST_REMOVE_DELAY = 4000;

type ToastInput = Pick<ToastProps, "variant"> & {
  title?: string;
  description?: string;
  /** Rendered as the toast's action slot, e.g. a <ToastAction>Undo</ToastAction>. */
  action?: React.ReactNode;
  /** Overrides TOAST_REMOVE_DELAY for this toast (e.g. to match an undo grace window). */
  duration?: number;
};

type ToasterToast = ToastInput & { id: string; open: boolean };

type Action =
  | { type: "ADD"; toast: ToasterToast }
  | { type: "DISMISS"; id: string }
  | { type: "REMOVE"; id: string };

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return String(count);
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function dispatch(action: Action) {
  listeners.forEach((l) => l(action));
}

const listeners: Array<(action: Action) => void> = [];
let memoryState: ToasterToast[] = [];

function reducer(state: ToasterToast[], action: Action): ToasterToast[] {
  switch (action.type) {
    case "ADD":
      return [action.toast, ...state].slice(0, TOAST_LIMIT);
    case "DISMISS":
      return state.map((t) => (t.id === action.id ? { ...t, open: false } : t));
    case "REMOVE":
      return state.filter((t) => t.id !== action.id);
  }
}

function scheduleRemove(id: string) {
  if (toastTimeouts.has(id)) return;
  const timeout = setTimeout(() => {
    toastTimeouts.delete(id);
    dispatch({ type: "REMOVE", id });
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(id, timeout);
}

function toast(input: ToastInput) {
  const id = genId();
  const delay = input.duration ?? TOAST_REMOVE_DELAY;
  dispatch({ type: "ADD", toast: { ...input, id, open: true } });
  setTimeout(() => {
    dispatch({ type: "DISMISS", id });
    scheduleRemove(id);
  }, Math.max(delay - 300, 0));
  return id;
}

function useToast() {
  const [state, setState] = React.useState<ToasterToast[]>(memoryState);

  React.useEffect(() => {
    function listener(action: Action) {
      memoryState = reducer(memoryState, action);
      setState(memoryState);
    }
    listeners.push(listener);
    return () => {
      const i = listeners.indexOf(listener);
      if (i > -1) listeners.splice(i, 1);
    };
  }, []);

  return { toasts: state, toast, dismiss: (id: string) => dispatch({ type: "DISMISS", id }) };
}

export { useToast, toast };
