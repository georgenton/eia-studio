"use client";

import type { ParcelExplorerView } from "@eia/application";
import { PARCEL_STATUS_PRESENTATION, type ParcelStatus } from "@eia/domain";
// MapLibre v6 is pure ESM with named exports and no default export.
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  type ExpressionSpecification,
  type MapLayerMouseEvent,
  type MapMouseEvent,
} from "maplibre-gl";
import { useEffect, useRef } from "react";

import { ensureMapWorker, keepMapSized, removeMapFromTabOrder } from "./inert-map";

import "maplibre-gl/dist/maplibre-gl.css";

import styles from "./parcel-map.module.css";

/**
 * The project map. MapLibre is WebGL and touches `window`, so this is a client component and the
 * map is only ever constructed inside an effect — never during server rendering.
 *
 * ## What the map is, and is not
 *
 * It renders exactly the features the read model returned, which are the same rows the table
 * shows. It is a *view* of that data, not a second source: nothing is fetched here, no spatial
 * query leaves the browser, and no parcel exists on the map that is missing from the table. That
 * matters for accessibility (§26): a canvas cannot be made a screen-reader surface, so the table
 * is the semantic representation and the map must never hold a fact of its own.
 *
 * The base map is a plain graticule-free background rather than a third-party raster: the design
 * calls for hydrography and towns from a real base map, which the official GIS package has not
 * delivered. Drawing a decorative basemap and labelling it REAL BASE MAP would be a lie, so the
 * legend shows only the two layers we actually have.
 */
const STATUS_FILL: Record<ParcelStatus, string> = {
  confirmed: "#dcede3",
  estimated: "#f1f3f5",
  not_located: "#ffffff",
  excluded: "#f4f6f7",
};
const STATUS_LINE: Record<ParcelStatus, string> = {
  confirmed: "#2c6046",
  estimated: "#a6aeb4",
  not_located: "#8b959c",
  excluded: "#c8d0d6",
};

function statusExpression(map: Record<ParcelStatus, string>, fallback: string) {
  return [
    "match",
    ["get", "status"],
    ...Object.entries(map).flatMap(([status, value]) => [status, value]),
    fallback,
  ] as unknown as ExpressionSpecification;
}

