"use client";

import { Map as MapLibreMap, ScaleControl } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { ensureMapWorker, keepMapSized, removeMapFromTabOrder } from "./inert-map";

import "maplibre-gl/dist/maplibre-gl.css";

import styles from "./parcel-map.module.css";

/**
 * A single parcel drawn on its own. It shares the Explorer map's rule: local style only, and the
 * canvas is `aria-hidden` because the geometry carries no fact the surrounding ficha does not
 * already state in text.
 */
export function ParcelGeometryMap({
  geometry,
  bounds,
  label,
}: {
  geometry: unknown;
  bounds: readonly [number, number, number, number] | null;
  label: string;
}) {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    ensureMapWorker();

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
      fitBoundsOptions: { padding: 44 },
      attributionControl: false,
    });
    // No NavigationControl (IG2-005). It renders real buttons, and inside an `aria-hidden`
    // subtree those are controls a keyboard can reach but a screen reader cannot announce — so
    // they were being taken out of the tab order, which left visible buttons that only a mouse
    // could use. Scroll, drag and pinch still zoom; the scale bar is inert text, not a control.
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    const stopSizing = keepMapSized(map, node);

    map.on("load", () => {
      removeMapFromTabOrder(map, node);
      map.resize();
      map.addSource("parcel", {
        type: "geojson",
        data: { type: "Feature", geometry, properties: {} } as never,
      });
      map.addLayer({
        id: "parcel-fill",
        type: "fill",
        source: "parcel",
        paint: { "fill-color": "#dcede3", "fill-opacity": 0.85 },
      });
      map.addLayer({
        id: "parcel-line",
        type: "line",
        source: "parcel",
        paint: { "line-color": "#2c6046", "line-width": 2 },
      });
    });

    return () => {
      stopSizing();
      map.remove();
    };
  }, [geometry, bounds]);

  return (
    <div className={styles.wrap}>
      <div aria-hidden="true" className={styles.canvas} ref={container} />
      <p className={styles.srOnly}>Mapa del predio {label}. Los datos figuran en la ficha.</p>
    </div>
  );
}
