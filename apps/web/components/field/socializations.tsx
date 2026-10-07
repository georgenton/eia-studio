"use client";

import type { SocializationEventSummary } from "@eia/application";
import { SOCIALIZATION_EVENT_PRESENTATION } from "@eia/domain";
import { EmptyState, Panel, PanelBody, PanelHeader } from "@eia/ui";
import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { createEventAction } from "@/lib/field-work-actions";

import styles from "./field-work.module.css";

/**
 * The convocations of one road, and the form that makes another.
 *
 * The counters beside each event count **invitations** — delivered, pending, refused — with
 * attempts shown apart and labelled as what they are. That separation is the one thing this
 * screen must not blur: three visits to one gate are one invitee, and a single figure mixing the
 * two would answer neither "how many households were convened?" nor "how much walking was done?"
 */
export function SocializationsSurface({
  tenant,
  project,
  events,
  basePath,
  defaultTimezone,
}: {
  tenant: string;
  project: string;
  events: ReadonlyArray<SocializationEventSummary>;
  basePath: string;
  defaultTimezone: string;
}) {
  const { t, fmt } = useI18n();
  const formId = useId();
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [locationLabel, setLocationLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await createEventAction({
        tenant,
        project,
        title: title.trim(),
        purpose: purpose.trim() === "" ? null : purpose.trim(),
        // A local datetime from the browser, sent with the zone the firm works in beside it.
        startsAt: new Date(startsAt).toISOString(),
        timezone,
        locationLabel: locationLabel.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message);
      setTitle("");
      setPurpose("");
      setStartsAt("");
      setLocationLabel("");
    });
  };

  return (
    <div className={styles.surface}>
      <Panel>
        <PanelHeader
          label={t("field.socializations.title")}
          note={t("field.socializations.lead")}
        />
        <PanelBody>
          {events.length === 0 ? (
            <EmptyState title={t("field.socializations.noEvents")} />
          ) : (
            events.map((event) => (
              <div className={styles.row} data-testid="socialization-event" key={event.eventId}>
                <div>
                  <Link className={styles.link} href={`${basePath}/${event.eventId}`}>
                    {event.title}
                  </Link>
                  <div className={styles.muted}>
                    <span aria-hidden="true">
                      {SOCIALIZATION_EVENT_PRESENTATION[event.status].glyph}
                    </span>{" "}
                    {fmt.dateTime(event.startsAt)} · {event.timezone} · {event.locationLabel}
                  </div>
                </div>
                <div className={styles.counters}>
                  <Counter label={t("field.socializations.counters")} value={event.invitations} />
                  <Counter label={t("field.socializations.delivered")} value={event.delivered} />
                  <Counter label={t("field.socializations.pending")} value={event.pending} />
                  <Counter label={t("field.socializations.refused")} value={event.refused} />
                  <Counter label={t("field.socializations.attempts")} value={event.attempts} />
                </div>
              </div>
            ))
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label={t("field.socializations.newEvent")} />
        <PanelBody>
          <label className={styles.field} htmlFor={`${formId}-title`}>
            {t("field.socializations.eventTitle")}
            <input
              className={styles.input}
              data-testid="socialization-title"
              id={`${formId}-title`}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              value={title}
            />
          </label>
          <label className={styles.field} htmlFor={`${formId}-starts`}>
            {t("field.socializations.startsAt")}
            <input
              className={styles.input}
              data-testid="socialization-starts-at"
              id={`${formId}-starts`}
              onChange={(e) => setStartsAt(e.target.value)}
              type="datetime-local"
              value={startsAt}
            />
          </label>
          <label className={styles.field} htmlFor={`${formId}-tz`}>
            {t("field.socializations.timezone")}
            <input
              className={styles.input}
              data-testid="socialization-timezone"
              id={`${formId}-tz`}
              maxLength={60}
              onChange={(e) => setTimezone(e.target.value)}
              value={timezone}
            />
          </label>
          <label className={styles.field} htmlFor={`${formId}-where`}>
            {t("field.socializations.location")}
            <input
              className={styles.input}
              data-testid="socialization-location"
              id={`${formId}-where`}
              maxLength={300}
              onChange={(e) => setLocationLabel(e.target.value)}
              value={locationLabel}
            />
          </label>
          <label className={styles.field} htmlFor={`${formId}-purpose`}>
            {t("field.socializations.purpose")}
            <textarea
              className={styles.textarea}
              data-testid="socialization-purpose"
              id={`${formId}-purpose`}
              maxLength={1000}
              onChange={(e) => setPurpose(e.target.value)}
              value={purpose}
            />
          </label>
          <button
            className={styles.primary}
            data-testid="socialization-create"
            disabled={
              pending || title.trim() === "" || startsAt === "" || locationLabel.trim() === ""
            }
            onClick={create}
            type="button"
          >
            {t("field.socializations.create")}
          </button>
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
        </PanelBody>
      </Panel>
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
