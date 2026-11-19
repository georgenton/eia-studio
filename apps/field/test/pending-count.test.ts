import { describe, expect, it } from "vitest";

import { countPendingWork, EMPTY_PENDING, retryableNow } from "../src/core/project-switch";
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

/**
 * What may start a synchronisation on its own.
 *
 * The automatic trigger used to ask `countPendingWork`, which counts work that only a **person**
 * can clear. The attempt therefore ran, changed nothing, finished — and finishing re-ran it.
 * Measured on the emulator on 19 November 2026: one saved draft, an empty queue, and
 * *Sincronizando…* on screen with the last-sync time going from 17:51:41 to 17:52:31 in fifty
 * seconds that nobody touched the phone.
 *
 * These cases keep the two numbers apart: everything still shows and still blocks sign-out, and
 * only what a request could deliver may start one.
 */
describe("retryableNow", () => {
  it("is zero on a clean device", () => {
    expect(retryableNow(EMPTY_PENDING)).toBe(0);
  });

  /** Case 1 of the observation: a draft pending, nothing new that could be sent. */
  it("does not start a synchronisation for a draft nobody submitted", () => {
    const resumen = { ...EMPTY_PENDING, unsyncedSurveys: 1 };
    expect(retryableNow(resumen)).toBe(0);
    // …and it is still held, still shown, and still blocks sign-out.
    expect(countPendingWork(resumen)).toBe(1);
    expect(decideSignOut(resumen).kind).toBe("blocked");
  });

  /** Case 2: an order the server refused, which no amount of asking will change (TD-128). */
  it("does not start a synchronisation for an order the server refused", () => {
    const resumen = { ...EMPTY_PENDING, outboxFailed: 2 };
    expect(retryableNow(resumen)).toBe(0);
    expect(countPendingWork(resumen)).toBe(2);
    expect(decideSignOut(resumen).kind).toBe("blocked");
  });

  it("does not start one for a delivery that needs a person", () => {
    const resumen = { ...EMPTY_PENDING, unsettledDeliveries: 1 };
    expect(retryableNow(resumen)).toBe(0);
    expect(countPendingWork(resumen)).toBe(1);
  });

  /**
   * The half that must keep working: coming back into signal has to deliver a photograph whose
   * upload failed, which has no outbox row at all until its bytes are stored.
   */
  it("starts one for a photograph still on the phone", () => {
    expect(retryableNow({ ...EMPTY_PENDING, pendingMedia: 1 })).toBe(1);
    expect(retryableNow({ ...EMPTY_PENDING, pendingEvidence: 1 })).toBe(1);
    expect(retryableNow({ ...EMPTY_PENDING, outboxPending: 3 })).toBe(3);
  });

  it("never exceeds what the device is holding", () => {
    const resumen = {
      outboxPending: 2,
      outboxFailed: 1,
      unsyncedSurveys: 1,
      pendingMedia: 1,
      unsettledDeliveries: 1,
      pendingEvidence: 1,
    };
    expect(retryableNow(resumen)).toBe(4);
    expect(countPendingWork(resumen)).toBe(7);
    expect(retryableNow(resumen)).toBeLessThan(countPendingWork(resumen));
  });
});
