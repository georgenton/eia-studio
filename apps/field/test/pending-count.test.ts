import { describe, expect, it } from "vitest";

import { countPendingWork, EMPTY_PENDING } from "../src/core/project-switch";
import { decideSignOut } from "../src/core/sign-out";

/**
 * What "Todo sincronizado" is allowed to mean.
 *
 * The chip on *Mi trabajo* counted `sync_outbox` rows in state PENDING. On the emulator, on
 * 19 November 2026, that produced the thing this test exists to prevent: the chip read
 * **Todo sincronizado** while the parcel itself still read *Predio · Pendiente de subida*. The
 * photograph was on the phone and the application said the day had been delivered.
 *
 * The sign-out guard had already been fixed to read the full summary, so the same device showed
 * two different answers at once — "4 elemento(s) sin sincronizar" in Ajustes and "Todo
 * sincronizado" on the list. One function now answers for both.
 */
describe("countPendingWork", () => {
  it("is zero only when every kind is zero", () => {
    expect(countPendingWork(EMPTY_PENDING)).toBe(0);
  });

  it("counts a photograph the server has not acknowledged", () => {
    expect(countPendingWork({ ...EMPTY_PENDING, pendingMedia: 1 })).toBe(1);
  });

  it("counts a draft that never produced a command", () => {
    expect(countPendingWork({ ...EMPTY_PENDING, unsyncedSurveys: 1 })).toBe(1);
  });

  it("counts a command that failed, which is not PENDING", () => {
    expect(countPendingWork({ ...EMPTY_PENDING, outboxFailed: 2 })).toBe(2);
  });

  it("adds every kind together", () => {
    const resumen = {
      ...EMPTY_PENDING,
      outboxPending: 2,
      unsyncedSurveys: 1,
      pendingMedia: 1,
    };
    expect(countPendingWork(resumen)).toBe(4);
  });

  /**
   * The shape of the emulator run: the outbox held 2, the device held 4. The chip said one thing
   * and the sign-out guard said the other. They must not be able to disagree again.
   */
  it("agrees with what the sign-out guard tells the technician", () => {
    const resumen = {
      ...EMPTY_PENDING,
      outboxPending: 2,
      unsyncedSurveys: 1,
      pendingMedia: 1,
    };
    const decision = decideSignOut(resumen);
    expect(decision.kind).toBe("blocked");
    if (decision.kind !== "blocked") return;
    expect(decision.total).toBe(countPendingWork(resumen));
  });

  /**
   * The fifth place, found on the emulator on 19 November 2026: the bottom bar read
   * *Sincronizar ahora (1)* on the same screen whose chip read *2 por sincronizar*, because the
   * badge counted `sync_outbox` and the chip counted everything. `App.tsx` now calls this
   * function, and this case says what that has to mean.
   */
  it("is what the tab bar badge must show, not the outbox alone", () => {
    const resumen = { ...EMPTY_PENDING, outboxPending: 1, unsyncedSurveys: 1 };
    expect(countPendingWork(resumen)).toBe(2);
    expect(countPendingWork(resumen)).not.toBe(resumen.outboxPending);
  });

  it("lets the chip read 'all synced' only when sign-out would also be allowed", () => {
    expect(countPendingWork(EMPTY_PENDING)).toBe(0);
    expect(decideSignOut(EMPTY_PENDING).kind).toBe("allowed");
  });
});
