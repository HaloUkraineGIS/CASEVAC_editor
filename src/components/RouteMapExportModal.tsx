import { useEffect, useMemo, useRef, useState } from 'react';
import type MapView from '@arcgis/core/views/MapView.js';
import { useToast } from './ToastContext';
import { formatDate } from '../lib/format';
import { Download, Loader2, X } from 'lucide-react';
import { saveAs } from 'file-saver';
import type { FacilityRecord, LonLat, MinefieldRecord, RouteRecord } from '../types';
import {
  a4Page,
  allElementsVisible,
  clampRect,
  DEFAULT_INSET_SCALE,
  defaultLayout,
  MAIN_SCALE_OPTIONS,
  mapFrame,
  niceScale,
  scaleLabel,
  type Orientation,
  type PrintElementId,
  type PrintLayout,
  type RectMm,
} from '../lib/printLayout';
import { jpegToPdf } from '../lib/printPdf';
import { autoScaleFor, createSheetView, waitForViewIdle } from '../lib/printMap';
import { drawSheet } from '../lib/printDraw';
import type { SheetTexts } from '../lib/printDraw';

interface RouteMapExportModalProps {
  route: RouteRecord;
  facility: FacilityRecord | undefined;
  minefield: MinefieldRecord | undefined;
  onClose: () => void;
}

/** Пікселів на міліметр для попереднього перегляду (96 dpi). */
const PREVIEW_PX_PER_MM = 96 / 25.4;
/** Роздільна здатність PDF-аркуша. */
const EXPORT_DPI = 300;

/** Завантажує SVG і повертає HTMLImageElement з гарантованими розмірами. */
async function loadSvg(url: string): Promise<HTMLImageElement> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const svgText = await res.text();
    let modified = svgText;
    const vbMatch = svgText.match(
      /viewBox=["']\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*["']/,
    );
    if (vbMatch && (!svgText.includes('width=') || !svgText.includes('height='))) {
      const [, , , vbW, vbH] = vbMatch;
      modified = svgText.replace(/<svg\b([^>]*)>/, `<svg$1 width="${vbW}" height="${vbH}">`);
    }
    const blob = new Blob([modified], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = blobUrl;
    });
  } catch {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }
}

