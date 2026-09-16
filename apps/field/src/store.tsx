import { LOCAL_SURVEY_STATE_LABEL, type FieldPack } from "@eia/field-sync-contract";
import {
  OFFLINE_ACCESS_STATE_LABEL,
  offlineAccessState,
  type OfflineAccessState,
} from "@eia/domain/mobile";
import * as Network from "expo-network";
import type * as SQLite from "expo-sqlite";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { openLocalDatabase } from "./db/open";
import {
  countPending,
  listAssignments,
  readCursor,
  readPack,
  type LocalAssignmentRow,
} from "./db/repo";
import { synchronise, type SyncOutcome } from "./sync/engine";

/**
 * Everything the screens share: the open database, the downloaded pack, the technician's rows and
 * whether there is a signal.
 *
 * One context rather than a state library. The application has five screens and one source of
 * truth — the local database — so the store's whole job is to re-read it after a write; a reducer
 * layer over that would be indirection without a decision in it.
 */
export interface FieldState {
  readonly db: SQLite.SQLiteDatabase | null;
  readonly pack: FieldPack | null;
  readonly assignments: ReadonlyArray<LocalAssignmentRow>;
  readonly pending: number;
  readonly lastSyncAt: string | null;
  readonly online: boolean;
  readonly syncing: boolean;
  readonly lastOutcome: SyncOutcome | null;
  readonly offlineState: OfflineAccessState | null;
  readonly openError: string | null;
  readonly refresh: () => Promise<void>;
  readonly sync: () => Promise<void>;
}

const FieldContext = createContext<FieldState | null>(null);

export function useField(): FieldState {
  const value = useContext(FieldContext);
  if (!value) throw new Error("useField outside FieldProvider");
  return value;
}

export function FieldProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [pack, setPack] = useState<FieldPack | null>(null);
  const [assignments, setAssignments] = useState<ReadonlyArray<LocalAssignmentRow>>([]);
  const [pending, setPending] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<SyncOutcome | null>(null);

  const refresh = useCallback(async () => {
    if (!db) return;
    setPack(await readPack(db));
    setAssignments(await listAssignments(db));
    setPending(await countPending(db));
    setLastSyncAt((await readCursor(db))?.lastSyncAt ?? null);
  }, [db]);

  /*
   * Open the database and read it once, in one effect.
   *
   * Deliberately not two: a second effect that re-read whenever `db` changed would set state
   * synchronously on the render that produced the handle, which is the cascade React warns about.
   * Everything after this point re-reads through `refresh()` after a write, which is a user action
   * rather than a render.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const opened = await openLocalDatabase();
        if (cancelled) return;
        setDb(opened);
        setPack(await readPack(opened));
        setAssignments(await listAssignments(opened));
        setPending(await countPending(opened));
        setLastSyncAt((await readCursor(opened))?.lastSyncAt ?? null);
      } catch (error: unknown) {
        if (!cancelled) {
          setOpenError(error instanceof Error ? error.message : "no se pudo abrir la base local");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Connectivity is a **trigger**, never evidence.
   *
   * A device can be attached to a roadside access point that routes nowhere, or to a carrier that
   * answers DNS and nothing else. So this flag only decides whether it is worth *attempting* a
   * sync; whether the server is actually reachable is answered by the request itself, which is why
   * the outbox treats an unanswered call as retryable rather than as a failure.
   */
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const state = await Network.getNetworkStateAsync();
      if (!cancelled) setOnline(Boolean(state.isInternetReachable ?? state.isConnected));
    };
    void read();
    const subscription = Network.addNetworkStateListener((state) => {
      setOnline(Boolean(state.isInternetReachable ?? state.isConnected));
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const sync = useCallback(async () => {
    if (!db || syncing) return;
    setSyncing(true);
    try {
      const outcome = await synchronise(db);
      setLastOutcome(outcome);
      await refresh();
    } finally {
      setSyncing(false);
    }
  }, [db, refresh, syncing]);

  const offlineState = useMemo<OfflineAccessState | null>(
    () =>
      pack
        ? offlineAccessState({ now: new Date(), expiresAt: new Date(pack.validity.expiresAt) })
        : null,
    [pack],
  );

  const value = useMemo<FieldState>(
    () => ({
      db,
      pack,
      assignments,
      pending,
      lastSyncAt,
      online,
      syncing,
      lastOutcome,
      offlineState,
      openError,
      refresh,
      sync,
    }),
    [
      db,
      pack,
      assignments,
      pending,
      lastSyncAt,
      online,
      syncing,
      lastOutcome,
      offlineState,
      openError,
      refresh,
      sync,
    ],
  );

  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
}

export { LOCAL_SURVEY_STATE_LABEL, OFFLINE_ACCESS_STATE_LABEL };
