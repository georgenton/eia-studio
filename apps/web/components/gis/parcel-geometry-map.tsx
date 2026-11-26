"use client";

import type { ParcelReferencePoint, ParcelSurroundings } from "@eia/application";
import { CANONICAL_SRID, type BasemapCatalogue } from "@eia/domain";
import { Map as MapLibreMap, ScaleControl } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/locale-provider";

import { crsLine, formatDegrees, formatMetres } from "./crs-line";

import {
  BasemapCredits,
  BasemapSwitcher,
  lockNorthUp,
  NorthIndicator,
  SHARED_MAP_OPTIONS,
  useBasemap,
  useLatest,
} from "./basemap-chrome";
import { ensureMapWorker, keepMapSized, removeMapFromTabOrder } from "./inert-map";

import "maplibre-gl/dist/maplibre-gl.css";

import styles from "./parcel-map.module.css";

/**
 * One parcel, **situated**: its outline over real ground, with the road segment and the
 * neighbouring parcels of the same delivery around it.
 *
 * ## What changed, and why it was wrong before
 *
 * This drew the parcel on a flat grey square. A polygon on an empty ground tells a reader its
 * shape and nothing else — not which side of the road it is on, not whether it backs onto the
 * river, not who is next to it. The Explorer had had a reference background for a while; the
 * detail, which is where somebody actually *looks* at a parcel, had never been given one.
 *
 * The background is the **same catalogue, the same attach/probe helpers and the same remembered
 * preference** as the Explorer (`basemap-chrome.tsx`), so there is one implementation and one
 * place where "the provider is not answering" is decided.
 *
 * ## What is drawn, bottom to top
 *
 * reference background · neighbouring parcels · road segment · this parcel.
 *
 * The parcel's fill is deliberately **thin** (0.35). It used to be 0.85, which was fine over grey
 * and hides the ground over imagery — and the ground is the entire point of this change. The
 * outline carries the shape; the fill only says which side of it is inside.
 *
 * ## Framing
 *
 * It opens on the **context** extent, not on the parcel's own: a parcel zoomed to fill its frame
 * is the grey square again with a photograph behind it. «Centrar predio» goes to the parcel
 * itself, and the two buttons are real buttons in the document, outside the `aria-hidden` canvas
 * (IG2-005).
 *
 * Attaching the background never moves the camera — it adds one raster layer underneath — so a
 * reader who has zoomed somewhere does not get pulled back when tiles arrive.
 */
const NEIGHBOUR_FILL = "#eef1f2";
const NEIGHBOUR_LINE = "#a6aeb4";

