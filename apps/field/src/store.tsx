import type { FieldPack, FieldProjectWithWork, WorkPack } from "@eia/field-sync-contract";
import { offlineAccessState, type OfflineAccessState } from "@eia/domain/mobile";
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
import {
  ensureWorkPack,
  listInvitations,
  summarisePendingWork,
  type LocalInvitationRow,
} from "./db/repo-v4";
import { EMPTY_PENDING, type PendingWorkSummary } from "./core/project-switch";
import {
  discoverProjects,
  downloadProject,
  switchProject,
  synchronise,
  type SwitchProjectResult,
  type SyncOutcome,
} from "./sync/engine";

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
  /** The active project (protocol v4). The one thing every screen reads its scope from. */
  readonly workPack: WorkPack | null;
  /**
   * The survey half in v3's shape, which is what `AssignmentScreen` and `SurveyScreen` read.
   *
   * An adapter rather than a rewrite: those two screens are where every answer this product has
   * ever collected was typed, and changing them to speak v4 would be risk taken for no gain.
   * `null` when the project has no survey work — and then no campaign appears, which is the
   * point: a closed campaign must not look like today's.
   */
  readonly pack: FieldPack | null;
  readonly assignments: ReadonlyArray<LocalAssignmentRow>;
  readonly invitations: ReadonlyArray<LocalInvitationRow>;
  readonly pending: number;
  readonly pendingWork: PendingWorkSummary;
  readonly lastSyncAt: string | null;
  readonly online: boolean;
  readonly syncing: boolean;
  readonly lastOutcome: SyncOutcome | null;
  readonly offlineState: OfflineAccessState | null;
  readonly openError: string | null;
  readonly refresh: () => Promise<void>;
  readonly sync: () => Promise<void>;
  readonly discover: () => Promise<
    | { readonly ok: true; readonly projects: ReadonlyArray<FieldProjectWithWork> }
    | { readonly ok: false; readonly message: string }
  >;
  /** The first pack on a device that holds none. Changing road is `switchTo`. */
  readonly adopt: (scope: {
    tenantSlug: string;
    projectSlug: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  readonly switchTo: (scope: {
    tenantSlug: string;
    projectSlug: string;
  }) => Promise<SwitchProjectResult>;
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
  const [workPack, setWorkPack] = useState<WorkPack | null>(null);
  const [pack, setPack] = useState<FieldPack | null>(null);
  const [assignments, setAssignments] = useState<ReadonlyArray<LocalAssignmentRow>>([]);
  const [invitations, setInvitations] = useState<ReadonlyArray<LocalInvitationRow>>([]);
  const [pending, setPending] = useState(0);
  const [pendingWork, setPendingWork] = useState<PendingWorkSummary>(EMPTY_PENDING);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<SyncOutcome | null>(null);

  const readAll = useCallback(async (handle: SQLite.SQLiteDatabase) => {
    /*
     * `ensureWorkPack` rather than `readWorkPack`: a handset that was in the field when the
     * application was updated holds a v3 pack and no v4 one, and converting it here is what
     * lets the technician keep working instead of being sent to find a signal.
     */
    setWorkPack(await ensureWorkPack(handle));
    // The v3 view the survey screens read. `null` when the project has no survey work, because
    // `saveWorkPack` clears `field_pack` in that case rather than leaving a closed campaign.
    setPack(await readPack(handle));
    setAssignments(await listAssignments(handle));
    setInvitations(await listInvitations(handle));
    setPending(await countPending(handle));
    setPendingWork(await summarisePendingWork(handle));
    setLastSyncAt((await readCursor(handle))?.lastSyncAt ?? null);
  }, []);

  const refresh = useCallback(async () => {
    if (!db) return;
    await readAll(db);
  }, [db, readAll]);

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
        await readAll(opened);
      } catch (error: unknown) {
        if (!cancelled) {
          setOpenError(error instanceof Error ? error.message : "no se pudo abrir la base local");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `readAll` is stable (`useCallback` with no dependencies); listing it would not change when
    // this runs, and the open must happen exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const discover = useCallback(async () => {
    if (!db) return { ok: false as const, message: "la base local no está abierta" };
    return discoverProjects(db);
  }, [db]);

  const adopt = useCallback(
    async (scope: { tenantSlug: string; projectSlug: string }) => {
      if (!db) return { ok: false, message: "la base local no está abierta" };
      const result = await downloadProject(db, scope);
      await refresh();
      return result.ok ? { ok: true } : { ok: false, message: result.message };
    },
    [db, refresh],
  );

  const switchTo = useCallback(
    async (scope: { tenantSlug: string; projectSlug: string }): Promise<SwitchProjectResult> => {
      if (!db) return { kind: "failed", message: "la base local no está abierta" };
      const result = await switchProject(db, scope, { online });
      await refresh();
      return result;
    },
    [db, online, refresh],
  );

  /**
   * The offline window comes from the **active project**, never from a pack left behind.
   *
   * `workPack.validity` and not `pack.validity`: on a socialization-only project there is no
   * `field_pack` at all, and reading one would make the application believe its access had
   * lapsed — or, worse, that an old project's window was still in force.
   */
  const offlineState = useMemo<OfflineAccessState | null>(
    () =>
      workPack
        ? offlineAccessState({ now: new Date(), expiresAt: new Date(workPack.validity.expiresAt) })
        : null,
    [workPack],
  );

  const value = useMemo<FieldState>(
    () => ({
      db,
      workPack,
      pack,
      assignments,
      invitations,
      pending,
      pendingWork,
      lastSyncAt,
      online,
      syncing,
      lastOutcome,
      offlineState,
      openError,
      refresh,
      sync,
      discover,
      adopt,
      switchTo,
    }),
    [
      db,
      workPack,
      pack,
      assignments,
      invitations,
      pending,
      pendingWork,
      lastSyncAt,
      online,
      syncing,
      lastOutcome,
      offlineState,
      openError,
      refresh,
      sync,
      discover,
      adopt,
      switchTo,
    ],
  );

  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
}
