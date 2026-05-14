import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Generic Kanban column pagination hook.
// Each column status has its own paginated list, count and "loadMore" support.
// Designed for crm_leads, crm_renovacoes, crm_cobrancas.

const PAGE_SIZE = 50;

export type ColumnState<T> = {
  items: T[];
  total: number;
  loading: boolean;
  hasMore: boolean;
};

export type ColumnFilter = {
  // jsonb-aware filters by column name
  // shape: ["assigned_to", "eq", "uuid"] or ["data->>nome", "ilike", "%foo%"]
  // when value is null we apply ".is.null"
  apply?: (q: any) => any;
};

export type UsePaginatedColumnsOptions = {
  table: "crm_leads" | "crm_renovacoes" | "crm_cobrancas";
  statusKeys: string[];
  // applied to every column query (filters by company/responsavel/etc)
  filter?: ColumnFilter;
  // ordering (default: updated_at desc)
  orderColumn?: string;
  orderAscending?: boolean;
  // optional select projection (default: "*")
  select?: string;
  // when search is set, skip per-column pagination and run a single ilike query merged into all columns
  searchQuery?: string;
  // search filter builder. Returns OR string to apply via .or()
  buildSearchOr?: (q: string) => string | null;
  // refresh trigger — when this value changes, we reload everything
  refreshKey?: number;
  // optional polling fallback for environments where realtime may lag or be unavailable
  pollingIntervalMs?: number;
};