export function ParcelGeometryMap({
  geometry,
  bounds,
  surroundings,
  basemap,
  referencePoint,
  label,
}: {
  geometry: unknown;
  /** The parcel's own extent — where «Centrar predio» returns to. */
  bounds: readonly [number, number, number, number] | null;
  /** Null when the parcel has geometry but nothing was computed around it. */
  surroundings: ParcelSurroundings | null;
  basemap: BasemapCatalogue;
  /** A point inside the parcel, in both CRS, from PostGIS. Null when there is no geometry. */
  referencePoint: ParcelReferencePoint | null;
  label: string;
}) {
  const { t, fmt } = useI18n();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<InstanceType<typeof MapLibreMap> | null>(null);
  const [centre, setCentre] = useState<{ lon: number; lat: number } | null>(null);
  const basemapState = useBasemap(basemap);
  const applyRef = useLatest(basemapState.apply);
  const builtRef = useRef(false);

  const openingBounds = surroundings?.contextBounds ?? bounds;

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    ensureMapWorker();
    builtRef.current = false;

    const map = new MapLibreMap({
      container: node,
      // A local style, so the study's geometry is on screen without waiting for anybody's tiles
      // and the map has no third-party dependency it cannot survive losing.
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#eef1f2" } },
        ],
      },
      ...(openingBounds
        ? { bounds: [...openingBounds] as [number, number, number, number] }
        : { center: [0, 0] as [number, number], zoom: 1 }),
      fitBoundsOptions: { padding: 36 },
      ...SHARED_MAP_OPTIONS,
    });
    lockNorthUp(map);
    mapRef.current = map;
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    const stopSizing = keepMapSized(map, node);

    const publish = () => {
      const c = map.getCenter();
      setCentre({ lon: c.lng, lat: c.lat });
      const b = map.getBounds();
      node.dataset["mapView"] = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    };
    map.on("moveend", publish);
    map.on("idle", () => {
      publish();
      node.dataset["mapIdle"] = "true";
    });

    map.on("load", () => {
      removeMapFromTabOrder(map, node);
      map.resize();

      /*
       * The neighbours first, so they sit under everything else. They are context: an outline and
       * a code, no area, no status, no owner — the same layer and the same permission as the
       * parcel itself, so they disclose nothing the Explorer does not already show this caller.
       */
      const neighbours = surroundings?.neighbours ?? [];
      if (neighbours.length > 0) {
        map.addSource("neighbours", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: neighbours.map((n) => ({
              type: "Feature",
              geometry: n.geometry,
              properties: { parcelCode: n.parcelCode },
            })),
          } as never,
        });
        map.addLayer({
          id: "neighbours-fill",
          type: "fill",
          source: "neighbours",
          paint: { "fill-color": NEIGHBOUR_FILL, "fill-opacity": 0.3 },
        });
        map.addLayer({
          id: "neighbours-line",
          type: "line",
          source: "neighbours",
          paint: { "line-color": NEIGHBOUR_LINE, "line-width": 0.8 },
        });
      }

      // The road, clipped to this neighbourhood by the read model. A *segment*, and the caption
      // says so rather than implying the road ends where the box does.
      if (surroundings?.alignmentSegment) {
        map.addSource("alignment", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: surroundings.alignmentSegment,
            properties: {},
          } as never,
        });
        map.addLayer({
          id: "alignment-halo",
          type: "line",
          source: "alignment",
          paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.75 },
        });
        map.addLayer({
          id: "alignment-line",
          type: "line",
          source: "alignment",
          paint: { "line-color": "#17506b", "line-width": 2.4 },
        });
      }

      map.addSource("parcel", {
        type: "geojson",
        data: { type: "Feature", geometry, properties: {} } as never,
      });
      map.addLayer({
        id: "parcel-fill",
        type: "fill",
        source: "parcel",
        // Thin on purpose: the ground underneath is the reason this map exists.
        paint: { "fill-color": "#dcede3", "fill-opacity": 0.35 },
      });
      map.addLayer({
        id: "parcel-halo",
        type: "line",
        source: "parcel",
        paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.8 },
      });
      map.addLayer({
        id: "parcel-line",
        type: "line",
        source: "parcel",
        paint: { "line-color": "#2c6046", "line-width": 2.2 },
      });

      node.dataset["mapReady"] = "true";
      publish();
      builtRef.current = true;
      applyRef.current(map, node);
    });

    return () => {
      builtRef.current = false;
      delete node.dataset["mapReady"];
      delete node.dataset["mapIdle"];
      delete node.dataset["mapView"];
      delete node.dataset["basemapMode"];
      stopSizing();
      map.remove();
      mapRef.current = null;
    };
    // `geometry` and `surroundings` identify the parcel: navigating between two parcels rebuilds
    // the map, which is what makes the detail independent of having visited the Explorer first.
  }, [geometry, surroundings, openingBounds, applyRef]);

  /*
   * The background, attached after the project rather than with it — so the geometry is on screen
   * without waiting for tiles, and changing the background re-fetches nothing of the parcel.
   */
  useEffect(() => {
    const map = mapRef.current;
    const node = container.current;
    if (!map || !node || !builtRef.current) return;
    return basemapState.apply(map, node);
  }, [basemapState]);

  const frame = useCallback((box: readonly [number, number, number, number] | null) => {
    const map = mapRef.current;
    if (!map || !box) return;
    map.fitBounds([...box] as [number, number, number, number], {
      padding: 36,
      duration: 420,
    });
  }, []);

  const zoomBy = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + delta, duration: 220 });
  }, []);

  return (
    <div className={styles.wrap}>
      <div
        aria-hidden="true"
        className={styles.canvas}
        data-testid="parcel-detail-map"
        ref={container}
      />
      <NorthIndicator testId="parcel-detail-north" />
      {/*
        Real buttons, in the document, outside the `aria-hidden` canvas (IG2-005). A control
        inside that subtree is one a keyboard can reach and a screen reader cannot announce.
      */}
      <div className={styles.detailControls}>
        <div className={styles.zoomPair}>
          <button
            className={styles.zoomButton}
            data-testid="parcel-detail-zoom-in"
            onClick={() => zoomBy(1)}
            type="button"
          >
            <span aria-hidden="true">+</span>
            <span className={styles.srOnly}>{t("parcel.zoomIn")}</span>
          </button>
          <button
            className={styles.zoomButton}
            data-testid="parcel-detail-zoom-out"
            onClick={() => zoomBy(-1)}
            type="button"
          >
            <span aria-hidden="true">−</span>
            <span className={styles.srOnly}>{t("parcel.zoomOut")}</span>
          </button>
        </div>
        <button
          className={styles.recentre}
          data-testid="parcel-detail-centre"
          onClick={() => frame(bounds)}
          type="button"
        >
          {t("parcel.centreParcel")}
        </button>
        {surroundings ? (
          <button
            className={styles.recentre}
            data-testid="parcel-detail-surroundings"
            onClick={() => frame(surroundings.contextBounds)}
            type="button"
          >
            {t("parcel.seeSurroundings")}
          </button>
        ) : null}
        <BasemapSwitcher
          catalogue={basemap}
          id="parcel-detail-basemap"
          noticeTestId="parcel-detail-basemap-unavailable"
          state={basemapState}
        />
      </div>
      <BasemapCredits
        catalogue={basemap}
        state={basemapState}
        testId="parcel-detail-basemap-credits"
      />
      <p className={styles.srOnly}>{t("parcel.mapIsVisual", { code: label })}</p>
      <div className={styles.detailFooter}>
        <p className={styles.detailNote}>
          {surroundings?.alignmentSegment
            ? t("parcel.mapShowsSegment")
            : t("parcel.mapShowsNoSegment")}
          {surroundings && surroundings.neighbours.length > 0
            ? ` ${t("parcel.mapShowsNeighbours", { count: fmt.count(surroundings.neighbours.length) })}`
            : ""}
          {surroundings?.neighboursTruncated ? ` ${t("parcel.mapNeighboursPartial")}` : ""}
        </p>
        <div className={styles.detailCoordsBlock}>
          {/*
            The coordinate system, named. A pair of numbers beside a map is something a consultant
            will type into a GPS, and *which* system they are in is the half that decides whether
            they arrive. The description is derived from the EPSG code, which the note says.
          */}
          <p className={styles.detailCoords} data-testid="parcel-detail-crs">
            {t("gis.crsShown")}: {crsLine(CANONICAL_SRID, t)}
            {referencePoint
              ? ` · ${t("gis.crsMeasured")}: ${crsLine(referencePoint.analysisSrid, t)}`
              : ""}
          </p>
          {centre ? (
            <p className={styles.detailCoords} data-testid="parcel-detail-centre-coords">
              {t("gis.coordinatesCentre")}: {formatDegrees(centre.lat)} ·{" "}
              {formatDegrees(centre.lon)}
            </p>
          ) : null}
          {referencePoint ? (
            <p className={styles.detailCoords} data-testid="parcel-detail-parcel-coords">
              {t("gis.coordinatesParcel", { code: label })}: {formatDegrees(referencePoint.lat)} ·{" "}
              {formatDegrees(referencePoint.lon)} · E {formatMetres(referencePoint.easting)} · N{" "}
              {formatMetres(referencePoint.northing)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
