"use client";

import type { AssignmentBoard, EligibleTechnician } from "@eia/application";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { assignParcelAction, reassignAssignmentAction } from "@/lib/field-work-actions";

import styles from "./field-work.module.css";

/**
 * Who surveys each parcel.
 *
 * One row per parcel of the project, assigned or not, because the unassigned one is the
 * interesting case. The control is a select and a button and nothing more: there is no "assign
 * all", no suggestion and no automatic split, and the absence is the design — a planner that
 * distributed 141 parcels by itself would be deciding people's weeks with nobody accountable for
 * the decision.
 *
 * A row whose work has started shows **why** it cannot move rather than hiding the control:
 * "there is already a visit or a response; correcting what was captured is a revisit". A
 * disabled control that explains nothing teaches people the product is broken.
 */
export function AssignmentBoardSurface({
  tenant,
  project,
  board,
  technicians,
}: {
  tenant: string;
  project: string;
  board: AssignmentBoard;
  technicians: ReadonlyArray<EligibleTechnician>;
}) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (act: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await act();
      if (!result.ok) setError(result.error ?? "");
      else setMessage(result.message ?? "");
    });
  };

  return (
    <div className={styles.surface}>
      <Panel>
        <PanelHeader label={t("field.assignments.title")} note={t("field.assignments.lead")} />
        <PanelBody>
          <p className={styles.muted}>
            {board.campaignName} · {board.campaignStatus}
          </p>

          {board.rows.map((row) => {
            const selected = choice[row.parcelId] ?? row.assigneeMembershipId ?? "";
            return (
              <div className={styles.row} data-testid="assignment-row" key={row.parcelId}>
                <div>
                  <span className={styles.parcel}>{row.parcelCode}</span>{" "}
                  <span className={styles.muted}>
                    {row.assigneeName ?? t("field.assignments.unassigned")}
                  </span>
                  {row.workStarted ? (
                    <div className={styles.help}>{t("field.assignments.workStartedHelp")}</div>
                  ) : null}
                </div>
                <div className={styles.controls}>
                  <label className={styles.help} htmlFor={`tech-${row.parcelId}`}>
                    {t("field.assignments.technician")}
                  </label>
                  <select
                    className={styles.select}
                    data-testid="assignment-technician"
                    disabled={pending || row.workStarted}
                    id={`tech-${row.parcelId}`}
                    onChange={(e) => setChoice((c) => ({ ...c, [row.parcelId]: e.target.value }))}
                    value={selected}
                  >
                    <option value="">{t("field.assignments.choose")}</option>
                    {technicians.map((tech) => (
                      <option key={tech.membershipId} value={tech.membershipId}>
                        {tech.name ?? tech.email} ·{" "}
                        {t("field.assignments.openCount", { count: String(tech.openAssignments) })}
                      </option>
                    ))}
                  </select>
                  <button
                    className={styles.secondary}
                    data-testid="assignment-save"
                    disabled={pending || row.workStarted || selected === ""}
                    onClick={() =>
                      run(() =>
                        row.assignmentId === null
                          ? assignParcelAction({
                              tenant,
                              project,
                              campaignId: board.campaignId,
                              parcelId: row.parcelId,
                              assigneeMembershipId: selected,
                            })
                          : reassignAssignmentAction({
                              tenant,
                              project,
                              assignmentId: row.assignmentId,
                              assigneeMembershipId: selected,
                            }),
                      )
                    }
                    type="button"
                  >
                    {row.assignmentId === null
                      ? t("field.assignments.assign")
                      : t("field.assignments.reassign")}
                  </button>
                </div>
              </div>
            );
          })}

          {message ? (
            <p className={styles.ok} data-testid="assignment-ok" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className={styles.error} data-testid="assignment-error" role="alert">
              {error}
            </p>
          ) : null}
        </PanelBody>
      </Panel>
    </div>
  );
}