export function RouteMapExportModal({
  route,
  facility,
  minefield,
  onClose,
}: RouteMapExportModalProps) {
  const { notify } = useToast();

  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const page = useMemo(() => a4Page(orientation), [orientation]);
  const frame = useMemo(() => mapFrame(page), [page]);

  // Стан режиму взаємодії: переміщення вмісту карт чи переміщення елементів аркуша
  const [mapPanEnabled, setMapPanEnabled] = useState(true);
  const [layout, setLayout] = useState<PrintLayout>(() => defaultLayout(page));
  const [draggingId, setDraggingId] = useState<PrintElementId | null>(null);
  const [hoveredId, setHoveredId] = useState<PrintElementId | null>(null);
  const dragStartRef = useRef<{
    id: PrintElementId;
    startX: number;
    startY: number;
    initialRect: RectMm;
  } | null>(null);

  // Оновлюємо розкладку за замовчуванням при зміні орієнтації
  useEffect(() => {
    setLayout(defaultLayout(page));
  }, [orientation]);

  const facilityPoint = useMemo<LonLat>(
    () =>
      facility?.location ??
      route.geometry[route.geometry.length - 1] ??
      ([31.0, 49.3] as LonLat),
    [facility, route.geometry],
  );

  // Об'єднуємо всі опорні точки: геометрію маршруту, заклад і мінне поле
  const allPoints = useMemo<LonLat[]>(() => {
    const pts: LonLat[] = [...route.geometry];
    if (facilityPoint) pts.push(facilityPoint);
    if (minefield?.location) pts.push(minefield.location);
    return pts;
  }, [route.geometry, facilityPoint, minefield?.location]);

  // Розрахунок географічного охоплення (plain object, autocast у MapView.goTo)
  const bbox = useMemo(() => {
    if (allPoints.length === 0) {
      return { center: [31.0, 49.3] as LonLat, extentObj: null };
    }
    let minLon = allPoints[0][0];
    let maxLon = allPoints[0][0];
    let minLat = allPoints[0][1];
    let maxLat = allPoints[0][1];
    for (const [lon, lat] of allPoints) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    const center: LonLat = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
    // Розширюємо bbox на 30% (аналог Extent.expand(1.3))
    const padLon = (maxLon - minLon) * 0.15;
    const padLat = (maxLat - minLat) * 0.15;
    const extentObj = {
      type: 'extent' as const,
      xmin: minLon - padLon,
      ymin: minLat - padLat,
      xmax: maxLon + padLon,
      ymax: maxLat + padLat,
      spatialReference: { wkid: 4326 },
    };
    return { center, extentObj };
  }, [allPoints]);

  // Розрахунковий масштаб за замовчуванням
  const calculatedAutoScale = useMemo(
    () => autoScaleFor(allPoints, frame.wMm, frame.hMm, 1.25),
    [allPoints, frame],
  );

  const [userScale, setUserScale] = useState<number | 'auto'>('auto');
  const [autoScaleState, setAutoScaleState] = useState<number | null>(null);

  const currentScale = userScale === 'auto' ? (autoScaleState ?? calculatedAutoScale) : userScale;

  // Тексти для шапки, підписів та таблиці штампу
  const texts = useMemo<SheetTexts>(() => {
    const len = route.length ? ` ${route.length.toFixed(1)} км` : '';
    const tit = minefield?.name ? ` — ${minefield.name}` : '';
    return {
      heading: `CASEVAC${len}`,
      subheading: `Ділянка розмінування ${route.code}${tit}`,
      facilityCaption: facility?.address
        ? facility.address
        : facility?.name ?? route.facilityName,
      compiledBy: route.surveyedBy || '—',
      position: 'Медик',
      date: formatDate(route.surveyDate),
    };
  }, [route, minefield, facility]);

  // === SVG логотипи та стрілка півночі ===
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  const [northImg, setNorthImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || '/';
    loadSvg(`${base}symbols/HALO%20Logo%20Dark.svg`)
      .then((img) => setLogoImg(img))
      .catch((e) => console.warn('Logo SVG error:', e));

    loadSvg(`${base}symbols/north-arrow.svg`)
      .then((img) => setNorthImg(img))
      .catch((e) => console.warn('North arrow SVG error:', e));
  }, []);

  // === Основна карта (Main Map) ===
  const mainMapRef = useRef<HTMLDivElement>(null);
  const mainViewRef = useRef<MapView | null>(null);
  const [mainReady, setMainReady] = useState(false);

  useEffect(() => {
    const el = mainMapRef.current;
    if (!el) return;

    setMainReady(false);

    const main = createSheetView(el, {
      routeGeometry: route.geometry,
      facilityPoint,
      startLabel: route.code,
      facilityLabel: facility?.name ?? route.facilityName,
      showLabels: true,
      center: bbox.center,
      scale: currentScale,
    });

    mainViewRef.current = main;

    main
      .when(async () => {
        if (bbox.extentObj && userScale === 'auto') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await main.goTo(bbox.extentObj as any, { animate: false });
            const fitted = niceScale(main.scale);
            await main.goTo({ scale: fitted }, { animate: false });
            setAutoScaleState(fitted);
          } catch {
            await main.goTo({ center: bbox.center, scale: calculatedAutoScale }, { animate: false });
          }
        } else {
          await main.goTo({ center: bbox.center, scale: currentScale }, { animate: false });
        }
        setMainReady(true);
      })
      .catch(() => undefined);

    return () => {
      mainViewRef.current = null;
      main.destroy();
    };
  }, [route.id, facilityPoint, orientation]);

  // === Врізка із закладом (Inset Map) ===
  const insetMapRef = useRef<HTMLDivElement>(null);
  const insetViewRef = useRef<MapView | null>(null);
  const [insetReady, setInsetReady] = useState(false);

  useEffect(() => {
    const el = insetMapRef.current;
    if (!el) return;

    setInsetReady(false);

    const inset = createSheetView(el, {
      routeGeometry: route.geometry,
      facilityPoint,
      startLabel: route.code,
      facilityLabel: facility?.name ?? route.facilityName,
      showLabels: false,
      center: facilityPoint,
      scale: DEFAULT_INSET_SCALE,
    });

    insetViewRef.current = inset;

    inset
      .when(async () => {
        await inset.goTo({ center: facilityPoint, scale: DEFAULT_INSET_SCALE }, { animate: false });
        setInsetReady(true);
      })
      .catch(() => undefined);

    return () => {
      insetViewRef.current = null;
      inset.destroy();
    };
  }, [route.id, facilityPoint, orientation]);

  // === Малювання елементів аркуша на попередньому перегляді ===
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const HIT_ORDER: PrintElementId[] = [
    'north',
    'logo',
    'scaleBar',
    'stamp',
    'legend',
    'header',
    'inset',
  ];

  const getSheetCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return { xMm: 0, yMm: 0 };
    const rect = canvas.getBoundingClientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    const xMm = pxX / PREVIEW_PX_PER_MM;
    const yMm = pxY / PREVIEW_PX_PER_MM;
    return { xMm, yMm };
  };

  const hitTest = (xMm: number, yMm: number, curLayout: PrintLayout): PrintElementId | null => {
    for (const id of HIT_ORDER) {
      const box = curLayout[id];
      if (
        box &&
        xMm >= box.xMm &&
        xMm <= box.xMm + box.wMm &&
        yMm >= box.yMm &&
        yMm <= box.yMm + box.hMm
      ) {
        return id;
      }
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mapPanEnabled) return;
    const { xMm, yMm } = getSheetCoords(e);
    const hit = hitTest(xMm, yMm, layout);
    if (hit) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraggingId(hit);
      dragStartRef.current = {
        id: hit,
        startX: xMm,
        startY: yMm,
        initialRect: { ...layout[hit] },
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mapPanEnabled) return;
    const { xMm, yMm } = getSheetCoords(e);

    if (dragStartRef.current) {
      const { id, startX, startY, initialRect } = dragStartRef.current;
      const deltaX = xMm - startX;
      const deltaY = yMm - startY;

      const newRect = clampRect(
        {
          ...initialRect,
          xMm: initialRect.xMm + deltaX,
          yMm: initialRect.yMm + deltaY,
        },
        page,
      );

      setLayout((prev) => ({
        ...prev,
        [id]: newRect,
      }));
    } else {
      const hit = hitTest(xMm, yMm, layout);
      setHoveredId(hit);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragStartRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragStartRef.current = null;
      setDraggingId(null);
    }
  };

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSheet(ctx, {
      page,
      layout,
      visible: allElementsVisible(),
      texts,
      scale: currentScale,
      insetScale: DEFAULT_INSET_SCALE,
      dpi: 96,
      logo: logoImg,
      northArrow: northImg,
    });

    // Якщо активний режим переміщення елементів — малюємо пунктирні контури
    if (!mapPanEnabled) {
      const k = PREVIEW_PX_PER_MM;
      ctx.save();
      const elementIds: PrintElementId[] = [
        'header',
        'logo',
        'north',
        'legend',
        'scaleBar',
        'stamp',
        'inset',
      ];
      for (const id of elementIds) {
        const box = layout[id];
        if (!box) continue;
        const isSelected = draggingId === id || hoveredId === id;
        ctx.strokeStyle = isSelected ? '#1f7a5c' : 'rgba(31, 122, 92, 0.45)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(box.xMm * k, box.yMm * k, box.wMm * k, box.hMm * k);

        if (isSelected) {
          ctx.fillStyle = 'rgba(31, 122, 92, 0.08)';
          ctx.fillRect(box.xMm * k, box.yMm * k, box.wMm * k, box.hMm * k);
        }
      }
      ctx.restore();
    }
  }, [
    page,
    layout,
    texts,
    currentScale,
    logoImg,
    northImg,
    mapPanEnabled,
    draggingId,
    hoveredId,
  ]);

  // Зміна масштабу з випадаючого списку
  const handleScaleChange = (val: string) => {
    if (val === 'auto') {
      setUserScale('auto');
      if (mainViewRef.current && bbox.extentObj) {
        mainViewRef.current
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .goTo(bbox.extentObj as any, { animate: false })
          .then(() => {
            if (mainViewRef.current) {
              const fitted = niceScale(mainViewRef.current.scale);
              mainViewRef.current.goTo({ scale: fitted }, { animate: false });
              setAutoScaleState(fitted);
            }
          })
          .catch(() => undefined);
      }
    } else {
      const num = Number(val);
      setUserScale(num);
      if (mainViewRef.current) {
        mainViewRef.current.goTo({ scale: num }, { animate: false });
      }
    }
  };

  // === Експорт PDF ===
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    const main = mainViewRef.current;
    if (!main || !mainReady) {
      notify('Карти ще завантажуються, зачекайте кілька секунд.', 'error');
      return;
    }

    setExporting(true);
    try {
      const pxPerMm = EXPORT_DPI / 25.4;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(page.widthMm * pxPerMm);
      canvas.height = Math.round(page.heightMm * pxPerMm);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Помилка ініціалізації Canvas');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await waitForViewIdle(main);

      // Знімок основної карти
      const mainShot = await main.takeScreenshot({
        width: Math.round(frame.wMm * pxPerMm),
        height: Math.round(frame.hMm * pxPerMm),
      });
      const mainImg = new Image();
      mainImg.src = mainShot.dataUrl;
      await new Promise((r) => (mainImg.onload = r));
      ctx.drawImage(
        mainImg,
        frame.xMm * pxPerMm,
        frame.yMm * pxPerMm,
        frame.wMm * pxPerMm,
        frame.hMm * pxPerMm,
      );

      // Знімок врізки із закладом
      const inset = insetViewRef.current;
      if (inset) {
        await waitForViewIdle(inset);
        const insetShot = await inset.takeScreenshot({
          width: Math.round(layout.inset.wMm * pxPerMm),
          height: Math.round(layout.inset.hMm * pxPerMm),
        });
        const insetImg = new Image();
        insetImg.src = insetShot.dataUrl;
        await new Promise((r) => (insetImg.onload = r));
        ctx.drawImage(
          insetImg,
          layout.inset.xMm * pxPerMm,
          layout.inset.yMm * pxPerMm,
          layout.inset.wMm * pxPerMm,
          layout.inset.hMm * pxPerMm,
        );
      }

      // Малюємо всі елементи аркуша (шапка, логотип, стрілка півночі, легенда, лінійка, таблиця)
      drawSheet(ctx, {
        page,
        layout,
        visible: allElementsVisible(),
        texts,
        scale: currentScale,
        insetScale: DEFAULT_INSET_SCALE,
        dpi: EXPORT_DPI,
        logo: logoImg,
        northArrow: northImg,
      });

      // Формуємо JPEG та загортаємо в PDF
      const jpeg = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('Помилка створення зображення'))), 'image/jpeg', 0.94),
      );
      const pdf = await jpegToPdf(
        { blob: jpeg, widthPx: canvas.width, heightPx: canvas.height },
        page,
      );
      saveAs(pdf, `${route.code || 'casevac'}-casevac-map.pdf`);
      notify('PDF карту успішно збережено', 'success');
    } catch (err: any) {
      console.error(err);
      notify(err?.message || 'Помилка генерації PDF', 'error');
    } finally {
      setExporting(false);
    }
  };

  const designW = Math.round(page.widthMm * PREVIEW_PX_PER_MM);
  const designH = Math.round(page.heightMm * PREVIEW_PX_PER_MM);

  return (
    <div className="print-export-overlay">
      <section
        className="print-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Експорт карти маршруту"
      >
        <header className="print-export-header">
          <div>
            <span className="modal-kicker">ЕКСПОРТ КАРТИ</span>
            <h2>Карта маршруту {route.code}</h2>
            <p>
              {facility?.name ?? route.facilityName} · A4 · масштаб {scaleLabel(currentScale)}
            </p>
          </div>
          <div className="print-export-header-actions">
            <button className="icon-button" onClick={onClose} aria-label="Закрити" type="button">
              <X size={19} />
            </button>
          </div>
        </header>

        <div className="print-export-body">
          <aside className="print-export-controls">
            <div className="print-control">
              <span className="print-control-label">Орієнтація</span>
              <div className="print-segmented">
                <button
                  type="button"
                  className={orientation === 'landscape' ? 'selected' : ''}
                  onClick={() => setOrientation('landscape')}
                >
                  Альбомна
                </button>
                <button
                  type="button"
                  className={orientation === 'portrait' ? 'selected' : ''}
                  onClick={() => setOrientation('portrait')}
                >
                  Портретна
                </button>
              </div>
            </div>

            <div className="print-control">
              <span className="print-control-label">Масштаб</span>
              <select value={userScale} onChange={(e) => handleScaleChange(e.target.value)}>
                <option value="auto">
                  Авто — {scaleLabel(autoScaleState ?? calculatedAutoScale)}
                </option>
                {MAIN_SCALE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {scaleLabel(v)}
                  </option>
                ))}
              </select>
            </div>

            <div className="print-control">
              <span className="print-control-label">Переміщення</span>
              <div className="print-segmented">
                <button
                  type="button"
                  className={mapPanEnabled ? 'selected' : ''}
                  onClick={() => setMapPanEnabled(true)}
                  title="Переміщення вмісту основної карти та врізки"
                >
                  Карти
                </button>
                <button
                  type="button"
                  className={!mapPanEnabled ? 'selected' : ''}
                  onClick={() => setMapPanEnabled(false)}
                  title="Переміщення елементів аркуша та екстенту врізки"
                >
                  Елементи
                </button>
              </div>
            </div>

            <p className="print-control-hint">
              {mapPanEnabled
                ? 'Перетягуйте карту всередині аркуша для точного налаштування положення маршруту.'
                : 'Перетягуйте мишкою будь-який елемент на аркуші (логотип, стрілку, легенду, штамп, врізку).'}
            </p>

            {!mapPanEnabled && (
              <button
                type="button"
                className="button button-secondary"
                style={{ fontSize: 11, padding: '4px 8px', alignSelf: 'flex-start', marginTop: -4 }}
                onClick={() => setLayout(defaultLayout(page))}
                title="Повернути початкове розташування елементів"
              >
                Скинути позиції
              </button>
            )}

            <button
              className="button button-primary print-export-submit"
              onClick={() => void handleExport()}
              disabled={exporting}
              type="button"
            >
              {exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
              {exporting ? 'Формуємо PDF…' : 'Завантажити PDF'}
            </button>
          </aside>

          <div className="print-export-stage">
            <div
              className="print-sheet"
              style={{
                width: designW,
                height: designH,
              }}
            >
              {/* Основна карта */}
              <div
                ref={mainMapRef}
                className="print-sheet-map"
                style={{
                  left: frame.xMm * PREVIEW_PX_PER_MM,
                  top: frame.yMm * PREVIEW_PX_PER_MM,
                  width: frame.wMm * PREVIEW_PX_PER_MM,
                  height: frame.hMm * PREVIEW_PX_PER_MM,
                  pointerEvents: mapPanEnabled ? 'auto' : 'none',
                }}
              />

              {/* Врізка із закладом */}
              <div
                ref={insetMapRef}
                className="print-sheet-map print-sheet-inset"
                style={{
                  left: layout.inset.xMm * PREVIEW_PX_PER_MM,
                  top: layout.inset.yMm * PREVIEW_PX_PER_MM,
                  width: layout.inset.wMm * PREVIEW_PX_PER_MM,
                  height: layout.inset.hMm * PREVIEW_PX_PER_MM,
                  pointerEvents: mapPanEnabled ? 'auto' : 'none',
                }}
              />

              {/* Оверлей-полотно з елементами оформлення */}
              <canvas
                ref={overlayCanvasRef}
                className="print-sheet-overlay"
                width={designW}
                height={designH}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: mapPanEnabled ? 'none' : 'auto',
                  cursor: mapPanEnabled
                    ? 'default'
                    : draggingId
                      ? 'grabbing'
                      : hoveredId
                        ? 'grab'
                        : 'default',
                }}
              />

              {(!mainReady || !insetReady) && (
                <div className="print-sheet-loading">
                  <Loader2 size={18} className="spin" /> Завантаження карт…
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
