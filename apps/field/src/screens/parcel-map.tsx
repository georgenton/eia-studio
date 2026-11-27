import {
  fieldMapResponseSchema,
  fieldMapResponseV2Schema,
  fieldMapResponseV3Schema,
  type FieldMapResponse,
  type FieldMapResponseV2,
  type FieldMapResponseV3,
  type MapParcelPart,
  type MapPosition,
  type MapReferenceBasemap,
} from "@eia/field-sync-contract";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GestureResponderEvent, PanResponderGestureState } from "react-native";
import {
  Image,
  PanResponder,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import { boundsOf, formatScale, padBounds, scaleBarMetres } from "../core/map-projection";
import {
  beginGesture,
  clampZoom,
  endGesture,
  moveGesture,
  type Camera,
  type GestureFrame,
} from "../core/map-gesture";
import {
  basemapLoadState,
  carryOverOutcomes,
  countVisible,
  recordTileResult,
  showsProviderImagery,
  tileSetKeyOf,
  type BasemapLoadState,
  type TileOutcomes,
} from "../core/basemap-state";
import { fitBounds, tilesFor, tileUrl, viewOf, type MercatorView } from "../core/mercator";
import { tileUserAgent } from "../core/tile-agent";
import { fieldConfig } from "../config";
import { readMapPack, saveMapPack } from "../db/repo";
import { useT } from "../i18n";
import { useField } from "../store";
import { fetchFieldMap } from "../sync/api";
import { theme } from "../theme";
import { Body, Button, Card, Chip, Label, Notice, Screen, Title } from "../ui";

/**
 * *Ubicar predio* — where this parcel is, drawn from geometry this device already holds.
 *
 * ## The guarantee, stated as the thing it refuses to depend on
 *
 * No tile provider, no basemap, no web view, no HTTP cache. The map is the project's own
 * geometry — the parcel, the axis, the kilometre posts — stored in the device's own encrypted
 * database by an explicit download, and drawn here as vectors. So it survives what a cached web
 * map does not: a force-stop, a reboot, a week in a ravine with no signal.
 *
 * What is lost, and said rather than hidden: there is no satellite imagery and no street names.
 * Bulk-downloading a provider's tiles is a licence question with one answer, and screenshots of a
 * provider's map are not a cartographic package. A technician standing at a gate needs the parcel
 * outline, the road, the posts and their own blue dot; that is what this draws.
 *
 * ## What is on it, and what each thing claims
 *
 * - **The parcel**, as a boundary when the cartography has one. When it does not, a *reference
 *   point* — somewhere inside it, derived — labelled as a reference and never as an entrance or a
 *   dwelling.
 * - **The axis**, as context, one continuous line or absent. A delivery whose pieces do not meet
 *   is not joined here: the server does not send it.
 * - **The kilometre posts**, with the warning the data demands. When nobody has declared where
 *   0+000 is, they are a **calculated distance** and the screen says so in those words.
 * - **My position**, when the technician asks and the platform answers, with its accuracy drawn as
 *   a circle rather than quoted as a number nobody can picture. On an emulator every position is
 *   simulated, and the screen says that too.
 *
 * The three are different kinds of fact and are drawn differently on purpose: the parcel is data
 * the study delivered, the posts are computed, and the blue dot is this handset's guess about
 * itself.
 */
/**
 * The pieces of a parcel, from either version of the payload.
 *
 * A version 2 payload carries every piece and its holes. A version 1 payload — one downloaded by
 * an older build and still sitting in this device's database — carries a single outer ring, so it
 * becomes one piece with no holes. The screen draws whatever it was given and does not pretend
 * the older payload is richer than it is.
 */
function partsOf(place: {
  kind: "polygon";
  ring: ReadonlyArray<MapPosition>;
  parts?: ReadonlyArray<MapParcelPart>;
}): ReadonlyArray<MapParcelPart> {
  return place.parts ?? [{ outer: [...place.ring], holes: [] }];
}

/** Pythagoras between two touches, for pinch. */
function touchDistance(
  a: { pageX: number; pageY: number },
  b: { pageX: number; pageY: number },
): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/** What the responder reports, in the shape the gesture reducer takes. */
function frameOf(
  event: GestureResponderEvent,
  gestureState: PanResponderGestureState,
): GestureFrame {
  const touches = event.nativeEvent.touches;
  return {
    touches: touches.length,
    distance: touches.length >= 2 ? touchDistance(touches[0]!, touches[1]!) : 0,
    dx: gestureState.dx,
    dy: gestureState.dy,
  };
}

/** One sentence per state, and none of them says "configured". */
const BASEMAP_STATE_MESSAGE = {
  none: "mobile.mapNoBasemap",
  loading: "mobile.mapBasemapLoading",
  available: "mobile.mapWithBasemap",
  partial: "mobile.mapBasemapPartial",
  unavailable: "mobile.mapBasemapUnavailable",
} as const;

/** Whatever shape the local database happens to hold: this build reads all three. */
type StoredMap = FieldMapResponse | FieldMapResponseV2 | FieldMapResponseV3;

/**
 * **Any version this application has ever written.**
 *
 * A map downloaded by an earlier build is sitting in this device's database, and refusing it
 * would turn an update into a lost map — demanding a fresh download from somebody who may have
 * no signal, which is the one thing an offline application must not do. Newest first, because
 * each version is a superset of the one before and the richer reading is the one to prefer.
 */
function readStoredMap(raw: unknown): StoredMap | null {
  const v3 = fieldMapResponseV3Schema.safeParse(raw);
  if (v3.success) return v3.data;
  const v2 = fieldMapResponseV2Schema.safeParse(raw);
  if (v2.success) return v2.data;
  const v1 = fieldMapResponseSchema.safeParse(raw);
  return v1.success ? v1.data : null;
}

/**
 * The reference background a stored map carries, if its version has one.
 *
 * A version 1 or version 2 payload has no such field, and that is not a fault: it is a map
 * downloaded before this product could offer a background. The device draws its croquis and
 * says so, which is what it also does when the field is present and null.
 */
function basemapOf(map: StoredMap): MapReferenceBasemap | null {
  return "referenceBasemap" in map ? map.referenceBasemap : null;
}

export function ParcelMapScreen({
  assignmentId,
  onBack,
}: {
  readonly assignmentId: string;
  readonly onBack: () => void;
}) {
  const t = useT();
  const { db, workPack } = useField();
  /*
   * Memoised because the effect below depends on it: a fresh object every render would re-read the
   * stored map on every render, which on a screen that then sets state is a loop.
   */
  const scope = useMemo(
    () =>
      workPack === null
        ? null
        : { tenantSlug: workPack.project.tenantSlug, projectSlug: workPack.project.projectSlug },
    [workPack],
  );
  const [map, setMap] = useState<StoredMap | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "absent" | "unreadable">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [here, setHere] = useState<{
    position: MapPosition;
    accuracyM: number | null;
    mocked: boolean | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!db || !scope) return;
      const stored = await readMapPack(db, scope.projectSlug);
      if (cancelled) return;
      if (stored === null) {
        setStatus("absent");
        return;
      }
      /*
       * Validated on the way out as well as on the way in. A row written by a later build is a row
       * this one cannot be sure it understands, and drawing a corridor from a payload we half
       * recognise is worse than saying the map needs downloading again.
       */
      /*
       * Either version. A map downloaded before this build existed is a version 1 payload sitting
       * in the local database, and refusing it would make an update look like a lost map — the
       * one thing an offline application must not do. Version 2 first, because a version 2 payload
       * would also satisfy the version 1 schema minus its `parts`, and the richer reading is the
       * one to prefer.
       */
      const understood = readStoredMap(JSON.parse(stored.payload));
      if (understood === null) {
        setStatus("unreadable");
        return;
      }
      setMap(understood);
      setFetchedAt(stored.fetchedAt);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [db, scope]);

  const download = async () => {
    if (!db || !scope) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetchFieldMap({
        tenantSlug: scope.tenantSlug,
        projectSlug: scope.projectSlug,
      });
      await saveMapPack(db, {
        tenantSlug: scope.tenantSlug,
        projectSlug: scope.projectSlug,
        schemaVersion: response.schemaVersion,
        payload: JSON.stringify(response),
      });
      const stored = await readMapPack(db, scope.projectSlug);
      setMap(response);
      setFetchedAt(stored?.fetchedAt ?? null);
      setStatus("ready");
    } catch {
      /*
       * One sentence, never the error. A failed download here is either no signal or a payload
       * this build cannot read, and in both cases a technician's next action is the same; a zod
       * report on the screen of a phone in the sun is noise that looks like a defect in the data.
       * The detail belongs in the diagnostics screen, which is what support asks for.
       */
      setMessage(t("mobile.mapDownloadFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** Ask once, when the technician presses. No background tracking, and no request on open. */
  const locate = async () => {
    setMessage(null);
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setMessage(t("mobile.mapLocationDenied"));
      return;
    }
    setBusy(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), 12_000);
        }),
      ]);
      if (position === "timeout") {
        setMessage(t("mobile.mapLocationTimedOut"));
        return;
      }
      setHere({
        position: [position.coords.longitude, position.coords.latitude],
        accuracyM: position.coords.accuracy ?? null,
        mocked: typeof position.mocked === "boolean" ? position.mocked : null,
      });
    } catch {
      setMessage(t("mobile.mapLocationUnavailable"));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      setBusy(false);
    }
  };

  const parcel = map?.parcels.find((p) => p.assignmentId === assignmentId) ?? null;

  /*
   * The map is now navigable, and the viewport follows the handset rather than being 320 points
   * square. A fixed drawing with no navigation answered "what shape is it"; a technician standing
   * at a gate is asking "where am I relative to it", which needs panning and zooming.
   */
  const window = useWindowDimensions();
  const viewport = useMemo(
    () => ({ width: Math.max(240, Math.min(window.width - 56, 460)), height: 340, padding: 18 }),
    [window.width],
  );

  /** The parcel's own frame: where the map opens, and where «Centrar predio» returns to. */
  const parcelFrame = useMemo(() => {
    if (parcel === null) return null;
    const positions: MapPosition[] =
      parcel.place.kind === "polygon"
        ? // Every piece, so a multi-part parcel is framed whole rather than around one of its
          // pieces with the rest off screen.
          partsOf(parcel.place).flatMap((part) => [...part.outer])
        : [parcel.place.at];
    const box = boundsOf(positions);
    if (box === null) return null;
    return fitBounds(padBounds(box, 1.2), viewport, { maxZoom: 18 });
  }, [parcel, viewport]);

  /*
   * The camera, with the opening frame it was derived from.
   *
   * Storing the frame beside the camera is what lets the opening view be **reset when the parcel
   * changes** and left alone otherwise — a reader who has panned must not be pulled back by an
   * unrelated re-render. The reset happens during render rather than in an effect: React
   * supports adjusting state while rendering for exactly this, and an effect would run after a
   * frame had already been painted with the previous parcel's camera.
   */
  const [nav, setNav] = useState<{ frame: typeof parcelFrame; camera: Camera | null }>(() => ({
    frame: parcelFrame,
    camera: parcelFrame === null ? null : { ...parcelFrame, anchor: null },
  }));
  if (nav.frame !== parcelFrame) {
    setNav({
      frame: parcelFrame,
      camera: parcelFrame === null ? null : { ...parcelFrame, anchor: null },
    });
  }
  const camera = nav.frame === parcelFrame ? nav.camera : null;
  const setCamera = useCallback(
    (next: (current: Camera | null) => Camera | null) =>
      setNav((current) => ({ ...current, camera: next(current.camera) })),
    [],
  );

  const view: MercatorView | null = useMemo(
    () => (camera === null ? null : viewOf(camera.centre, camera.zoom, viewport)),
    [camera, viewport],
  );

  /*
   * Pan and pinch, with React Native's own responder. No gesture library and no native map
   * module: the brief asked for an integration compatible with the application as it is, and a
   * new native dependency is a migration rather than a screen.
   */
  /*
   * Pan and pinch, with React Native's own responder. No gesture library and no native map
   * module: the brief asked for an integration compatible with the application as it is, and a
   * new native dependency is a migration rather than a screen.
   *
   * The gesture's starting point lives in **state**, beside the camera, and every handler reads
   * it through a functional update. The two obvious alternatives are both wrong: a ref read while
   * the responder is built is a render-time ref read, and a closure variable reassigned from a
   * callback is mutation after render — the React compiler rejects each in turn, and it is right
   * to. One state object updated functionally has neither problem, and it has the property that
   * matters for a drag: every frame is computed from where the finger **started**, so rounding
   * cannot accumulate across a long pan.
   */
  /*
   * Pan and pinch, with React Native's own responder. No gesture library and no native map
   * module: the brief asked for an integration compatible with the application as it is, and a
   * new native dependency is a migration rather than a screen.
   *
   * The arithmetic lives in `map-gesture.ts` as a pure reducer, because the behaviour that
   * matters is a *sequence* — one finger, a second arrives, pinch, one leaves, keep dragging —
   * and inside these callbacks that sequence can only be exercised on a device, which in
   * practice means never. The anchor is held in state and read through a functional update: a
   * ref read while the responder is built is a render-time ref read, and a reassigned closure
   * variable is mutation after render, and the React compiler rejects each in turn.
   */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event, gestureState) => {
          const frame = frameOf(event, gestureState);
          setCamera((current) => (current === null ? current : beginGesture(current, frame)));
        },
        onPanResponderMove: (event, gestureState) => {
          const frame = frameOf(event, gestureState);
          setCamera((current) =>
            current === null ? current : moveGesture(current, frame, viewport),
          );
        },
        onPanResponderRelease: () =>
          setCamera((current) => (current === null ? current : endGesture(current))),
        onPanResponderTerminate: () =>
          setCamera((current) => (current === null ? current : endGesture(current))),
      }),
    [viewport, setCamera],
  );

  const drawing = useMemo(() => {
    if (map === null || view === null) return null;
    const bar = scaleBarMetres(view.metresPerPixel, viewport.width);
    const toPath = (positions: ReadonlyArray<MapPosition>): string =>
      positions
        .map((position, index) => {
          const { x, y } = view.toScreen(position);
          return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
    return { viewport, projection: view, bar, toPath };
  }, [map, view, viewport]);

  /*
   * The reference background, when the deployment has a key for it and the tiles can be reached.
   *
   * `referenceBasemap` is null in two different situations and the surface distinguishes them:
   * no key configured at all, and a stored map from a build that predated this field. Either way
   * what a technician gets is the croquis — the study's own geometry on a plain ground — which is
   * the thing that works with no signal, and the caption says which of the two they are looking
   * at. **A croquis is never presented as a cartographic background.**
   */
  const basemap = map === null ? null : basemapOf(map);
  const tiles = useMemo(
    () => (basemap === null || view === null ? [] : tilesFor(view)),
    [basemap, view],
  );

  /*
   * What the tiles actually did, rather than what was configured.
   *
   * Each `Image` reports back, and the outcomes are keyed by tile so panning to a new set starts
   * a new verdict rather than inheriting the last one. `attempt` is the retry: it changes every
   * key, which both clears the outcomes and makes the device ask again.
   */
  const [attempt, setAttempt] = useState(0);
  const tileKeys = useMemo(() => tiles.map((tile) => tile.key), [tiles]);
  const tileSetKey = useMemo(() => tileSetKeyOf(attempt, tileKeys), [attempt, tileKeys]);
  const [outcomes, setOutcomes] = useState<TileOutcomes>({
    attempt,
    forSet: tileSetKey,
    byTile: {},
  });
  /*
   * Move to the new set during render rather than in an effect: an effect would let one frame
   * count the previous view's verdicts about tiles that are no longer on screen.
   *
   * What is **carried over** is the point. Pan a little and most tiles are the same `Image`,
   * still mounted, already loaded — and an `Image` that has loaded never fires `onLoad` again.
   * Discarding the whole record each frame therefore under-counted what had actually painted,
   * and the caption read *parte del fondo no se pudo cargar* over a background that was complete.
   * A retry (`attempt`) discards everything, because then every image really does start again.
   */
  const settled =
    outcomes.forSet === tileSetKey
      ? outcomes.byTile
      : carryOverOutcomes(outcomes, { attempt, tileKeys });
  if (outcomes.forSet !== tileSetKey) {
    setOutcomes({ attempt, forSet: tileSetKey, byTile: settled });
  }

  const reportTile = useCallback(
    (forSet: string, tileKey: string, result: "ok" | "fail") =>
      setOutcomes((current) => recordTileResult(current, { forSet, tileKey, result })),
    [],
  );

  // Only the tiles being asked for right now. A verdict about one that has scrolled away is not
  // evidence about this frame, however recently it arrived.
  const visible = countVisible(tileKeys, settled);
  const loadState: BasemapLoadState = basemapLoadState({
    configured: basemap !== null,
    requested: tiles.length,
    loaded: visible.loaded,
    failed: visible.failed,
  });
  const userAgent = useMemo(() => {
    const config = fieldConfig();
    return tileUserAgent(config.appVersion, config.environment);
  }, []);

  if (status === "loading") {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Title>{t("mobile.mapTitle")}</Title>
          <Body>{t("mobile.mapLoading")}</Body>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Title>{t("mobile.mapTitle")}</Title>

        {status === "absent" || status === "unreadable" ? (
          <Notice
            text={status === "absent" ? t("mobile.mapAbsent") : t("mobile.mapUnreadable")}
            tone="warn"
          />
        ) : null}

        {message !== null ? <Notice text={message} tone="warn" /> : null}

        {drawing !== null && map !== null && parcel !== null ? (
          <Card>
            <View
              style={[
                styles.canvas,
                { width: drawing.viewport.width, height: drawing.viewport.height },
              ]}
              {...panResponder.panHandlers}
            >
              {/*
                The reference background, under everything the study delivered. One image per
                tile, positioned by the same projection that draws the geometry above it — which
                is why this screen uses Web Mercator whenever there is a background: tiles are cut
                in it, and an equirectangular overlay would put the road beside the road.

                A tile that fails to load leaves a gap and nothing else. The study's layers are
                drawn over the top regardless, which is the same promise the web map makes: a
                third-party background can never produce a blank map.
              */}
              {tiles.map((tile) => (
                <Image
                  key={`${attempt}:${tile.key}`}
                  onError={() => reportTile(tileSetKey, tile.key, "fail")}
                  onLoad={() => reportTile(tileSetKey, tile.key, "ok")}
                  source={{
                    uri: tileUrl(basemap!.tileUrl, tile),
                    headers: { "User-Agent": userAgent },
                  }}
                  style={{
                    position: "absolute",
                    left: tile.left,
                    top: tile.top,
                    width: tile.size,
                    height: tile.size,
                  }}
                />
              ))}
              <Svg height={drawing.viewport.height} width={drawing.viewport.width}>
                {/* The plain ground, only when there is no background to show through. */}
                {basemap === null ? (
                  <Rect
                    fill={theme.canvas}
                    height={drawing.viewport.height}
                    width={drawing.viewport.width}
                    x={0}
                    y={0}
                  />
                ) : null}

                {/* The axis, as context. Behind everything else: it is not the subject. */}
                {map.axis !== null ? (
                  <Path
                    d={drawing.toPath(map.axis.coordinates)}
                    fill="none"
                    stroke={theme.muted}
                    strokeWidth={3}
                  />
                ) : null}

                {/* The kilometre posts. */}
                {map.milestones.map((post) => {
                  const { x, y } = drawing.projection.toScreen(post.at);
                  if (x < -20 || x > drawing.viewport.width + 20) return null;
                  return (
                    <G key={post.label}>
                      <Circle cx={x} cy={y} fill={theme.muted} r={3} />
                      <SvgText fill={theme.muted} fontSize={9} x={x + 5} y={y - 4}>
                        {post.label}
                      </SvgText>
                    </G>
                  );
                })}

                {/*
                  The parcel: the subject of the screen. One path per piece, with its holes as
                  further subpaths of the same path — `fillRule="evenodd"` is what makes a hole a
                  hole rather than a second filled ring on top of the first.
                */}
                {parcel.place.kind === "polygon" ? (
                  partsOf(parcel.place).map((part, index) => (
                    <Path
                      d={[
                        `${drawing.toPath(part.outer)} Z`,
                        ...part.holes.map((hole) => `${drawing.toPath(hole)} Z`),
                      ].join(" ")}
                      fill={theme.accentSoft}
                      fillOpacity={0.45}
                      fillRule="evenodd"
                      key={`part-${index}`}
                      stroke={theme.accent}
                      strokeWidth={2}
                    />
                  ))
                ) : (
                  <Circle
                    cx={drawing.projection.toScreen(parcel.place.at).x}
                    cy={drawing.projection.toScreen(parcel.place.at).y}
                    fill={theme.accent}
                    r={7}
                  />
                )}

                {/* This handset's guess about itself, with its accuracy drawn rather than quoted. */}
                {here !== null ? (
                  <G>
                    {here.accuracyM !== null ? (
                      <Circle
                        cx={drawing.projection.toScreen(here.position).x}
                        cy={drawing.projection.toScreen(here.position).y}
                        fill={theme.accent}
                        fillOpacity={0.18}
                        r={Math.max(here.accuracyM / drawing.projection.metresPerPixel, 4)}
                      />
                    ) : null}
                    <Circle
                      cx={drawing.projection.toScreen(here.position).x}
                      cy={drawing.projection.toScreen(here.position).y}
                      fill={theme.accent}
                      r={5}
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  </G>
                ) : null}

                {/* North. The map does not rotate, so the arrow is fixed and honest. */}
                <G>
                  <Line
                    stroke={theme.ink}
                    strokeWidth={2}
                    x1={drawing.viewport.width - 22}
                    x2={drawing.viewport.width - 22}
                    y1={30}
                    y2={12}
                  />
                  <Path
                    d={`M${drawing.viewport.width - 26},18 L${drawing.viewport.width - 22},10 L${drawing.viewport.width - 18},18 Z`}
                    fill={theme.ink}
                  />
                  <SvgText
                    fill={theme.ink}
                    fontSize={10}
                    fontWeight="bold"
                    x={drawing.viewport.width - 26}
                    y={42}
                  >
                    N
                  </SvgText>
                </G>

                {/* The scale bar: one bar, because the projection uses one scale for both axes. */}
                <G>
                  <Line
                    stroke={theme.ink}
                    strokeWidth={2}
                    x1={12}
                    x2={12 + drawing.bar / drawing.projection.metresPerPixel}
                    y1={drawing.viewport.height - 16}
                    y2={drawing.viewport.height - 16}
                  />
                  <SvgText fill={theme.ink} fontSize={10} x={12} y={drawing.viewport.height - 20}>
                    {formatScale(drawing.bar)}
                  </SvgText>
                </G>
              </Svg>
            </View>

            {/*
              Navigation, as real buttons under the map rather than only as gestures: a gesture
              nobody is told about is a feature nobody has, and «centrar» is the one a person
              reaches for after panning somewhere they did not mean to go.
            */}
            <View style={styles.mapControls}>
              <Button
                label={t("mobile.mapZoomIn")}
                onPress={() =>
                  setCamera((c) => (c === null ? c : { ...c, zoom: clampZoom(c.zoom + 1) }))
                }
                tone="secondary"
              />
              <Button
                label={t("mobile.mapZoomOut")}
                onPress={() =>
                  setCamera((c) => (c === null ? c : { ...c, zoom: clampZoom(c.zoom - 1) }))
                }
                tone="secondary"
              />
              <Button
                label={t("mobile.mapCentreParcel")}
                onPress={() =>
                  setCamera(() => (parcelFrame === null ? null : { ...parcelFrame, anchor: null }))
                }
                tone="secondary"
              />
              {here !== null ? (
                <Button
                  label={t("mobile.mapCentreMe")}
                  onPress={() =>
                    setCamera((c) =>
                      c === null
                        ? c
                        : { centre: here.position, zoom: Math.max(c.zoom, 16), anchor: null },
                    )
                  }
                  tone="secondary"
                />
              ) : null}
            </View>

            {/*
              Which of the two maps this is. The croquis is a real, useful thing and it is what
              works with no signal — but it is **not** a cartographic background, and saying so
              is the difference between an honest fallback and a false claim.
            */}
            <Notice
              text={t(BASEMAP_STATE_MESSAGE[loadState])}
              tone={loadState === "available" ? "ok" : "warn"}
            />
            {/*
              Attribution is a condition of using the tiles, so it is on screen exactly when the
              provider's imagery is — not when a template happens to be configured.
            */}
            {showsProviderImagery(loadState) &&
            basemap !== null &&
            basemap.attribution.length > 0 ? (
              <Body>{basemap.attribution}</Body>
            ) : null}
            {/*
              One retry, on a press. No automatic retry: a failing provider and an automatic
              retry are a request loop, which costs a technician their battery and their data.
            */}
            {loadState === "partial" || loadState === "unavailable" ? (
              <Button
                label={t("mobile.mapRetryBasemap")}
                onPress={() => setAttempt((n) => n + 1)}
                tone="secondary"
              />
            ) : null}

            <Label>{t("mobile.mapParcel")}</Label>
            <Body>
              {parcel.parcelCode}
              {parcel.chainageLabel !== null ? ` · ${parcel.chainageLabel}` : ""}
            </Body>

            {parcel.place.kind === "reference_point" ? (
              <Notice text={t("mobile.mapReferencePoint")} tone="warn" />
            ) : null}

            {map.milestones.length > 0 && !map.chainageDeclared ? (
              <Notice text={t("mobile.mapChainageCalculated")} tone="warn" />
            ) : null}

            {here?.mocked === true ? (
              <Notice text={t("mobile.mapPositionSimulated")} tone="warn" />
            ) : null}

            {fetchedAt !== null ? (
              <Chip
                text={t("mobile.mapFetchedAt").replace(
                  "{when}",
                  new Date(fetchedAt).toLocaleString("es-EC"),
                )}
                tone="neutral"
              />
            ) : null}
          </Card>
        ) : status === "ready" ? (
          <Notice text={t("mobile.mapParcelAbsent")} tone="warn" />
        ) : null}

        <View style={styles.actions}>
          <Button
            disabled={busy}
            label={t("mobile.mapLocateMe")}
            onPress={() => void locate()}
            tone="secondary"
          />
          <Button
            disabled={busy}
            label={t("mobile.mapDownload")}
            onPress={() => void download()}
            tone="secondary"
          />
          <Button label={t("common.back")} onPress={onBack} tone="secondary" />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.md },
  canvas: {
    alignSelf: "center",
    marginBottom: theme.space.sm,
    overflow: "hidden",
    position: "relative",
    backgroundColor: theme.canvas,
  },
  mapControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.space.xs,
    marginBottom: theme.space.sm,
  },
  actions: { gap: theme.space.sm, marginTop: theme.space.md },
});
