import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Extent from '@arcgis/core/geometry/Extent.js';
import { xyToLngLat } from '@arcgis/core/geometry/support/webMercatorUtils.js';
import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import Map from '@arcgis/core/Map.js';
import MapView from '@arcgis/core/views/MapView.js';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol.js';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';
import TextSymbol from '@arcgis/core/symbols/TextSymbol.js';
import WebMap from '@arcgis/core/WebMap.js';
import LayerList from '@arcgis/core/widgets/LayerList.js';
import Legend from '@arcgis/core/widgets/Legend.js';
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel.js';
import Polyline from '@arcgis/core/geometry/Polyline.js';
import { Check, Layers3, Loader2, MapPin, PencilLine, Sparkles, Trash2, TriangleAlert, Undo2, X } from 'lucide-react';
import '@arcgis/core/assets/esri/themes/light/main.css';
import { useAuth } from '../auth/AuthContext';
import { appConfig } from '../config/appConfig';
import { SearchableSelect } from './SearchableSelect';
import { distanceMeters, polylineLengthKm, todayIso } from '../lib/format';
import { BASEMAP_OPTIONS, createBasemap, type BasemapKey } from '../lib/osmBasemap';
import { registerPortalToken } from '../lib/portalToken';
import { solveRoute, type RoutingProvider } from '../lib/routing';
import type {
  FacilityRecord,
  LonLat,
  MinefieldRecord,
  RouteDraft,
  RouteRecord,
  StartPointRecord,
} from '../types';
import type { CreateEvent, RedoEvent, UndoEvent, UpdateEvent } from '@arcgis/core/widgets/Sketch/types.js';

type MapMode = 'webmap' | 'fallback';
type BuilderMode = 'choose' | 'manual' | 'semi';

function providerLabel(provider: RoutingProvider): string {
  return provider === 'arcgis' ? 'ArcGIS' : 'OSRM';
}

interface RouteBuilderModalProps {
  minefields: MinefieldRecord[];
  facilities: FacilityRecord[];
  medics: string[];
  startPoints: StartPointRecord[];
  /** Заповнений маршрут переводить вікно в режим редагування. */
  route?: RouteRecord;
  onClose: () => void;
  /** Створює маршрут у поточному джерелі даних; помилка показується у формі. */
  onCreate: (draft: RouteDraft) => Promise<RouteRecord>;
  /** Зберігає зміни існуючого маршруту. */
  onUpdate?: (route: RouteRecord, draft: RouteDraft) => Promise<RouteRecord>;
  /** Видаляє існуючий маршрут. */
  onDelete?: (route: RouteRecord) => Promise<void>;
}

const START_FALLBACK: LonLat = [31.0, 49.3];
/** Скільки чекаємо на веб-карту Portal, перш ніж перейти до базової карти. */
const WEBMAP_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

const ROUTE_LINE = new SimpleLineSymbol({ color: [198, 40, 40, 1], width: 3.5 });

const VERTEX_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 11,
  color: [255, 255, 255],
  outline: { color: [198, 40, 40], width: 2 },
});

const SELECTED_VERTEX_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 15,
  color: [232, 146, 68],
  outline: { color: [255, 255, 255], width: 2.4 },
});

const START_SYMBOL = new SimpleMarkerSymbol({
  style: 'diamond',
  size: 15,
  color: [214, 139, 74],
  outline: { color: [255, 255, 255], width: 2 },
});

const FACILITY_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 13,
  color: [74, 117, 152],
  outline: { color: [255, 255, 255], width: 2 },
});

const CONTEXT_MINE_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 7,
  color: [214, 139, 74, 0.9],
  outline: { color: [255, 255, 255], width: 1 },
});

const CONTEXT_FACILITY_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 6,
  color: [74, 117, 152, 0.85],
  outline: { color: [255, 255, 255], width: 0.8 },
});

function pointGeometry([lon, lat]: LonLat) {
  return { type: 'point' as const, longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } };
}

interface SpatialReferenceLike {
  wkid?: number;
  latestWkid?: number;
  isWebMercator?: boolean;
}

function isWebMercatorSpatialReference(spatialReference: SpatialReferenceLike | undefined): boolean {
  if (!spatialReference) return false;
  return (
    spatialReference.isWebMercator === true ||
    spatialReference.wkid === 3857 ||
    spatialReference.wkid === 102100 ||
    spatialReference.latestWkid === 3857 ||
    spatialReference.latestWkid === 102100
  );
}