export function usePaginatedColumns<T extends { id: string; status: string }>(
  opts: UsePaginatedColumnsOptions,
) {
  const {
    table,
    statusKeys,
    filter,
    orderColumn = "updated_at",
    orderAscending = false,
    select = "*",
    searchQuery,
    buildSearchOr,
    refreshKey = 0,
    pollingIntervalMs = 0,
  } = opts;

  const [columns, setColumns] = useState<Record<string, ColumnState<T>>>({});
  const [searchResults, setSearchResults] = useState<T[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchPollTick, setSearchPollTick] = useState(0);
  const inflightRef = useRef<Set<string>>(new Set());

  const queryFor = useCallback(
    (statusKey: string) => {
      let q = supabase.from(table).select(select, { count: "exact" }).eq("status", statusKey);
      if (filter?.apply) q = filter.apply(q);
      return q.order(orderColumn, { ascending: orderAscending });
    },
    [table, select, filter, orderColumn, orderAscending],
  );

  const fetchColumn = useCallback(
    async (statusKey: string, offset = 0) => {
      const key = `${statusKey}:${offset}`;
      if (inflightRef.current.has(key)) return;
      inflightRef.current.add(key);
      setColumns((prev) => ({
        ...prev,
        [statusKey]: {
          ...(prev[statusKey] || { items: [], total: 0, loading: false, hasMore: false }),
          loading: true,
        },
      }));
      try {
        const { data, error, count } = await queryFor(statusKey).range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        const newItems = (data || []) as unknown as T[];
        setColumns((prev) => {
          const existing = prev[statusKey]?.items || [];
          const merged = offset === 0
            ? newItems
            : [...existing.filter((it) => !newItems.some((n) => n.id === it.id)), ...newItems];
          const total = typeof count === "number" ? count : merged.length;
          return {
            ...prev,
            [statusKey]: {
              items: merged,
              total,
              loading: false,
              hasMore: merged.length < total,
            },
          };
        });
      } catch (e) {
        setColumns((prev) => ({
          ...prev,
          [statusKey]: {
            ...(prev[statusKey] || { items: [], total: 0, loading: false, hasMore: false }),
            loading: false,
          },
        }));
      } finally {
        inflightRef.current.delete(key);
      }
    },
    [queryFor],
  );

  const loadMore = useCallback(
    (statusKey: string) => {
      const col = columns[statusKey];
      if (!col || col.loading || !col.hasMore) return;
      fetchColumn(statusKey, col.items.length);
    },
    [columns, fetchColumn],
  );

  // Initial load + refresh (also re-run when filter changes)
  useEffect(() => {
    if (searchQuery && searchQuery.trim() && buildSearchOr) return; // search mode handles its own
    if (statusKeys.length === 0) return;
    setColumns({});
    statusKeys.forEach((k) => fetchColumn(k, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKeys.join("|"), refreshKey, searchQuery, filter]);

  // Search mode: single global query
  useEffect(() => {
    const q = (searchQuery || "").trim();
    if (!q || !buildSearchOr) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      let query = supabase.from(table).select(select).limit(500);
      if (filter?.apply) query = filter.apply(query);
      const orStr = buildSearchOr(q);
      if (orStr) query = query.or(orStr);
      query = query.order(orderColumn, { ascending: orderAscending });
      const { data } = await query;
      if (!cancelled) {
        setSearchResults((data || []) as unknown as T[]);
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchQuery, refreshKey, searchPollTick, buildSearchOr, table, select, filter, orderColumn, orderAscending]);

  useEffect(() => {
    if (!pollingIntervalMs || pollingIntervalMs <= 0 || statusKeys.length === 0) return;

    const intervalId = window.setInterval(() => {
      const q = (searchQuery || "").trim();
      if (q && buildSearchOr) {
        setSearchPollTick((prev) => prev + 1);
        return;
      }

      statusKeys.forEach((k) => fetchColumn(k, 0));
    }, pollingIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [pollingIntervalMs, statusKeys, searchQuery, buildSearchOr, fetchColumn]);

  // ---------- Mutations -------------
  const updateItemStatus = useCallback((itemId: string, fromStatus: string, toStatus: string, item?: T) => {
    setColumns((prev) => {
      const fromCol = prev[fromStatus];
      const toCol = prev[toStatus];
      const moved = fromCol?.items.find((it) => it.id === itemId) || item;
      if (!moved) return prev;
      const updated = { ...moved, status: toStatus } as T;
      const next: Record<string, ColumnState<T>> = { ...prev };
      if (fromCol) {
        next[fromStatus] = {
          ...fromCol,
          items: fromCol.items.filter((it) => it.id !== itemId),
          total: Math.max(0, fromCol.total - 1),
        };
      }
      if (toCol) {
        next[toStatus] = {
          ...toCol,
          items: [updated, ...toCol.items.filter((it) => it.id !== itemId)],
          total: toCol.total + 1,
          hasMore: toCol.hasMore,
        };
      } else {
        next[toStatus] = { items: [updated], total: 1, loading: false, hasMore: false };
      }
      return next;
    });
    if (searchResults) {
      setSearchResults((prev) =>
        prev ? prev.map((it) => (it.id === itemId ? ({ ...it, status: toStatus } as T) : it)) : prev,
      );
    }
  }, [searchResults]);

  const patchItem = useCallback((itemId: string, patch: Partial<T>) => {
    setColumns((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        const col = next[k];
        if (col.items.some((it) => it.id === itemId)) {
          next[k] = { ...col, items: col.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) };
        }
      });
      return next;
    });
    if (searchResults) {
      setSearchResults((prev) => prev?.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) || prev);
    }
  }, [searchResults]);

  const removeItem = useCallback((itemId: string, statusKey?: string) => {
    setColumns((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        const col = next[k];
        if (col.items.some((it) => it.id === itemId)) {
          next[k] = { ...col, items: col.items.filter((it) => it.id !== itemId), total: Math.max(0, col.total - 1) };
        }
      });
      return next;
    });
    if (searchResults) {
      setSearchResults((prev) => prev?.filter((it) => it.id !== itemId) || prev);
    }
  }, [searchResults]);

  const refetch = useCallback(() => {
    statusKeys.forEach((k) => fetchColumn(k, 0));
  }, [statusKeys, fetchColumn]);

  // Realtime: refresh columns when the underlying table changes
  useEffect(() => {
    if (statusKeys.length === 0) return;
    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        statusKeys.forEach((k) => fetchColumn(k, 0));
      }, 400);
    };
    const channel = supabase
      .channel(`paginated-${table}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, statusKeys.join("|")]);

  return {
    columns,
    loadMore,
    fetchColumn,
    updateItemStatus,
    patchItem,
    removeItem,
    refetch,
    // search mode
    searchResults,
    searching,
    isSearching: !!(searchQuery && searchQuery.trim()),
  };
}

export const PAGINATION_PAGE_SIZE = PAGE_SIZE;
