"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ListSelectionContextValue = {
  selected: Set<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  clear: () => void;
  pendingDelete: Set<string>;
  markPendingDelete: (ids: string[]) => void;
  unmarkPendingDelete: (ids: string[]) => void;
};

const ListSelectionContext = createContext<ListSelectionContextValue | null>(null);

/** Wrap a list page's grid to enable multi-select + bulk actions (Phase 45 B2). */
export function ListSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const markPendingDelete = useCallback((ids: string[]) => {
    setPendingDelete((prev) => new Set([...prev, ...ids]));
  }, []);
  const unmarkPendingDelete = useCallback((ids: string[]) => {
    setPendingDelete((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ selected, isSelected, toggle, clear, pendingDelete, markPendingDelete, unmarkPendingDelete }),
    [selected, isSelected, toggle, clear, pendingDelete, markPendingDelete, unmarkPendingDelete],
  );

  return <ListSelectionContext.Provider value={value}>{children}</ListSelectionContext.Provider>;
}

export function useListSelection() {
  const ctx = useContext(ListSelectionContext);
  if (!ctx) throw new Error("useListSelection must be used within a ListSelectionProvider");
  return ctx;
}
