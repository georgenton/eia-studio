"use client";

import {
  BASEMAP_MODES,
  basemapSourceFor,
  resolveInitialBasemapMode,
  type BasemapCatalogue,
  type BasemapMode,
} from "@eia/domain";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { basemapModeLabel } from "@/lib/labels";

import { attachBasemap, detachBasemap, probeBasemap } from "./basemap-layer";

import styles from "./parcel-map.module.css";

/**
 * The reference background, as one thing both maps use.
 *
 * The Explorer grew this first: a remembered preference, a probe because MapLibre reports nothing
 * when a raster tile 404s, a failure that becomes "no background" rather than an empty ground, and
 * the switcher and attribution as real document elements outside the `aria-hidden` canvas. The
 * parcel detail needs **the same** behaviour, and a second copy of it would be a second thing to
 * keep in step — so the hook and the two controls live here and the two maps import them.
 *
 * Nothing about the project's layers is in here. The background attaches *below* them and the
 * study's geometry is never involved in losing, changing or never having one.
 */

/**
 * Remembering the chosen background, in this browser and nowhere else.
 *
 * `localStorage` because that is exactly what this is: one reader's preference about how they like
 * to look at a map. It is not project data, so it gets no column, no migration and no provenance
 * record — and it is **shared between the Explorer and the parcel detail on purpose**, so opening
 * a parcel from a satellite Explorer does not drop a reader onto a grey square.
 */
const BASEMAP_PREFERENCE_KEY = "eia.gis.basemap";

function readRememberedMode(): string | null {
  try {
    return window.localStorage.getItem(BASEMAP_PREFERENCE_KEY);
  } catch {
    return null;
  }
}

function rememberMode(mode: BasemapMode): void {
  try {
    window.localStorage.setItem(BASEMAP_PREFERENCE_KEY, mode);
  } catch {
    // A reader who blocks storage still gets to change the background; they just get the default
    // again next time. Losing a preference is not worth an error.
  }
}

export interface BasemapState {
  readonly mode: BasemapMode;
  readonly failed: boolean;
  /** What the map is actually showing, which is `none` whenever the provider could not answer. */
  readonly effectiveMode: BasemapMode;
  readonly choose: (mode: BasemapMode) => void;
  /**
   * Attach the background to a built map. Safe to call repeatedly; the caller runs it once the
   * map exists and again whenever this state changes.
   */
  readonly apply: (map: MapLibreMap, node: HTMLElement) => () => void;
}

export function useBasemap(catalogue: BasemapCatalogue): BasemapState {
  const [mode, setMode] = useState<BasemapMode>(() =>
    resolveInitialBasemapMode(catalogue, readRememberedMode()),
  );
  /** Set when the provider's tiles will not load: the ground goes neutral and says so. */
  const [failed, setFailed] = useState(false);

  const choose = useCallback((next: BasemapMode) => {
    setFailed(false);
    setMode(next);
    rememberMode(next);
  }, []);

  const apply = useCallback(
    (map: MapLibreMap, node: HTMLElement) => {
      const controller = new AbortController();
      void (async () => {
        const wanted = failed ? "none" : mode;
        /*
         * Ask before drawing. A tile that will not load is invisible to MapLibre — no error event,
         * no failed state, just a background that never appears — so the one request that settles
         * it is made here, and a provider that cannot answer becomes "no background" rather than
         * an unexplained empty ground.
         */
        const available =
          wanted === "none" ? false : await probeBasemap(map, catalogue, wanted, controller.signal);
        if (controller.signal.aborted) return;
        if (wanted !== "none" && !available) {
          detachBasemap(map);
          node.dataset["basemapMode"] = "none";
          setFailed(true);
          return;
        }
        const attached = attachBasemap(map, catalogue, wanted);
        node.dataset["basemapMode"] = attached ? wanted : "none";
      })();
      return () => controller.abort();
    },
    [catalogue, failed, mode],
  );

  return { mode, failed, effectiveMode: failed ? "none" : mode, choose, apply };
}

/**
 * Choosing the background.
 *
 * A real `<select>` in the document, **outside** the `aria-hidden` canvas — the same reason the
 * maps carry no MapLibre navigation control (IG2-005): a control inside that subtree is one a
 * keyboard can reach and a screen reader cannot announce.
 *
 * When nothing is configured the control still appears, with the unavailable backgrounds disabled
 * and one line saying what they need. That is a deliberate choice over hiding them: a consultancy
 * asking "can it show satellite?" should be able to see that the answer is yes and that this
 * deployment simply has no reference map switched on — a fact about configuration, not an error.
 */
