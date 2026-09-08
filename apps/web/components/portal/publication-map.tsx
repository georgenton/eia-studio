"use client";

import type { BasemapCatalogue, BasemapMode, ClientPublicationPayload } from "@eia/domain";
import {
  basemapSourceFor,
  geometryBounds,
  resolveInitialBasemapMode,
  unionBounds,
} from "@eia/domain";
import { Map as MapLibreMap, ScaleControl } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { attachBasemap, detachBasemap, probeBasemap } from "@/components/gis/basemap-layer";
import { ensureMapWorker, keepMapSized, removeMapFromTabOrder } from "@/components/gis/inert-map";

import "maplibre-gl/dist/maplibre-gl.css";

import styles from "./portal.module.css";

/**
 * The client's map.
 *
 * It draws two things and has no code path that could draw a third: the corridor the study
 * delimited, and the areas of influence it delimited around it — both from the **published
 * payload**, both already generalised. There is no parcel source, no parcel layer, no selection,
 * no table and no click handler, so "the client must not see parcels" is not a filter that could
 * be got wrong but a shape that has nowhere to put one.
 *
 * The reference background is the same infrastructure the internal map uses, and means the same
 * thing: geographic context, never project data. If the provider is unreachable the ground goes
 * neutral and the study's own geometry is unaffected — the hard invariant of the basemap wave.
 */
export function PublicationMap({
  territory,
  basemap,
}: {
  territory: ClientPublicationPayload["territory"];
  basemap: BasemapCatalogue;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<InstanceType<typeof MapLibreMap> | null>(null);
  const builtRef = useRef(false);
  const applyRef = useRef<(() => void) | null>(null);
  const [mode] = useState<BasemapMode>(() => resolveInitialBasemapMode(basemap, null));
  /** Set when the provider's tiles will not load: the ground goes neutral, silently and safely. */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    ensureMapWorker();

    /*
     * Where the camera opens: **on the corridor**, not on everything drawn.
     *
     * The indirect social area is about 22 by 28 kilometres — five times the study's own corridor
     * — so framing the union puts the road the client is asking about into a few dark pixels in
     * the middle of a grey blob. The areas are still drawn, and extend past the edge of the frame,
     * which is what context looks like. The Parcel Explorer made the same choice for the same
     * reason (TD-070).
     */
    const bounds =
      geometryBounds(territory.alignment?.geometry ?? null) ??
      unionBounds(territory.influenceAreas.map((area) => area.geometry));

    const map = new MapLibreMap({
      container: node,
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#eef1f2" } },
        ],
      },
      ...(bounds
        ? { bounds: [...bounds] as [number, number, number, number] }
        : { center: [0, 0] as [number, number], zoom: 1 }),
      fitBoundsOptions: { padding: 56 },
      attributionControl: false,
    });
    mapRef.current = map;
    const stopSizing = keepMapSized(map, node);
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      removeMapFromTabOrder(map, node);
      map.resize();

      if (territory.influenceAreas.length > 0) {
        map.addSource("influence", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: territory.influenceAreas.map((area) => ({
              type: "Feature",
              geometry: area.geometry,
              properties: { label: area.label },
            })),
          } as never,
        });
        map.addLayer({
          id: "influence-fill",
          type: "fill",
          source: "influence",
          paint: { "fill-color": "#4a7f9b", "fill-opacity": 0.1 },
        });
        map.addLayer({
          id: "influence-line",
          type: "line",
          source: "influence",
          paint: { "line-color": "#4a7f9b", "line-width": 1.2, "line-dasharray": [3, 2] },
        });
      }

      if (territory.alignment) {
        map.addSource("alignment", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: territory.alignment.geometry,
            properties: {},
          } as never,
        });
        map.addLayer({
          id: "alignment-halo",
          type: "line",
          source: "alignment",
          paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.75 },
        });
        map.addLayer({
          id: "alignment-line",
          type: "line",
          source: "alignment",
          paint: { "line-color": "#17506b", "line-width": 2.6 },
        });
      }

      builtRef.current = true;
      node.dataset["mapReady"] = "true";
      applyRef.current?.();
    });

    /*
     * What the camera can actually see, as data attributes.
     *
     * A canvas has no state a test can read, and "the component rendered" is not the same claim as
     * "the corridor is on screen" — the lesson of the empty-map defect this product already had
     * once. These count drawn features of the two layers this map has, and nothing else: the same
     * figures a viewer could read off the picture.
     */
    const publish = (): void => {
      node.dataset["alignmentInView"] = map.getLayer("alignment-line")
        ? String(map.queryRenderedFeatures({ layers: ["alignment-line"] }).length)
        : "0";
      node.dataset["areasInView"] = map.getLayer("influence-fill")
        ? String(map.queryRenderedFeatures({ layers: ["influence-fill"] }).length)
        : "0";
    };
    map.on("idle", () => {
      publish();
      node.dataset["mapIdle"] = "true";
    });

    return () => {
      stopSizing();
      builtRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, [territory]);

  useEffect(() => {
    const controller = new AbortController();
    const apply = async (): Promise<void> => {
      const map = mapRef.current;
      if (!map) return;
      if (mode === "none") {
        detachBasemap(map);
        return;
      }
      const usable = await probeBasemap(map, basemap, mode, controller.signal);
      if (controller.signal.aborted || !mapRef.current) return;
      setFailed(!usable);
      if (usable) attachBasemap(map, basemap, mode);
      else detachBasemap(map);
    };
    applyRef.current = () => void apply();
    if (builtRef.current) applyRef.current();
    return () => controller.abort();
  }, [basemap, mode]);

  const described =
    territory.alignment === null && territory.influenceAreas.length === 0
      ? "No se ha publicado cartografía del proyecto."
      : [
          territory.alignment ? `Trazado: ${territory.alignment.label}.` : null,
          territory.influenceAreas.length > 0
            ? `Áreas delimitadas: ${territory.influenceAreas.map((a) => a.label).join(", ")}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ");

  return (
    <figure className={styles.mapFigure}>
      <div aria-hidden="true" className={styles.mapCanvas} ref={container} />
      <figcaption className={styles.mapCaption}>
        <span className={styles.mapDescription}>{described}</span>
        <Credits basemap={basemap} failed={failed} mode={mode} />
      </figcaption>
    </figure>
  );
}

/**
 * The provider's attribution, shown exactly when its tiles are actually on screen.
 *
 * It is real text in the caption, outside the `aria-hidden` canvas, so a screen reader and a
 * printed page both reach it — and it names the background as *reference*, so nothing invites a
 * reader to mistake somebody else's cartography for the study's own.
 */
function Credits({
  basemap,
  failed,
  mode,
}: {
  basemap: BasemapCatalogue;
  failed: boolean;
  mode: BasemapMode;
}) {
  const source = failed ? null : basemapSourceFor(basemap, mode);
  if (!source) return null;
  return (
    <span className={styles.mapCredits} data-testid="portal-basemap-credits">
      Mapa de referencia
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
    </span>
  );
}
