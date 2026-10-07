"use client";

import type {
  EligibleTechnician,
  InvitationCandidate,
  SocializationEventDetail,
} from "@eia/application";
import { SOCIALIZATION_INVITATION_PRESENTATION } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import {
  generateInvitationsAction,
  reassignInvitationAction,
  transitionEventAction,
} from "@/lib/field-work-actions";

import styles from "./field-work.module.css";

/**
 * One convocation: who has been invited, who is delivering, and what happened at each gate.
 *
 * ## The two halves, and why they are separate
 *
 * Above, the invitations that exist — with their attempts nested under them rather than listed
 * beside them, because an attempt is only meaningful as *an attempt at this invitation*. Below,
 * the parcels that could still be invited, each with the technician who surveyed it **offered**
 * and not applied: nothing is written until somebody confirms, because a product that quietly
 * handed a day's walking to whoever surveyed the parcel last month is deciding a person's week.
 *
 * The event's own logistics are not editable here once an invitation exists. That is not a
 * missing form — it is the rule (ADR-041): somebody has been told a date.
 */
export function SocializationEventSurface({
  tenant,
  project,
  event,
  candidates,
  technicians,
  listPath,
  invitationPrintBase,
}: {
  tenant: string;
  project: string;
  event: SocializationEventDetail;
  candidates: ReadonlyArray<InvitationCandidate>;
  technicians: ReadonlyArray<EligibleTechnician>;
  listPath: string;
  /** A prefix rather than a function: a server component cannot hand a client one a callback. */
  invitationPrintBase: string;
}) {
  const { t, fmt } = useI18n();
  const formId = useId();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const invitable = useMemo(() => candidates.filter((c) => !c.alreadyInvited), [candidates]);
  const chosen = useMemo(
    () =>
      invitable
        .filter((c) => (selected[c.parcelId] ?? "") !== "")
        .map((c) => ({
          parcelId: c.parcelId,
          assigneeMembershipId: selected[c.parcelId]!,
          recipientLabel: (labels[c.parcelId] ?? "").trim() === "" ? null : labels[c.parcelId]!,
        })),
    [invitable, selected, labels],
  );

  const run = (act: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await act();
      if (!result.ok) setError(result.error ?? "");
      else setMessage(result.message ?? "");
    });
  };

  const frozen = event.invitations > 0;

  return (
    <div className={styles.surface}>
      <Panel>
        <PanelHeader label={event.title} note={event.purpose ?? undefined} />
        <PanelBody>
          <p className={styles.muted} data-testid="socialization-when">
            {fmt.dateTime(event.startsAt)} · {event.timezone} · {event.locationLabel}
          </p>
          {frozen ? (
            <p className={styles.help} data-testid="socialization-frozen">
              {t("field.socializations.frozen")}
            </p>
          ) : null}
          <div className={styles.counters}>
            <Counter label={t("field.socializations.counters")} value={event.invitations} />
            <Counter label={t("field.socializations.delivered")} value={event.delivered} />
            <Counter label={t("field.socializations.pending")} value={event.pending} />
            <Counter label={t("field.socializations.refused")} value={event.refused} />
            <Counter label={t("field.socializations.cancelledCount")} value={event.cancelled} />
            <Counter label={t("field.socializations.attempts")} value={event.attempts} />
          </div>
          <p className={styles.help}>{t("field.socializations.attemptsHelp")}</p>

          <div className={styles.controls}>
            {event.status === "DRAFT" ? (
              <button
                className={styles.secondary}
                data-testid="socialization-schedule"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    transitionEventAction({
                      tenant,
                      project,
                      eventId: event.eventId,
                      to: "SCHEDULED",
                      reason: null,
                    }),
                  )
                }
                type="button"
              >
                {t("field.socializations.schedule")}
              </button>
            ) : null}
            {event.status === "SCHEDULED" ? (
              <button
                className={styles.secondary}
                data-testid="socialization-complete"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    transitionEventAction({
                      tenant,
                      project,
                      eventId: event.eventId,
                      to: "COMPLETED",
                      reason: null,
                    }),
                  )
                }
                type="button"
              >
                {t("field.socializations.complete")}
              </button>
            ) : null}
          </div>

          {event.status === "DRAFT" || event.status === "SCHEDULED" ? (
            <>
              <label className={styles.field} htmlFor={`${formId}-reason`}>
                {t("field.socializations.cancelReason")}
                <input
                  className={styles.input}
                  data-testid="socialization-cancel-reason"
                  id={`${formId}-reason`}
                  maxLength={400}
                  onChange={(e) => setReason(e.target.value)}
                  value={reason}
                />
              </label>
              <button
                className={styles.secondary}
                data-testid="socialization-cancel"
                disabled={pending || reason.trim().length < 8}
                onClick={() =>
                  run(() =>
                    transitionEventAction({
                      tenant,
                      project,
                      eventId: event.eventId,
                      to: "CANCELLED",
                      reason: reason.trim(),
                    }),
                  )
                }
                type="button"
              >
                {t("field.socializations.cancel")}
              </button>
            </>
          ) : null}
          <p className={styles.muted}>
            <Link className={styles.link} href={listPath}>
              {t("field.socializations.title")}
            </Link>
          </p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          label={t("field.socializations.invitations")}
          note={t("field.socializations.invitationsLead")}
        />
        <PanelBody>
          {event.invitationRows.map((row) => (
            <div className={styles.row} data-testid="invitation-row" key={row.invitationId}>
              <div>
                <span className={styles.parcel}>{row.parcelCode}</span>{" "}
                <span aria-hidden="true">
                  {SOCIALIZATION_INVITATION_PRESENTATION[row.status].glyph}
                </span>{" "}
                <span className={styles.muted}>
                  {row.assigneeName ?? ""}
                  {row.recipientLabel === null ? "" : ` · ${row.recipientLabel}`}
                </span>
                {row.attempts.length > 0 ? (
                  <ul className={styles.attempts}>
                    {row.attempts.map((a) => (
                      <li className={styles.attempt} key={a.attemptId}>
                        {a.outcome} · {fmt.dateTime(a.occurredAt)} · {a.technicianName ?? ""} ·{" "}
                        {a.hasEvidence
                          ? t("field.socializations.evidenceYes")
                          : t("field.socializations.evidenceNo")}
                        {a.note === null ? "" : ` · ${a.note}`}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className={styles.controls}>
                <Link
                  className={styles.link}
                  href={`${invitationPrintBase}/${row.invitationId}/print`}
                  target="_blank"
                >
                  {t("field.socializations.print")}
                </Link>
                {row.status === "PENDING" ? (
                  <select
                    className={styles.select}
                    aria-label={t("field.socializations.filterByTechnician")}
                    data-testid="invitation-reassign"
                    disabled={pending}
                    onChange={(e) =>
                      run(() =>
                        reassignInvitationAction({
                          tenant,
                          project,
                          invitationId: row.invitationId,
                          assigneeMembershipId: e.target.value,
                        }),
                      )
                    }
                    value={row.assigneeMembershipId}
                  >
                    {technicians.map((tech) => (
                      <option key={tech.membershipId} value={tech.membershipId}>
                        {tech.name ?? tech.email}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          ))}
        </PanelBody>
      </Panel>

      {event.status === "DRAFT" || event.status === "SCHEDULED" ? (
        <Panel>
          <PanelHeader label={t("field.socializations.selectParcels")} />
          <PanelBody>
            {invitable.map((candidate) => (
              <div
                className={styles.row}
                data-testid="invitation-candidate"
                key={candidate.parcelId}
              >
                <div>
                  <span className={styles.parcel}>{candidate.parcelCode}</span>{" "}
                  <span className={styles.muted}>
                    {candidate.surveyed ? t("field.socializations.surveyed") : ""}
                  </span>
                  <div className={styles.help}>
                    {candidate.suggestedName === null
                      ? t("field.socializations.noSuggestion")
                      : t("field.socializations.suggested", { name: candidate.suggestedName })}
                  </div>
                </div>
                <div className={styles.controls}>
                  <select
                    aria-label={t("field.assignments.technician")}
                    className={styles.select}
                    data-testid="candidate-technician"
                    disabled={pending}
                    onChange={(e) =>
                      setSelected((s) => ({ ...s, [candidate.parcelId]: e.target.value }))
                    }
                    value={selected[candidate.parcelId] ?? candidate.suggestedMembershipId ?? ""}
                  >
                    <option value="">{t("field.assignments.choose")}</option>
                    {technicians.map((tech) => (
                      <option key={tech.membershipId} value={tech.membershipId}>
                        {tech.name ?? tech.email}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={t("field.socializations.recipient")}
                    className={styles.input}
                    data-testid="candidate-recipient"
                    disabled={pending}
                    maxLength={160}
                    onChange={(e) =>
                      setLabels((l) => ({ ...l, [candidate.parcelId]: e.target.value }))
                    }
                    placeholder={t("field.socializations.recipient")}
                    value={labels[candidate.parcelId] ?? ""}
                  />
                </div>
              </div>
            ))}
            <p className={styles.help}>{t("field.socializations.recipientHelp")}</p>
            <button
              className={styles.primary}
              data-testid="socialization-generate"
              disabled={pending || chosen.length === 0}
              onClick={() =>
                run(async () => {
                  const result = await generateInvitationsAction({
                    tenant,
                    project,
                    eventId: event.eventId,
                    parcels: chosen,
                  });
                  if (result.ok) setSelected({});
                  return result;
                })
              }
              type="button"
            >
              {t("field.socializations.generate")}
            </button>
          </PanelBody>
        </Panel>
      ) : null}

      {message ? (
        <p className={styles.ok} data-testid="socialization-ok" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} data-testid="socialization-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.counter}>
      <span className={styles.counterValue}>{value}</span>
      <span className={styles.counterLabel}>{label}</span>
    </div>
  );
}