export function ParcelMap({
  view,
  selectedParcelId,
  onSelect,
}: {
  view: ParcelExplorerView;
  selectedParcelId: string | null;
  onSelect: (parcelId: string | null) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<InstanceType<typeof MapLibreMap> | null>(null);
  const onSelectRef = useRef(onSelect);
  // The map is built once; the click handler it captures must still call the *current* callback,
  // so the ref is refreshed in an effect rather than during render.
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    ensureMapWorker();

    const map = new MapLibreMap({
      container: node,
      // No external tile provider: the style is local, so the map has no third-party dependency
      // and cannot silently present someone else's cartography as ours.
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#eef1f2" } },
        ],
      },
      ...(view.bounds
        ? { bounds: [...view.bounds] as [number, number, number, number] }
        : { center: [0, 0] as [number, number], zoom: 1 }),
      fitBoundsOptions: { padding: 48 },
      attributionControl: false,
    });
    mapRef.current = map;
    const stopSizing = keepMapSized(map, node);
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      removeMapFromTabOrder(map, node);
      map.resize();
      if (view.alignment) {
        map.addSource("alignment", {
          type: "geojson",
          data: { type: "Feature", geometry: view.alignment.geometry, properties: {} } as never,
        });
        // A dashed line, because the alignment is reconstructed and must not read as surveyed.
        map.addLayer({
          id: "alignment-halo",
          type: "line",
          source: "alignment",
          paint: { "line-color": "#c6d2d6", "line-width": 11, "line-opacity": 0.7 },
        });
        map.addLayer({
          id: "alignment-line",
          type: "line",
          source: "alignment",
          paint: { "line-color": "#17506b", "line-width": 2.6, "line-dasharray": [3, 2] },
        });
      }

      map.addSource("parcels", {
        type: "geojson",
        data: { type: "FeatureCollection", features: view.features } as never,
        promoteId: "parcelId",
      });
      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        paint: {
          "fill-color": statusExpression(STATUS_FILL, "#f1f3f5"),
          "fill-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "parcels-line",
        type: "line",
        source: "parcels",
        paint: {
          "line-color": statusExpression(STATUS_LINE, "#a6aeb4"),
          "line-width": 1,
        },
      });
      map.addLayer({
        id: "parcels-selected",
        type: "line",
        source: "parcels",
        paint: { "line-color": "#17506b", "line-width": 3 },
        filter: ["==", ["get", "parcelId"], ""],
      });
      map.getCanvas().setAttribute("aria-hidden", "true");
      node.dataset.mapReady = "true";
    });

    map.on("click", "parcels-fill", (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const parcelId = feature?.properties?.["parcelId"];
      if (typeof parcelId === "string") onSelectRef.current(parcelId);
    });
    map.on("click", (event: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(event.point, { layers: ["parcels-fill"] });
      if (hits.length === 0) onSelectRef.current(null);
    });
    map.on("mouseenter", "parcels-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "parcels-fill", () => {
      map.getCanvas().style.cursor = "";
    });

    return () => {
      delete node.dataset.mapReady;
      stopSizing();
      map.remove();
      mapRef.current = null;
    };
  }, [view]);

  // Selection is applied as a filter rather than a re-render: the map follows the one canonical
  // selection, and moving the viewport is deliberately restrained — it eases to the parcel only
  // when the parcel is off screen, so a reader's context is not yanked away on every click.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setFilter("parcels-selected", ["==", ["get", "parcelId"], selectedParcelId ?? ""]);
    if (!selectedParcelId) return;
    const feature = view.features.find((f) => f.id === selectedParcelId);
    if (!feature) return;
    const coordinates = (feature.geometry as { coordinates: number[][][] }).coordinates.flat();
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [x, y] of coordinates) {
      if (x === undefined || y === undefined) continue;
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
    }
    const centre: [number, number] = [(west + east) / 2, (south + north) / 2];
    if (!map.getBounds().contains(centre)) {
      map.easeTo({ center: centre, duration: 450 });
    }
  }, [selectedParcelId, view.features]);

  return (
    <div className={styles.wrap}>
      <div className={styles.canvas} data-testid="parcel-map" ref={container} />
      <div aria-live="polite" className={styles.srOnly} role="status">
        {selectedParcelId
          ? `Predio seleccionado: ${
              view.parcels.find((p) => p.id === selectedParcelId)?.parcelCode ?? ""
            }`
          : "Ningún predio seleccionado"}
      </div>
      <p className={styles.srOnly}>
        El mapa es una representación visual de la tabla de predios. Toda la información está
        disponible en la tabla, que es navegable con el teclado.
      </p>
      <MapLegends view={view} />
    </div>
  );
}

function MapLegends({ view }: { view: ParcelExplorerView }) {
  const counts = view.parcels.reduce<Record<string, number>>((acc, parcel) => {
    acc[parcel.status] = (acc[parcel.status] ?? 0) + 1;
    return acc;
  }, {});
  const present = (Object.keys(PARCEL_STATUS_PRESENTATION) as ParcelStatus[]).filter(
    (status) => (counts[status] ?? 0) > 0,
  );
  return (
    <div className={styles.legends}>
      <div className={styles.legend}>
        <div className={styles.legendTitle}>Estado del predio</div>
        <ul className={styles.legendList}>
          {present.map((status) => (
            <li className={styles.legendRow} key={status}>
              <span
                aria-hidden="true"
                className={styles.swatch}
                style={{ background: STATUS_FILL[status], borderColor: STATUS_LINE[status] }}
              >
                {PARCEL_STATUS_PRESENTATION[status].glyph}
              </span>
              <span className={styles.legendLabel}>{PARCEL_STATUS_PRESENTATION[status].label}</span>
              <span className={styles.legendCount}>{counts[status]}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
