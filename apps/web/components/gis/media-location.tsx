"use client";

import { useState } from "react";

import { readMediaLocationAction } from "@/lib/field-actions";

import styles from "./parcel-workspace.module.css";

/**
 * *Ver ubicación* — where one photograph was taken, asked for one photograph at a time.
 *
 * ## Why it is a control and not a column
 *
 * `loadParcelMedia` returns whether a photograph carries a point and deliberately never the point:
 * a coordinate in a table is a coordinate in a screenshot, and this one is a person's position at
 * a moment. The reader who needs it asks, the reading is audited, and the row-level policy on
 * `field_media` — the same door that opens the photograph itself — decides. A GIS specialist or a
 * reader holding `quality.read` and not `field.responses.read` gets the same refusal here as they
 * get for the image.
 *
 * It is never a map layer. ADR-032 §3 keeps field media off the general map, and a point is the
 * part of a photograph easiest to put there by accident.
 *
 * ## What it is careful to say
 *
 * Two instants, not one. The device persists the photograph at the shutter and asks the platform
 * for a position afterwards, with a bounded wait, so the gap between them is the normal case; a
 * surface that showed one time would imply a simultaneity the data does not claim. And the caveat
 * is part of the disclosure rather than a footnote: a satellite fix from a handset is where the
 * *device* reckoned it was, not a certification of the place, and never a household's address.
 */
export interface MediaLocationLabels {
  readonly reveal: string;
  readonly reading: string;
  readonly coordinates: string;
  readonly accuracy: string;
  readonly measuredAt: string;
  readonly capturedAt: string;
  readonly none: string;
  readonly caveat: string;
}

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | {
      readonly kind: "read";
      readonly latitude: number | null;
      readonly longitude: number | null;
      readonly accuracyM: number | null;
      readonly locatedAt: string | null;
      readonly capturedAt: string;
    }
  | { readonly kind: "refused"; readonly error: string };

export function MediaLocation({
  tenant,
  project,
  mediaId,
  labels,
}: {
  readonly tenant: string;
  readonly project: string;
  readonly mediaId: string;
  readonly labels: MediaLocationLabels;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const reveal = async () => {
    setState({ kind: "reading" });
    const result = await readMediaLocationAction({ tenant, project, mediaId });
    if (!result.ok) {
      setState({ kind: "refused", error: result.error });
      return;
    }
    setState({
      kind: "read",
      latitude: result.latitude,
      longitude: result.longitude,
      accuracyM: result.accuracyM,
      locatedAt: result.locatedAt,
      capturedAt: result.capturedAt,
    });
  };

  if (state.kind === "idle") {
    return (
      <button type="button" className={styles.linkButton} onClick={reveal}>
        {labels.reveal}
      </button>
    );
  }
  if (state.kind === "reading") return <span className={styles.visitNote}>{labels.reading}</span>;
  if (state.kind === "refused") return <span className={styles.visitNote}>{state.error}</span>;

  if (state.latitude === null || state.longitude === null) {
    return <span className={styles.visitNote}>{labels.none}</span>;
  }

  /*
   * Six decimals is about a tenth of a metre, which is finer than any handset measures and is the
   * conventional precision for a decimal degree. The accuracy beside it is what the platform
   * reported, so a reader can see that a point good to ±28 m is not a doorstep.
   */
  const latitude = state.latitude.toFixed(6);
  const longitude = state.longitude.toFixed(6);

  return (
    <span className={styles.visitNote}>
      <strong>{labels.coordinates.replace("{lat}", latitude).replace("{lon}", longitude)}</strong>
      {state.accuracyM !== null ? (
        <>
          {" · "}
          {labels.accuracy.replace("{m}", String(Math.round(state.accuracyM)))}
        </>
      ) : null}
      <br />
      {state.locatedAt !== null
        ? labels.measuredAt.replace("{when}", new Date(state.locatedAt).toLocaleString("es-EC"))
        : null}
      {state.locatedAt !== null ? " · " : null}
      {labels.capturedAt.replace("{when}", new Date(state.capturedAt).toLocaleString("es-EC"))}
      <br />
      <em>{labels.caveat}</em>
    </span>
  );
}
