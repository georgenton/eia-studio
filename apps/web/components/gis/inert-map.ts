import { getWorkerUrl, setWorkerUrl, type Map as MapLibreMap } from "maplibre-gl";

/**
 * Point MapLibre at its own worker bundle.
 *
 * MapLibre parses GeoJSON in a web worker. Left to itself the worker starts from a blob that
 * never completes its handshake under Next's bundling, and letting the bundler emit the worker
 * asset is no better: it content-hashes the worker but not the sibling module the worker imports
 * by relative path, so that import 404s. Either way sources stay `loaded() === false` for ever
 * and the map paints nothing — silently, with no error event.
 *
 * `tooling/scripts/copy-maplibre-worker.mjs` copies both files into `public/vendor/maplibre`
 * before dev and build, which keeps the relative import intact.
 */
export function ensureMapWorker(): void {
  if (getWorkerUrl()) return;
  setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");
}

/**
 * Take the whole map out of the tab order.
 *
 * The map container is `aria-hidden`: everything it shows is also in the parcel table, which is
 * the accessible representation of the same rows. An `aria-hidden` subtree must not contain
 * focusable elements, or keyboard users land on controls a screen reader cannot announce
 * (WCAG 4.1.2). MapLibre gives its canvas `tabindex="0"`, so the canvas is demoted here after the
 * map builds it.
 *
 * The zoom buttons are not demoted — they are not added at all (IG2-005). Keeping a visible
 * control that only a mouse can operate is worse than not offering it, and the map carries no
 * fact of its own: every parcel is in the table, sortable, filterable and keyboard-selectable.
 * This sweep stays as the guard that catches any future control a MapLibre upgrade adds.
 */
export function removeMapFromTabOrder(map: MapLibreMap, container: HTMLElement): void {
  map.getCanvas().setAttribute("tabindex", "-1");
  for (const node of container.querySelectorAll<HTMLElement>(
    "button, a[href], [tabindex]:not([tabindex='-1'])",
  )) {
    node.setAttribute("tabindex", "-1");
  }
}

/**
 * Keep the canvas the size of its container.
 *
 * MapLibre measures the container once, at construction. In a grid whose columns settle after
 * the effect runs, that first measurement is wrong and the canvas keeps a stale width for ever.
 * Observing the element is cheaper and more reliable than guessing when layout has finished.
 */
export function keepMapSized(map: MapLibreMap, container: HTMLElement): () => void {
  const observer = new ResizeObserver(() => map.resize());
  observer.observe(container);
  return () => observer.disconnect();
}