/** Перетворює перший шлях полілінії у WGS84, якщо графік спроєктований у Web Mercator. */
function pathsToLonLat(
  paths: LonLat[][] | undefined,
  spatialReference: SpatialReferenceLike | undefined,
): LonLat[] {
  const mercator = isWebMercatorSpatialReference(spatialReference);
  return (
    paths?.[0]
      ?.map((point) => {
        const x = Number(point[0]);
        const y = Number(point[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return mercator ? (xyToLngLat(x, y) as LonLat) : ([x, y] as LonLat);
      })
      .filter((point): point is LonLat => point !== null) ?? []
  );
}

function lineGraphic(points: LonLat[], symbol: SimpleLineSymbol): Graphic {
  return new Graphic({
    geometry: {
      type: 'polyline',
      paths: [points],
      spatialReference: { wkid: 4326 },
    },
    symbol,
  });
}

function labelSymbol(text: string, yoffset: number) {
  // Підпис під точкою: простий текстовий символ ArcGIS.
  return new TextSymbol({
    text,
    color: [38, 58, 50],
    haloColor: [255, 255, 255],
    haloSize: 1.5,
    font: { size: 11, weight: 'bold', family: 'Arial' },
    yoffset,
  });
}

function fitPoints(view: MapView, points: LonLat[]): void {
  if (points.length === 0) return;

  let minLon = points[0][0];
  let maxLon = points[0][0];
  let minLat = points[0][1];
  let maxLat = points[0][1];
  points.forEach(([lon, lat]) => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });

  if (maxLon - minLon < 0.0005 && maxLat - minLat < 0.0005) {
    void view.goTo({ center: points[0], zoom: Math.max(view.zoom, 13) });
    return;
  }

  const lonPad = Math.max((maxLon - minLon) * 0.15, 0.01);
  const latPad = Math.max((maxLat - minLat) * 0.15, 0.01);
  void view.goTo(
    new Extent({
      xmin: minLon - lonPad,
      ymin: minLat - latPad,
      xmax: maxLon + lonPad,
      ymax: maxLat + latPad,
      spatialReference: { wkid: 4326 },
    }),
  );
}

function startPointFor(
  minefield: MinefieldRecord | undefined,
  startPoints: StartPointRecord[],
): LonLat | undefined {
  if (!minefield) return undefined;
  const linked = startPoints.find((item) => item.parentGlobalId === minefield.id);
  return linked?.location ?? minefield.location;
}

/** Прибирає сусідні точки, що збігаються (наприклад, від подвійного кліку). */
function normalizePoints(points: LonLat[]): LonLat[] {
  return points.filter((point, index) => index === 0 || distanceMeters(points[index - 1], point) >= 2);
}

/**
 * Повноекранне створення маршруту CASEVAC.
 *
 * Користувач обирає ділянку розмінування (task_code) і медичний заклад — саме
 * вони формують зв'язки маршруту. Лінію можна намалювати вручну (кліками на
 * карті) або побудувати автоматично (пряма від початкової точки ділянки до
 * закладу) з подальшим ручним коригуванням.
 */
export function RouteBuilderModal({
  minefields,
  facilities,
  medics,
  startPoints,
  route,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: RouteBuilderModalProps) {
  const isEditing = route !== undefined;
  const [taskId, setTaskId] = useState(() => {
    if (!route) return '';
    const linked = minefields.find((item) => item.taskId === route.taskId || item.taskCode === route.code);
    return linked?.taskId ?? route.taskId;
  });
  const [facilityId, setFacilityId] = useState(() => {
    if (!route) return '';
    const linked = facilities.find((item) => item.id === route.facilityId);
    return linked?.id ?? route.facilityId;
  });
  const [surveyedBy, setSurveyedBy] = useState(route?.surveyedBy ?? '');
  const [surveyDate, setSurveyDate] = useState(route?.surveyDate || todayIso());
  const [points, setPoints] = useState<LonLat[]>(() => (route ? [...route.geometry] : []));
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [mapMessage, setMapMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [basemapKey, setBasemapKey] = useState<BasemapKey>('imagery');
  const [legendVisible, setLegendVisible] = useState(false);
  const [layerListVisible, setLayerListVisible] = useState(false);
  const [mapNotice, setMapNotice] = useState('');
  const [builderMode, setBuilderMode] = useState<BuilderMode>(isEditing ? 'manual' : 'choose');
  const [geometryEditing, setGeometryEditing] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [routeBuilding, setRouteBuilding] = useState(false);
  const [routeMeta, setRouteMeta] = useState<{
    durationMin: number;
    provider: RoutingProvider;
  } | null>(null);
  const [routeWarning, setRouteWarning] = useState('');

  const { session } = useAuth();
  const token = session?.token ?? null;

  // Довідники сортуємо за алфавітом, щоб списки були передбачуваними.
  const minefieldOptions = useMemo(
    () =>
      [...minefields]
        .sort(
          (left, right) =>
            left.taskCode.localeCompare(right.taskCode, 'uk', {
              numeric: true,
              sensitivity: 'base',
            }) || left.name.localeCompare(right.name, 'uk', { sensitivity: 'base' }),
        )
        .map((item) => ({
          value: item.taskId,
          label: item.name ? `${item.taskCode} — ${item.name}` : item.taskCode,
          keywords: `${item.taskCode} ${item.name}`,
        })),
    [minefields],
  );
  const facilityOptions = useMemo(
    () =>
      [...facilities]
        .sort((left, right) =>
          left.name.localeCompare(right.name, 'uk', { numeric: true, sensitivity: 'base' }),
        )
        .map((item) => ({
          value: item.id,
          label: item.name,
          keywords: item.address,
        })),
    [facilities],
  );

  const minefield = useMemo(() => minefields.find((item) => item.taskId === taskId), [minefields, taskId]);
  const facility = useMemo(() => facilities.find((item) => item.id === facilityId), [facilities, facilityId]);
  const startPoint = useMemo(() => startPointFor(minefield, startPoints), [minefield, startPoints]);
  // Ручне креслення доступне лише коли визначені обидва кінці маршруту.
  const manualReady = Boolean(startPoint && facility?.location);
  // Якщо лінія починається ближче до закладу, користувач, найімовірніше, намалював її навпаки.
  const reversedRoute = useMemo(() => {
    if (points.length < 2 || !startPoint || !facility?.location) return false;
    return distanceMeters(points[0], facility.location) < distanceMeters(points[0], startPoint);
  }, [points, startPoint, facility]);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const mapRef = useRef<Map | WebMap | null>(null);
  const legendRef = useRef<Legend | null>(null);
  const layerListRef = useRef<LayerList | null>(null);
  const mapModeRef = useRef<MapMode>('fallback');
  const contextLayerRef = useRef<GraphicsLayer | null>(null);
  const selectionLayerRef = useRef<GraphicsLayer | null>(null);
  const draftLayerRef = useRef<GraphicsLayer | null>(null);
  const sketchRef = useRef<SketchViewModel | null>(null);
  const editModeRef = useRef(false);
  const reshapeStartPointsRef = useRef<LonLat[]>([]);
  const pointsRef = useRef<LonLat[]>(points);
  const routeBuildingRef = useRef(false);
  const routeAbortRef = useRef<AbortController | null>(null);
  const ignoreSketchEventsRef = useRef(false);

  const basemapKeyRef = useRef<BasemapKey>(basemapKey);
  const legendVisibleRef = useRef(legendVisible);
  const layerListVisibleRef = useRef(layerListVisible);
  const selectedVertexRef = useRef<number | null>(selectedVertex);
  const minefieldsRef = useRef<MinefieldRecord[]>(minefields);
  const facilitiesRef = useRef<FacilityRecord[]>(facilities);
  const minefieldRef = useRef<MinefieldRecord | undefined>(minefield);
  const facilityRef = useRef<FacilityRecord | undefined>(facility);
  const startPointRef = useRef<LonLat | undefined>(startPoint);

  pointsRef.current = points;
  basemapKeyRef.current = basemapKey;
  legendVisibleRef.current = legendVisible;
  layerListVisibleRef.current = layerListVisible;
  selectedVertexRef.current = selectedVertex;
  minefieldsRef.current = minefields;
  facilitiesRef.current = facilities;
  minefieldRef.current = minefield;
  facilityRef.current = facility;
  startPointRef.current = startPoint;

  const cancelGeometryEditing = () => {
    ignoreSketchEventsRef.current = true;
    sketchRef.current?.cancel();
    window.setTimeout(() => {
      ignoreSketchEventsRef.current = false;
    }, 0);
    editModeRef.current = false;
    setGeometryEditing(false);
  };

  const startDrawing = () => {
    const sketch = sketchRef.current;
    if (!sketch) return;
    // Без вибраної ділянки та закладу маршрут не має сенсу — попереджаємо.
    if (!startPointRef.current || !facilityRef.current?.location) {
      setRouteWarning(
        'Спочатку оберіть ділянку розмінування та медичний заклад — без них не можна створити маршрут.',
      );
      return;
    }
    cancelGeometryEditing();
    draftLayerRef.current?.removeAll();
    pointsRef.current = [];
    setPoints([]);
    setSelectedVertex(null);
    setRouteMeta(null);
    setRouteWarning('');
    setError('');
    setDrawing(true);
    void sketch.create('polyline', { mode: 'click', hasZ: false });
  };

  const finishDrawing = () => {
    sketchRef.current?.complete();
    setDrawing(false);
  };

  const undoSketch = () => sketchRef.current?.undo();
  const redoSketch = () => sketchRef.current?.redo();

  const drawDraft = useCallback(() => {
    if (sketchRef.current) return;
    const layer = draftLayerRef.current;
    if (!layer) return;
    layer.removeAll();

    const current = pointsRef.current;
    if (current.length >= 2) {
      layer.add(lineGraphic(current, ROUTE_LINE));
    }
    current.forEach((point, index) => {
      layer.add(
        new Graphic({
          geometry: pointGeometry(point),
          symbol: index === selectedVertexRef.current ? SELECTED_VERTEX_SYMBOL : VERTEX_SYMBOL,
          attributes: { vertexIndex: index },
        }),
      );
    });
  }, []);

  const drawContext = useCallback(() => {
    const layer = contextLayerRef.current;
    if (!layer) return;
    layer.removeAll();

    minefieldsRef.current.forEach((item) => {
      if (!item.location) return;
      layer.add(
        new Graphic({
          geometry: pointGeometry(item.location),
          symbol: CONTEXT_MINE_SYMBOL,
          attributes: { snapLon: item.location[0], snapLat: item.location[1] },
        }),
      );
    });
    facilitiesRef.current.forEach((item) => {
      if (!item.location) return;
      // У режимі веб-карти заклади вже намальовані шаром Portal.
      if (mapModeRef.current === 'webmap') return;
      layer.add(
        new Graphic({
          geometry: pointGeometry(item.location),
          symbol: CONTEXT_FACILITY_SYMBOL,
          attributes: { snapLon: item.location[0], snapLat: item.location[1] },
        }),
      );
    });
  }, []);

  const drawSelection = useCallback(() => {
    const layer = selectionLayerRef.current;
    if (!layer) return;
    layer.removeAll();

    const currentMinefield = minefieldRef.current;
    const currentStart = startPointRef.current;
    if (currentMinefield && currentStart) {
      layer.add(
        new Graphic({
          geometry: pointGeometry(currentStart),
          symbol: START_SYMBOL,
          attributes: { snapLon: currentStart[0], snapLat: currentStart[1] },
        }),
      );
      layer.add(
        new Graphic({
          geometry: pointGeometry(currentStart),
          symbol: labelSymbol(`Ділянка ${currentMinefield.taskCode}`, 17),
        }),
      );
    }

    const currentFacility = facilityRef.current;
    if (currentFacility?.location) {
      layer.add(
        new Graphic({
          geometry: pointGeometry(currentFacility.location),
          symbol: FACILITY_SYMBOL,
          attributes: { snapLon: currentFacility.location[0], snapLat: currentFacility.location[1] },
        }),
      );
      layer.add(
        new Graphic({
          geometry: pointGeometry(currentFacility.location),
          symbol: labelSymbol(currentFacility.name, -20),
        }),
      );
    }
  }, []);

  const startEditingLine = () => {
    const sketch = sketchRef.current;
    const layer = draftLayerRef.current;
    if (!sketch || !layer || pointsRef.current.length < 2) return;

    cancelGeometryEditing();
    reshapeStartPointsRef.current = [...pointsRef.current];
    layer.removeAll();
    const graphic = lineGraphic(pointsRef.current, ROUTE_LINE);
    layer.add(graphic);
    editModeRef.current = true;
    setDrawing(false);
    setGeometryEditing(true);
    void sketch.update(graphic, {
      tool: 'reshape',
      toggleToolOnClick: false,
      enableZ: false,
      highlightOptions: { enabled: false },
    });
  };

  const editExistingLine = () => {
    if (geometryEditing || sketchRef.current?.state === 'active') {
      sketchRef.current?.complete();
      editModeRef.current = false;
      setGeometryEditing(false);
      return;
    }

    if (pointsRef.current.length < 2) {
      void sketchRef.current?.create('polyline', { mode: 'click', hasZ: false });
      return;
    }

    startEditingLine();
  };

  const buildRoute = async () => {
    // Автоматична побудова доступна лише для нового маршруту:
    // під час редагування геометрію змінюємо тільки вручну.
    if (isEditing) return;
    const from = startPointRef.current;
    const to = facilityRef.current?.location;
    if (!from || !to) {
      setRouteWarning('Оберіть ділянку розмінування та медичний заклад.');
      return;
    }
    if (routeBuildingRef.current) return;
    if (
      pointsRef.current.length >= 2 &&
      !window.confirm('Перебудувати маршрут? Поточні точки буде замінено.')
    ) {
      return;
    }

    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    routeBuildingRef.current = true;
    setRouteBuilding(true);
    setRouteWarning('');
    setRouteMeta(null);
    setError('');
    cancelGeometryEditing();

    try {
      if (token) registerPortalToken(token, session?.expiresAt ?? 0);
      const solution = await solveRoute({
        from,
        to,
        token,
        signal: controller.signal,
      });

      pointsRef.current = solution.geometry;
      setPoints(solution.geometry);
      setSelectedVertex(null);
      if (draftLayerRef.current) startEditingLine();

      if (solution.fallback) {
        setRouteWarning(
          `Маршрут не побудовано${solution.error ? ` (${solution.error})` : ''}. Показано пряму лінію — відредагуйте її вручну.`,
        );
      } else {
        setRouteMeta({ durationMin: solution.durationMin, provider: solution.provider });
      }

      const view = viewRef.current;
      if (view) fitPoints(view, solution.geometry);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRouteWarning(
        cause instanceof Error ? cause.message : 'Не вдалося побудувати маршрут.',
      );
    } finally {
      routeBuildingRef.current = false;
      setRouteBuilding(false);
    }
  };

  // Ініціалізація карти: веб-карта Portal (умовні знаки шарів) або базова карта.
  useEffect(() => {
    let cancelled = false;
    let view: MapView | null = null;

    const start = async () => {
      try {
        // Даємо React StrictMode завершити пробний unmount.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled || !containerRef.current) return;

        setMapNotice('');
        let map: Map | WebMap;
        let mapMode: MapMode = 'fallback';

        if (token) {
          try {
            registerPortalToken(token, session?.expiresAt ?? 0);
            const webmap = new WebMap({ portalItem: { id: appConfig.webMapId } });
            const loaded = await withTimeout(webmap.load(), WEBMAP_TIMEOUT_MS);
            if (cancelled) return;
            if (!loaded) throw new Error('Portal не відповів на запит веб-карти');
            webmap.basemap = createBasemap(basemapKeyRef.current);
            map = webmap;
            mapMode = 'webmap';
          } catch (cause) {
            if (cancelled) return;
            const reason = cause instanceof Error ? cause.message : 'невідома помилка завантаження';
            setMapNotice(`Веб-карта Portal недоступна (${reason}). Показано базову карту.`);
            map = new Map({ basemap: createBasemap(basemapKeyRef.current) });
          }
        } else {
          setMapNotice('Демо-режим: веб-карта Portal потребує входу.');
          map = new Map({ basemap: createBasemap(basemapKeyRef.current) });
        }

        if (cancelled) return;

        const context = new GraphicsLayer({
          title: 'Контекст: ділянки та заклади',
          // У демо-режимі шар показуємо у «Списку шарів», щоб кнопка не відкривала порожній список.
          listMode: mapMode === 'webmap' ? 'hide' : 'show',
        });
        const selection = new GraphicsLayer({ listMode: 'hide' });
        const draft = new GraphicsLayer({ listMode: 'hide' });
        map.addMany([context, selection, draft]);

        mapRef.current = map;
        mapModeRef.current = mapMode;
        contextLayerRef.current = context;
        selectionLayerRef.current = selection;
        draftLayerRef.current = draft;

        view = new MapView({
          container: containerRef.current,
          map,
          center: START_FALLBACK,
          zoom: 6,
          popupEnabled: false,
          ui: { components: ['zoom', 'compass'] },
        });
        viewRef.current = view;

        const sketch = new SketchViewModel({
          view,
          layer: draft,
          creationMode: 'single',
          updateOnGraphicClick: true,
          cancelUpdateOnClickAway: false,
          polylineSymbol: ROUTE_LINE,
          defaultCreateOptions: { hasZ: false, mode: 'click' },
          defaultUpdateOptions: {
            tool: 'reshape',
            toggleToolOnClick: false,
            enableZ: false,
            highlightOptions: { enabled: false },
          },
          snappingOptions: {
            enabled: true,
            featureEnabled: false,
            selfEnabled: false,
          },
        });
        sketchRef.current = sketch;

        const syncGeometry = (graphic: Graphic | null | undefined) => {
          if (ignoreSketchEventsRef.current) return;
          const geometry = graphic?.geometry as
            | {
                paths?: LonLat[][];
                spatialReference?: SpatialReferenceLike;
              }
            | null
            | undefined;
          const next = pathsToLonLat(geometry?.paths, geometry?.spatialReference);
          pointsRef.current = next;
          setPoints(next);
        };

        sketch.on('create', (event: CreateEvent) => {
          if (event.state === 'active' || event.state === 'complete') syncGeometry(event.graphic);
          if (event.state === 'complete') {
            setDrawing(false);
            editModeRef.current = false;
            setGeometryEditing(false);
          }
        });
        sketch.on('update', (event: UpdateEvent) => {
          const info = event.toolEventInfo;
          if (info?.type === 'move-start' || info?.type === 'move' || info?.type === 'move-stop') {
            const original = reshapeStartPointsRef.current;
            const graphic = event.graphics?.[0];
            if (graphic && original.length >= 2) {
              graphic.geometry = new Polyline({
                paths: [original],
                spatialReference: { wkid: 4326 },
              });
              syncGeometry(graphic);
            }
            return;
          }
          if (event.state === 'complete') {
            editModeRef.current = false;
            setGeometryEditing(false);
          }
          syncGeometry(event.graphics?.[0]);
        });
        sketch.on('undo', (event: UndoEvent) => syncGeometry(event.graphics?.[0]));
        sketch.on('redo', (event: RedoEvent) => syncGeometry(event.graphics?.[0]));

        await Promise.race([
          view.when(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (cancelled) return;

        if (route && pointsRef.current.length >= 2) {
          draft.removeAll();
          const graphic = lineGraphic(pointsRef.current, ROUTE_LINE);
          draft.add(graphic);
        }

        if (mapMode === 'webmap') {
          const legend = new Legend({ view });
          legend.visible = legendVisibleRef.current;
          legendRef.current = legend;
          view.ui.add(legend, 'bottom-right');
        }

        // Список шарів доступний і для веб-карти, і для базової карти.
        const layerList = new LayerList({ view });
        layerList.visible = layerListVisibleRef.current;
        layerListRef.current = layerList;
        view.ui.add(layerList, { position: 'bottom-right', index: 998 });

        drawContext();
        drawSelection();
        drawDraft();
        setStatus('ready');

        const allPoints: LonLat[] = [];
        minefieldsRef.current.forEach((item) => {
          if (item.location) allPoints.push(item.location);
        });
        facilitiesRef.current.forEach((item) => {
          if (item.location) allPoints.push(item.location);
        });
        // Під час редагування показуємо всю лінію, а не лише її кінці.
        fitPoints(view, pointsRef.current.length >= 2 ? pointsRef.current : allPoints);
      } catch (cause) {
        if (cancelled) return;
        setStatus('error');
        setMapMessage(cause instanceof Error ? cause.message : 'Невідома помилка карти');
      }
    };

    void start();

    return () => {
      cancelled = true;
      viewRef.current = null;
      mapRef.current = null;
      legendRef.current = null;
      layerListRef.current = null;
      contextLayerRef.current = null;
      selectionLayerRef.current = null;
      draftLayerRef.current = null;
      view?.destroy();
    };
  }, [token, session?.expiresAt, drawContext, drawDraft, drawSelection]);

  // Перемикання підкладки з випадаючого списку.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    map.basemap = createBasemap(basemapKey);
  }, [basemapKey, status]);

  // Показ/приховування легенди умовних знаків шарів веб-карти.
  useEffect(() => {
    if (legendRef.current) legendRef.current.visible = legendVisible;
  }, [legendVisible]);

  // Показ/приховування списку шарів.
  useEffect(() => {
    if (layerListRef.current) layerListRef.current.visible = layerListVisible;
  }, [layerListVisible]);

  useEffect(() => {
    drawContext();
  }, [minefields, facilities, drawContext]);

  useEffect(() => {
    drawSelection();
  }, [minefield, facility, startPoint, drawSelection]);

  useEffect(() => {
    drawDraft();
  }, [points, selectedVertex, drawDraft]);

  // Підганяємо карту під вибрану ділянку та заклад (або під готову лінію).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || status !== 'ready') return;
    if (pointsRef.current.length >= 2) {
      fitPoints(view, pointsRef.current);
      return;
    }
    const target: LonLat[] = [];
    if (startPoint) target.push(startPoint);
    if (facility?.location) target.push(facility.location);
    if (target.length > 0) fitPoints(view, target);
  }, [status, startPoint, facility]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [taskId, facilityId, surveyedBy, surveyDate, points, onClose]);

  useEffect(
    () => () => {
      routeAbortRef.current?.abort();
    },
    [],
  );

  const changeTask = (nextTaskId: string) => {
    cancelGeometryEditing();
    draftLayerRef.current?.removeAll();
    setTaskId(nextTaskId);
    pointsRef.current = [];
    setPoints([]);
    setSelectedVertex(null);
    setRouteMeta(null);
    setRouteWarning('');
    setError('');
  };

  const changeFacility = (nextFacilityId: string) => {
    cancelGeometryEditing();
    draftLayerRef.current?.removeAll();
    setFacilityId(nextFacilityId);
    pointsRef.current = [];
    setPoints([]);
    setSelectedVertex(null);
    setRouteMeta(null);
    setRouteWarning('');
    setError('');
  };

  const changeBuilderMode = () => {
    if (
      pointsRef.current.length >= 2 &&
      !window.confirm('Змінити режим? Поточна лінія буде очищена.')
    ) {
      return;
    }
    cancelGeometryEditing();
    draftLayerRef.current?.removeAll();
    pointsRef.current = [];
    setPoints([]);
    setSelectedVertex(null);
    setRouteMeta(null);
    setRouteWarning('');
    setError('');
    setBuilderMode('choose');
  };

  const readCurrentGeometry = (): LonLat[] => {
    const sketch = sketchRef.current;
    if (sketch?.state === 'active') sketch.complete();
    const graphics = draftLayerRef.current?.graphics;
    const graphic = graphics && graphics.length > 0 ? graphics.getItemAt(graphics.length - 1) : null;
    const geometry = graphic?.geometry as
      | {
          paths?: LonLat[][];
          spatialReference?: SpatialReferenceLike;
        }
      | null
      | undefined;
    const current = pathsToLonLat(geometry?.paths, geometry?.spatialReference);
    return current.length >= 2 ? current : points;
  };

  const validate = (): string => {
    if (!minefield) return 'Оберіть ділянку розмінування.';
    if (!facility) return 'Оберіть медичний заклад.';
    if (!surveyedBy.trim()) return 'Вкажіть медика, що обстежив маршрут.';
    if (!surveyDate) return 'Вкажіть дату обстеження.';

    const geometry = normalizePoints(readCurrentGeometry());
    if (geometry.length < 2) return 'Намалюйте лінію маршруту: потрібно щонайменше дві точки.';

    return '';
  };

  const handleSubmit = async () => {
    const sketch = sketchRef.current;
    if (sketch?.state === 'active') sketch.complete();
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    if (!minefield || !facility) return;
    if (isEditing && (!route || !onUpdate)) {
      setError('Редагування маршруту недоступне в поточному режимі.');
      return;
    }

    const geometry = normalizePoints(readCurrentGeometry());
    const endpointTolerance = appConfig.validation.routeEndpointToleranceMeters;
    const endpointIssues: string[] = [];
    const routeStart = startPointRef.current;
    const routeEnd = facilityRef.current?.location;
    if (routeStart && distanceMeters(geometry[0], routeStart) > endpointTolerance) {
      endpointIssues.push('початок');
    }
    if (
      routeEnd &&
      distanceMeters(geometry[geometry.length - 1], routeEnd) > endpointTolerance
    ) {
      endpointIssues.push('кінець');
    }
    if (
      endpointIssues.length > 0 &&
      !window.confirm(
        `Лінія відрізняється від початкової точки ділянки або закладу (${endpointIssues.join(', ')}) більше ніж на ${endpointTolerance} м. Зберегти маршрут?`,
      )
    ) {
      return;
    }

    const draft: RouteDraft = {
      taskId: minefield.taskId,
      code: minefield.taskCode,
      facilityId: facility.id,
      surveyedBy: surveyedBy.trim(),
      surveyDate,
      geometry,
    };

    setSaving(true);
    setError('');
    try {
      if (isEditing && route && onUpdate) {
        await onUpdate(route, draft);
      } else {
        await onCreate(draft);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : isEditing
            ? 'Не вдалося зберегти маршрут'
            : 'Не вдалося створити маршрут',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!route || !onDelete) return;
    setDeleting(true);
    setError('');
    try {
      await onDelete(route);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося видалити маршрут');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const requestClose = () => {
    if (hasUnsavedChanges() && !window.confirm('Є незбережені зміни. Закрити редактор без збереження?'))
      return;
    onClose();
  };

  const initialDraftRef = useRef(
    JSON.stringify({
      taskId: route
        ? (minefields.find((item) => item.taskId === route.taskId || item.taskCode === route.code)?.taskId ??
          route.taskId)
        : '',
      facilityId: route?.facilityId ?? '',
      surveyedBy: route?.surveyedBy ?? '',
      surveyDate: route?.surveyDate ?? todayIso(),
      geometry: normalizePoints(route ? [...route.geometry] : []),
    }),
  );

  const hasUnsavedChanges = () => {
    const current = JSON.stringify({
      taskId,
      facilityId,
      surveyedBy,
      surveyDate,
      geometry: normalizePoints(readCurrentGeometry()),
    });
    return current !== initialDraftRef.current;
  };

  return (
    <div
      className="route-builder"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? 'Редагування маршруту CASEVAC' : 'Створення маршруту CASEVAC'}
    >
      <header className="route-builder-header">
        <div>
          <h2>{isEditing ? 'Редагувати маршрут CASEVAC' : 'Новий маршрут CASEVAC'}</h2>
          <p>
            {isEditing
              ? 'Змініть зв’язки, дані обстеження або лінію маршруту на карті.'
              : builderMode === 'choose'
                ? 'Оберіть спосіб побудови маршруту — вручну або напівавтоматично.'
                : builderMode === 'semi'
                  ? 'Оберіть ділянку та заклад, побудуйте маршрут, потім відредагуйте точки.'
                  : 'Намалюйте лінію маршруту кліками на карті.'}
          </p>
        </div>
        <button
          type="button"
          className="icon-button route-builder-close"
          onClick={requestClose}
          aria-label={isEditing ? 'Закрити редагування маршруту' : 'Закрити створення маршруту'}
        >
          <X size={18} />
        </button>
      </header>

      <div className="route-builder-body">
        {builderMode === 'choose' && (
          <div className="route-builder-choice">
            <div
              className="route-builder-choice-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="route-builder-choice-title"
            >
              <h3 id="route-builder-choice-title">Як побудувати маршрут?</h3>
              <p>Оберіть спосіб — режим можна змінити пізніше.</p>
              <div className="route-builder-choice-grid">
                <button
                  type="button"
                  className="route-builder-choice-card"
                  onClick={() => setBuilderMode('manual')}
                >
                  <span className="route-builder-choice-icon">
                    <PencilLine size={22} />
                  </span>
                  <strong>Вручну</strong>
                  <span>
                    Накресліть лінію кліками на карті — повний контроль над кожною точкою.
                  </span>
                </button>
                <button
                  type="button"
                  className="route-builder-choice-card route-builder-choice-card-accent"
                  onClick={() => setBuilderMode('semi')}
                >
                  <span className="route-builder-choice-icon">
                    <Sparkles size={22} />
                  </span>
                  <strong>Напівавтоматично</strong>
                  <span>
                    Оберіть ділянку та заклад — маршрут побудується автоматично, далі
                    відредагуйте точки.
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        <aside className="route-builder-panel">
          <div className="route-builder-panel-scroll">
            <section className="route-builder-section">
              <span className="route-builder-section-title">Зв’язки маршруту</span>

              <div className="form-label">
                <span className="field-label">
                  Ділянка розмінування <i className="field-required">*</i>
                </span>
                <SearchableSelect
                  value={taskId}
                  options={minefieldOptions}
                  placeholder="Оберіть task_code"
                  searchPlaceholder="Пошук за кодом або назвою"
                  emptyLabel="Ділянок не знайдено"
                  ariaLabel="Ділянка розмінування"
                  onChange={changeTask}
                />
              </div>

              <div className="form-label">
                <span className="field-label">
                  Медичний заклад <i className="field-required">*</i>
                </span>
                <SearchableSelect
                  value={facilityId}
                  options={facilityOptions}
                  placeholder="Оберіть заклад"
                  searchPlaceholder="Пошук за назвою або адресою"
                  emptyLabel="Закладів не знайдено"
                  ariaLabel="Медичний заклад"
                  onChange={changeFacility}
                />
              </div>
            </section>

            <section className="route-builder-section">
              <span className="route-builder-section-title">Обстеження</span>

              <label className="form-label">
                <span className="field-label">
                  Обстежив маршрут <i className="field-required">*</i>
                </span>
                {medics.length > 0 ? (
                  <select value={surveyedBy} onChange={(event) => setSurveyedBy(event.target.value)}>
                    <option value="" disabled>
                      Оберіть медика
                    </option>
                    {medics.map((medic) => (
                      <option key={medic} value={medic}>
                        {medic}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={surveyedBy}
                    onChange={(event) => setSurveyedBy(event.target.value)}
                    placeholder="ПІБ медика"
                  />
                )}
              </label>

              <label className="form-label">
                <span className="field-label">
                  Дата обстеження <i className="field-required">*</i>
                </span>
                <input
                  type="date"
                  value={surveyDate}
                  onChange={(event) => setSurveyDate(event.target.value)}
                />
              </label>
            </section>

            <section className="route-builder-section">
              <div className="route-builder-section-head">
                <span className="route-builder-section-title">Геометрія маршруту</span>
                {!isEditing && (
                  <button type="button" className="route-builder-link" onClick={changeBuilderMode}>
                    Змінити режим
                  </button>
                )}
              </div>

              {builderMode === 'semi' && !isEditing && (
                <div className="route-builder-auto">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => void buildRoute()}
                    disabled={routeBuilding || !startPoint || !facility?.location}
                    title={
                      !startPoint || !facility?.location
                        ? 'Спочатку оберіть ділянку розмінування та медичний заклад'
                        : undefined
                    }
                  >
                    {routeBuilding ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    {routeBuilding
                      ? 'Будуємо…'
                      : points.length >= 2
                        ? 'Перебудувати маршрут'
                        : 'Побудувати маршрут'}
                  </button>
                  <p className="route-builder-note">
                    Маршрут будується між початковою точкою ділянки та вибраним закладом.
                    Після побудови точки можна перетягувати, додавати й видаляти.
                  </p>
                </div>
              )}

              {builderMode === 'manual' && !isEditing && (
                <div className="route-builder-tools">
                  {drawing ? (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={finishDrawing}
                    >
                      <Check size={14} />
                      Завершити лінію
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={startDrawing}
                      disabled={!manualReady}
                      title={
                        manualReady
                          ? undefined
                          : 'Спочатку оберіть ділянку розмінування та медичний заклад'
                      }
                    >
                      <PencilLine size={14} />
                      Створити полілінію
                    </button>
                  )}
                </div>
              )}

              {builderMode === 'manual' && !isEditing && !manualReady && (
                <p className="route-builder-route-warning" role="status">
                  <TriangleAlert size={13} />
                  Оберіть ділянку розмінування та медичний заклад зі списків — без них
                  створити полілінію не можна.
                </p>
              )}

              {builderMode === 'manual' && !isEditing && manualReady && (
                <p className="route-builder-route-meta">
                  <MapPin size={13} />
                  Починайте лінію від ділянки розмінування та завершуйте біля медичного
                  закладу — не навпаки.
                </p>
              )}

              {points.length >= 2 && !drawing && (
                <div className="route-builder-tools">
                  <button
                    type="button"
                    className={`button route-builder-edit-button${
                      geometryEditing ? ' route-builder-edit-button-active' : ''
                    }`}
                    onClick={editExistingLine}
                  >
                    <PencilLine size={14} />
                    {geometryEditing ? 'Завершити редагування геометрії' : 'Редагувати полілінію'}
                  </button>
                </div>
              )}

              <div className="route-builder-stats">
                <div>
                  <span>Точок</span>
                  <strong>{points.length}</strong>
                </div>
                <div>
                  <span>Довжина</span>
                  <strong>
                    {points.length >= 2 ? `${polylineLengthKm(points).toFixed(1)} км` : '—'}
                  </strong>
                </div>
              </div>

              {routeMeta && (
                <p className="route-builder-route-meta">
                  <Check size={13} />
                  Побудовано: {providerLabel(routeMeta.provider)}
                  {routeMeta.durationMin > 0 ? ` · ~${Math.round(routeMeta.durationMin)} хв` : ''}
                </p>
              )}

              {routeWarning && (
                <p className="route-builder-route-warning" role="status">
                  <TriangleAlert size={13} />
                  {routeWarning}
                </p>
              )}

              {reversedRoute && (
                <p className="route-builder-route-warning" role="status">
                  <TriangleAlert size={13} />
                  Лінія починається ближче до медичного закладу. Маршрут має починатися з
                  ділянки розмінування, а завершуватися біля закладу.
                </p>
              )}

              <p className="route-builder-note">
                {drawing
                  ? 'Клік на карту додає точку. Починайте від ділянки розмінування, завершуйте біля медичного закладу. Enter або «Завершити лінію» — готово.'
                  : points.length >= 2 && geometryEditing
                    ? 'Перетягніть точку, щоб змінити лінію. Клік по точці-маркеру на лінії додає нову точку; права кнопка на точці видаляє її.'
                    : isEditing
                      ? 'Натисніть «Редагувати полілінію», щоб перетягувати точки, додавати нові та видаляти зайві.'
                      : points.length >= 2 && builderMode === 'semi'
                        ? 'Перетягніть точку, щоб змінити лінію. Клік по точці-маркеру на лінії додає нову точку; права кнопка на точці видаляє її.'
                        : builderMode === 'semi'
                          ? 'Оберіть ділянку та заклад, потім натисніть «Побудувати маршрут».'
                          : 'Клік на карту додає точку. Після завершення натисніть Enter або двічі клацніть. Точку можна перетягнути; видалити її можна правою кнопкою миші.'}
              </p>

              <div className="route-builder-tools">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={undoSketch}
                  disabled={points.length === 0}
                >
                  <Undo2 size={14} />
                  Скасувати
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={redoSketch}
                  disabled={points.length === 0}
                >
                  Повторити
                </button>
              </div>
            </section>

            {error && (
              <div className="route-builder-error" role="alert">
                {error}
              </div>
            )}
          </div>

          {confirmDelete && (
            <div className="route-builder-confirm">
              <div
                className="route-builder-confirm-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="route-builder-confirm-title"
              >
                <h3 id="route-builder-confirm-title">
                  Видалити маршрут {route?.code || route?.id}?
                </h3>
                <p>Дію не можна скасувати. Маршрут буде видалено з переліку.</p>
                <div className="route-builder-confirm-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Скасувати
                  </button>
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                  >
                    {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                    {deleting ? 'Видаляємо…' : 'Видалити'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="route-builder-actions">
            {isEditing && onDelete && (
              <button
                type="button"
                className="button button-danger route-builder-delete"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
              >
                <Trash2 size={15} />
                Видалити
              </button>
            )}
            <button type="button" className="button button-secondary" onClick={requestClose}>
              Скасувати
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void handleSubmit()}
              disabled={saving}
            >
              {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              {saving ? 'Зберігаємо…' : 'Зберегти зміни'}
            </button>
          </div>
        </aside>

        <div className="route-builder-map">
          <div ref={containerRef} className="route-builder-map-view" />

          {status !== 'error' && (
            <div className="facility-map-controls route-builder-controls">
              <div className="facility-map-control-row">
                <label className="facility-basemap-control">
                  <select
                    value={basemapKey}
                    onChange={(event) => setBasemapKey(event.target.value as BasemapKey)}
                    aria-label="Базова карта"
                  >
                    {BASEMAP_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {status === 'ready' && mapModeRef.current === 'webmap' && (
                  <button
                    type="button"
                    className={`facility-legend-toggle ${legendVisible ? 'is-active' : ''}`}
                    onClick={() => setLegendVisible((visible) => !visible)}
                    aria-pressed={legendVisible}
                    aria-label="Показати умовні знаки"
                    title="Умовні знаки шарів веб-карти"
                  >
                    <Layers3 size={13} />
                    Легенда
                  </button>
                )}
                {status === 'ready' && (
                  <button
                    type="button"
                    className={`facility-legend-toggle ${layerListVisible ? 'is-active' : ''}`}
                    onClick={() => setLayerListVisible((visible) => !visible)}
                    aria-pressed={layerListVisible}
                    aria-label="Показати список шарів"
                    title="Список шарів"
                  >
                    <Layers3 size={13} />
                    Список шарів
                  </button>
                )}
              </div>
              {mapNotice && status === 'ready' && <span className="facility-map-notice">{mapNotice}</span>}
              {status === 'ready' && (
                <div className="route-builder-legend">
                  <span>
                    <i className="route-builder-dot route-builder-dot-start" />
                    Початкова точка
                  </span>
                  <span>
                    <i className="route-builder-dot route-builder-dot-facility" />
                    Заклад
                  </span>
                  <span>
                    <i className="route-builder-line" />
                    Маршрут
                  </span>
                </div>
              )}
            </div>
          )}

          {status === 'loading' && (
            <div className="route-builder-state">
              <Loader2 size={16} className="spin" />
              <span>Завантажуємо карту…</span>
            </div>
          )}
          {status === 'error' && (
            <div className="route-builder-state route-builder-state-error">
              <MapPin size={16} />
              <span>{mapMessage || 'Карту не вдалося завантажити.'}</span>
            </div>
          )}
          {status === 'ready' && builderMode !== 'choose' && (
            <div className="route-builder-hint">
              {drawing
                ? 'Клік — додати точку · від ділянки розмінування до закладу · Enter — завершити'
                : geometryEditing
                  ? 'Перетягніть точку · клік по точці-маркеру на лінії — додати · права кнопка — видалити'
                  : isEditing
                    ? 'Натисніть «Редагувати полілінію», щоб змінити геометрію маршруту'
                    : builderMode === 'semi'
                      ? 'Оберіть ділянку та заклад ліворуч і натисніть «Побудувати маршрут»'
                      : 'Клік — додати точку · Enter або подвійний клік — завершити · перетягування — перемістити'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
