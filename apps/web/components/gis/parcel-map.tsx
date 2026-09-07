"use client";

import type { ParcelExplorerView } from "@eia/application";
import { collectPositions, PARCEL_STATUS_PRESENTATION, type ParcelStatus } from "@eia/domain";
// MapLibre v6 is pure ESM with named exports and no default export.
import {
  Map as MapLibreMap,
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
  showInfluenceAreas = true,
}: {
  view: ParcelExplorerView;
  selectedParcelId: string | null;
  onSelect: (parcelId: string | null) => void;
  /** Whether the delimited areas are drawn. The toggle lives with the legend that names them. */
  showInfluenceAreas?: boolean;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<InstanceType<typeof MapLibreMap> | null>(null);
  const boundsRef = useRef(view.bounds);
  const onSelectRef = useRef(onSelect);
  const showInfluenceRef = useRef(showInfluenceAreas);
  // The map is built once; the click handler it captures must still call the *current* callback,
  // so the ref is refreshed in an effect rather than during render.
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // Same reason: the button is built once and must re-frame the *current* extent, which changes
  // when the filtered set does.
  useEffect(() => {
    boundsRef.current = view.bounds;
  }, [view.bounds]);

  // The map is built once, so a later toggle changes the layer rather than rebuilding anything.
  useEffect(() => {
    showInfluenceRef.current = showInfluenceAreas;
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    for (const id of ["influence-fill", "influence-line"]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", showInfluenceAreas ? "visible" : "none");
      }
    }
  }, [showInfluenceAreas]);

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
    // No NavigationControl (IG2-005). It renders real buttons, and inside an `aria-hidden`
    // subtree those are controls a keyboard can reach but a screen reader cannot announce — so
    // they were being taken out of the tab order, which left visible buttons that only a mouse
    // could use. Scroll, drag and pinch still zoom; the scale bar is inert text, not a control.
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    /*
     * Where the camera is, and how much of the project it can see, as data attributes.
     *
     * A canvas has no state a test can read, so until now nothing asserted that the project was
     * actually *in* the viewport — the suite checked the table, the selection and the legends, all
     * of which stayed perfectly green while the map opened on `[0, 0]` and showed the reader an
     * empty grey square. These two attributes are the smallest thing that closes that gap.
     *
     * They carry map coordinates and a count of drawn polygons: the same figures the payload
     * already contains, nothing about a person, and nothing a viewer could not read off the screen.
     */
    const publishCamera = (): void => {
      const bounds = map.getBounds();
      node.dataset["mapView"] =
        `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
      node.dataset["parcelsInView"] = map.getLayer("parcels-fill")
        ? String(map.queryRenderedFeatures({ layers: ["parcels-fill"] }).length)
        : "0";
      node.dataset["alignmentInView"] = map.getLayer("alignment-line")
        ? String(map.queryRenderedFeatures({ layers: ["alignment-line"] }).length)
        : "0";
    };
    map.on("moveend", publishCamera);
    // `idle` is the only moment the counts mean anything: at `load` the layers exist and nothing
    // has been drawn yet, so a reader of these attributes must wait for the frame to settle.
    map.on("idle", () => {
      publishCamera();
      node.dataset["mapIdle"] = "true";
    });

    map.on("load", () => {
      removeMapFromTabOrder(map, node);
      map.resize();
      if (view.alignment) {
        map.addSource("alignment", {
          type: "geojson",
          data: { type: "Feature", geometry: view.alignment.geometry, properties: {} } as never,
        });
        /*
         * A solid line. It used to be dashed, because the alignment was a reconstruction and a
         * solid line would have read as surveyed; the study's own centreline was imported in
         * ADR-023, so the dashes now understate what the map is showing.
         */
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
          paint: { "line-color": "#17506b", "line-width": 2.6 },
        });
      }

      /*
       * The areas of influence, under everything else (TD-070).
       *
       * They are context: a corridor read against the ground the study delimited. Drawn from the
       * generalised outline the read model produced — the stored polygon is untouched — and behind
       * the parcels, because the parcel is the working object and an area of 27 000 ha painted
       * over it would bury the thing the surface is for.
       */
      if (view.influenceAreas.length > 0) {
        map.addSource("influence-areas", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: view.influenceAreas.map((area) => ({
              type: "Feature",
              geometry: area.geometry,
              properties: { kind: area.kind, label: area.label },
            })),
          } as never,
        });
        map.addLayer({
          id: "influence-fill",
          type: "fill",
          source: "influence-areas",
          layout: { visibility: showInfluenceRef.current ? "visible" : "none" },
          paint: {
            "fill-color": [
              "match",
              ["get", "kind"],
              "direct",
              "#2c6046",
              "direct_social",
              "#17506b",
              "#8b959c",
            ] as unknown as ExpressionSpecification,
            "fill-opacity": 0.07,
          },
        });
        map.addLayer({
          id: "influence-line",
          type: "line",
          source: "influence-areas",
          layout: { visibility: showInfluenceRef.current ? "visible" : "none" },
          paint: {
            "line-color": [
              "match",
              ["get", "kind"],
              "direct",
              "#2c6046",
              "direct_social",
              "#17506b",
              "#a6aeb4",
            ] as unknown as ExpressionSpecification,
            "line-width": 1.2,
            "line-dasharray": [4, 3],
          },
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
      publishCamera();
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
      delete node.dataset["mapView"];
      delete node.dataset["parcelsInView"];
      delete node.dataset["alignmentInView"];
      delete node.dataset["mapIdle"];
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
    /*
     * Positions, however deeply the geometry nests them.
     *
     * A `Polygon` nests coordinates three deep and a `MultiPolygon` four, and 20 of the 141 real
     * parcels are multi-part (ADR-023). This used to be an inline recursive walk, written here
     * after a fixed-depth version handed a *ring* to a destructuring meant for a position and made
     * the centre `NaN`. The same mistake was still in the read model's extent — where it emptied
     * the whole map — so the walk is now one shared function and there is no second copy to miss.
     */
    const positions = collectPositions((feature.geometry as { coordinates: unknown }).coordinates);
    if (positions.length === 0) return;

    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [x, y] of positions) {
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

  /*
   * Back to the project.
   *
   * A real button, in the document, **outside** the canvas — the canvas subtree is `aria-hidden`
   * (§26), and a control inside it is one a keyboard can reach and a screen reader cannot
   * announce, which is why the map carries no MapLibre navigation control (IG2-005).
   *
   * It is a way of reading the map and a way out of one: pan far enough and the project is off
   * screen with no landmark to steer by, and this is the return. It re-frames the extent the read
   * model computed — parcels and centreline — rather than remembering where the camera started,
   * so it stays right when the filtered set changes.
   */
  const recentre = () => {
    const map = mapRef.current;
    const bounds = boundsRef.current;
    if (!map || !bounds) return;
    map.fitBounds([...bounds] as [number, number, number, number], {
      padding: 48,
      duration: 450,
    });
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.canvas} data-testid="parcel-map" ref={container} />
      {view.bounds ? (
        <div className={styles.controls}>
          <button
            className={styles.recentre}
            data-testid="recentre-map"
            onClick={recentre}
            type="button"
          >
            Centrar en proyecto
          </button>
        </div>
      ) : null}
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