export function BasemapSwitcher({
  catalogue,
  state,
  id,
  noticeTestId,
}: {
  catalogue: BasemapCatalogue;
  state: BasemapState;
  /** Unique per map, because two maps on one page would otherwise share a label's `for`. */
  id: string;
  /** The "provider is not answering" notice, named separately so existing tests keep their hook. */
  noticeTestId: string;
}) {
  const { t } = useI18n();
  const configured = catalogue.provider !== "none";
  return (
    <div className={styles.basemap}>
      <label className={styles.basemapLabel} htmlFor={id}>
        {t("gis.basemapLabel")}
      </label>
      <select
        className={styles.basemapSelect}
        data-testid={id}
        id={id}
        onChange={(event) => state.choose(event.target.value as BasemapMode)}
        value={state.effectiveMode}
      >
        {BASEMAP_MODES.map((option) => (
          <option disabled={!catalogue.modes.includes(option)} key={option} value={option}>
            {basemapModeLabel(t, option)}
          </option>
        ))}
      </select>
      {configured ? null : <p className={styles.basemapHint}>{t("gis.basemapNotConfigured")}</p>}
      {state.failed ? (
        // Deliberately not a live region. The canvas is `aria-hidden` and a background is purely
        // visual, so announcing its absence would interrupt a screen-reader user with news about
        // something they were never shown.
        <p className={styles.basemapHint} data-testid={noticeTestId}>
          {t("gis.basemapUnavailable")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The provider's attribution, and the line that keeps the two kinds of layer apart.
 *
 * Rendered by us rather than by MapLibre's own attribution control, for the same accessibility
 * reason as everything else here: the control lives inside the `aria-hidden` canvas, where its
 * links are unreachable. This is ordinary document text with ordinary links.
 *
 * It is never suppressed while a background is drawn — attribution is a condition of using the
 * tiles, not a decoration — and it names the background as *reference*, separately from the
 * study's own layer provenance, so nothing on screen invites a reader to mistake somebody else's
 * cartography for the study's.
 */
export function BasemapCredits({
  catalogue,
  state,
  testId = "basemap-credits",
}: {
  catalogue: BasemapCatalogue;
  state: BasemapState;
  testId?: string;
}) {
  const { t } = useI18n();
  const source = basemapSourceFor(catalogue, state.effectiveMode);
  if (!source) return null;
  return (
    <p className={styles.credits} data-testid={testId}>
      <span className={styles.creditsKind}>{t("gis.basemapCredits")}</span>
      {source.credits.map((credit) => (
        <span key={credit.label}>
          {" · "}
          {credit.href ? (
            <a href={credit.href} rel="noreferrer noopener" target="_blank">
              {credit.label}
            </a>
          ) : (
            credit.label
          )}
        </span>
      ))}
    </p>
  );
}

/**
 * North, drawn once and never turned.
 *
 * Both maps disable MapLibre's rotation handlers at construction, so this is a statement about
 * the map rather than a widget that tracks it. A fixed arrow on a map that can turn is a lie
 * waiting for somebody to ctrl-drag, and an arrow that followed the bearing would be a control
 * inside an `aria-hidden` canvas.
 */
export function NorthIndicator({ testId = "map-north" }: { testId?: string }) {
  return (
    <div aria-hidden="true" className={styles.north} data-testid={testId}>
      <svg viewBox="0 0 24 44" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 4 L17 15 L12 12 L7 15 Z" fill="currentColor" />
        <line stroke="currentColor" strokeWidth="1.5" x1="12" x2="12" y1="12" y2="30" />
      </svg>
      <span className={styles.northLabel}>N</span>
    </div>
  );
}

/** The MapLibre options both maps share: no rotation, no pitch, no attribution control. */
export const SHARED_MAP_OPTIONS = {
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  attributionControl: false,
} as const;

/** Touch rotation is a separate handler from the constructor options. */
export function lockNorthUp(map: MapLibreMap): void {
  map.touchZoomRotate.disableRotation();
}

/** A ref kept current without assigning during render (`react-hooks/refs`). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
