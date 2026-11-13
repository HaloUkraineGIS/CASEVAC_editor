import { useEffect, useMemo, useRef, useState } from 'react';
import type MapView from '@arcgis/core/views/MapView.js';
import { Download, Loader2, X } from 'lucide-react';
import { saveAs } from 'file-saver';
import { useAuth } from '../auth/AuthContext';
import { useToast } from './ToastContext';
import { todayIso } from '../lib/format';
import { jpegToPdf } from '../lib/printPdf';
import { loadSvgImage } from '../lib/svgImage';
import { scaleLabel, type Orientation } from '../lib/printLayout';
import {
  a3Page,
  areaDefaultLayout,
  areaFacilitiesTitle,
  areaMapFrame,
  AREA_SCALE_OPTIONS,
} from '../lib/areaPrintLayout';
import {
  areaAutoScaleFor,
  areaCenter,
  buildAreaLegendRows,
  createAreaSheetView,
  type AreaMapHandle,
  type AreaMapMode,
} from '../lib/areaPrintMap';
import { applyViewScale, waitForViewIdle } from '../lib/printMap';
import { drawAreaSheet, type AreaLegendRow } from '../lib/printDraw';
import type { FacilityRecord, LonLat } from '../types';

interface AreaMapExportModalProps {
  /** Підпис вибраної області, наприклад «Київська». */
  region: string;
  /** Лише активні заклади вибраної області. */
  facilities: FacilityRecord[];
  onClose: () => void;
}

/** Пікселів на міліметр для попереднього перегляду (96 dpi). */
const PREVIEW_PX_PER_MM = 96 / 25.4;
/** Роздільна здатність PDF-аркуша. */
const EXPORT_DPI = 300;

/** Початковий рядок легенди, доки шар не віддав умовні позначення. */
const DEFAULT_LEGEND_ROWS: AreaLegendRow[] = [{ label: 'Медичні заклади', image: null }];

export function AreaMapExportModal({ region, facilities, onClose }: AreaMapExportModalProps) {
  const { notify } = useToast();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const page = useMemo(() => a3Page(orientation), [orientation]);
  const frame = useMemo(() => areaMapFrame(page), [page]);
  const title = useMemo(() => areaFacilitiesTitle(region), [region]);

  const designW = Math.round(page.widthMm * PREVIEW_PX_PER_MM);
  const designH = Math.round(page.heightMm * PREVIEW_PX_PER_MM);

  const points = useMemo<LonLat[]>(
    () =>
      facilities
        .map((facility) => facility.location)
        .filter((point): point is LonLat => point !== undefined),
    [facilities],
  );
  const center = useMemo(() => areaCenter(points), [points]);
  const calculatedAutoScale = useMemo(
    () => areaAutoScaleFor(points, frame.wMm, frame.hMm),
    [points, frame],
  );

  const [userScale, setUserScale] = useState<number | 'auto'>('auto');
  const [customScaleMode, setCustomScaleMode] = useState(false);
  const [customScaleText, setCustomScaleText] = useState('');
  const currentScale = userScale === 'auto' ? calculatedAutoScale : userScale;

  const [legendRows, setLegendRows] = useState<AreaLegendRow[]>(DEFAULT_LEGEND_ROWS);
  const layout = useMemo(
    () => areaDefaultLayout(page, legendRows.length, currentScale),
    [page, legendRows.length, currentScale],
  );

  const facilityKey = useMemo(
    () => facilities.map((facility) => facility.id).join('|'),
    [facilities],
  );

  // Карта створюється один раз для набору закладів і не перезавантажується
  // при зміні масштабу чи орієнтації.
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [mapNotice, setMapNotice] = useState('');
  const [mapMode, setMapMode] = useState<AreaMapMode | null>(null);
  const [basemapTitle, setBasemapTitle] = useState('');

  const facilitiesRef = useRef(facilities);
  const centerRef = useRef(center);
  const autoScaleRef = useRef(calculatedAutoScale);
  facilitiesRef.current = facilities;
  centerRef.current = center;
  autoScaleRef.current = calculatedAutoScale;

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    let cancelled = false;
    let handle: AreaMapHandle | null = null;
    setMapReady(false);
    setMapError('');
    setMapNotice('');
    setMapMode(null);
    setBasemapTitle('');

    const initialCenter = centerRef.current;
    const initialScale = autoScaleRef.current;

    void createAreaSheetView(container, {
      facilities: facilitiesRef.current,
      token,
      expiresAt: session?.expiresAt ?? 0,
      center: initialCenter,
      scale: initialScale,
      isCancelled: () => cancelled,
    })
      .then(async (result) => {
        if (!result || cancelled) {
          result?.view.destroy();
          return;
        }
        handle = result;
        viewRef.current = result.view;
        setMapMode(result.mode);
        setBasemapTitle(result.basemapTitle);
        setMapNotice(result.notice);

        await applyViewScale(result.view, initialCenter, initialScale).catch(() => undefined);
        const rows = await buildAreaLegendRows(result, token, facilitiesRef.current);
        if (cancelled) return;
        setLegendRows(rows);
        setMapReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMapError(
          error instanceof Error ? error.message : 'Не вдалося завантажити карту області',
        );
      });

    return () => {
      cancelled = true;
      viewRef.current = null;
      handle?.view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, session?.expiresAt, facilityKey]);

  // Автоматичний масштаб перераховується при зміні орієнтації аркуша.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !mapReady || userScale !== 'auto') return;
    void applyViewScale(view, center, calculatedAutoScale);
  }, [mapReady, userScale, center, calculatedAutoScale]);

  // Після зміни орієнтації контейнер карти змінює розмір — просимо MapView
  // перерахувати розміри, щоб знімок і панування лишалися коректними.
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !mapReady) return;

    const resize = () => {
      (viewRef.current as unknown as { resize?: () => void } | null)?.resize?.();
    };
    const timeout = window.setTimeout(resize, 60);
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
    observer?.observe(container);

    return () => {
      window.clearTimeout(timeout);
      observer?.disconnect();
    };
  }, [mapReady, orientation]);

  // Логотип і стрілка півночі — ті самі, що на A4-карті маршруту.
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  const [northImg, setNorthImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || '/';
    loadSvgImage(`${base}symbols/HALO%20Logo%20Dark.svg`)
      .then((image) => setLogoImg(image))
      .catch((error) => console.warn('Logo SVG error:', error));

    loadSvgImage(`${base}symbols/north-arrow.svg`)
      .then((image) => setNorthImg(image))
      .catch((error) => console.warn('North arrow SVG error:', error));
  }, []);

  // === Попередній перегляд елементів аркуша ===
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAreaSheet(ctx, {
      page,
      layout,
      title,
      scale: currentScale,
      dpi: 96,
      logo: logoImg,
      northArrow: northImg,
      legendRows,
    });
  }, [page, layout, title, currentScale, logoImg, northImg, legendRows]);

  // === Масштаб ===
  const handleScaleChange = (value: string) => {
    if (value === 'custom') {
      setCustomScaleMode(true);
      return;
    }
    setCustomScaleMode(false);

    if (value === 'auto') {
      setUserScale('auto');
      const view = viewRef.current;
      if (view) void applyViewScale(view, center, calculatedAutoScale);
      return;
    }

    const scale = Number(value);
    setUserScale(scale);
    viewRef.current?.goTo({ scale }, { animate: false });
  };

  const handleCustomScaleInput = (raw: string) => {
    setCustomScaleText(raw);
    const scale = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(scale) && scale >= 100) {
      const rounded = Math.round(scale);
      setUserScale(rounded);
      viewRef.current?.goTo({ scale: rounded }, { animate: false });
    }
  };

  // === Масштабування попереднього перегляду під доступну площу ===
  const stageRef = useRef<HTMLDivElement>(null);
  const [previewFit, setPreviewFit] = useState(1);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const update = () => {
      const availableWidth = Math.max(160, element.clientWidth - 40);
      const availableHeight = Math.max(160, element.clientHeight - 40);
      const fit = Math.min(availableWidth / designW, availableHeight / designH, 1);
      setPreviewFit(Math.max(fit, 0.15));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [designW, designH]);

  // === Експорт A3 PDF ===
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    const view = viewRef.current;
    if (!view || !mapReady) {
      notify('Карта ще завантажується, зачекайте кілька секунд.', 'error');
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

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await waitForViewIdle(view);
      const screenshot = await view.takeScreenshot({
        width: Math.round(frame.wMm * pxPerMm),
        height: Math.round(frame.hMm * pxPerMm),
      });
      const mapImage = new Image();
      mapImage.src = screenshot.dataUrl;
      await new Promise<void>((resolve, reject) => {
        mapImage.onload = () => resolve();
        mapImage.onerror = () => reject(new Error('Не вдалося підготувати знімок карти'));
      });

      ctx.drawImage(
        mapImage,
        frame.xMm * pxPerMm,
        frame.yMm * pxPerMm,
        frame.wMm * pxPerMm,
        frame.hMm * pxPerMm,
      );

      drawAreaSheet(ctx, {
        page,
        layout,
        title,
        scale: currentScale,
        dpi: EXPORT_DPI,
        logo: logoImg,
        northArrow: northImg,
        legendRows,
      });

      const jpeg = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Помилка створення зображення'))),
          'image/jpeg',
          0.94,
        ),
      );
      const pdf = await jpegToPdf(
        { blob: jpeg, widthPx: canvas.width, heightPx: canvas.height },
        page,
      );
      saveAs(pdf, `CASEVAC_map_${region}_${todayIso()}.pdf`);
      notify('PDF карту області успішно збережено', 'success');
    } catch (error) {
      console.error(error);
      notify(
        error instanceof Error ? error.message : 'Помилка генерації PDF',
        'error',
      );
    } finally {
      setExporting(false);
    }
  };

  const mapStatus =
    mapError ||
    mapNotice ||
    (mapMode === 'webmap'
      ? 'Підкладка веб-карти. На карті — лише шар «Медичні заклади».'
      : 'Перетягуйте карту мишкою, щоб змінити її положення на аркуші.');

  return (
    <div className="print-export-overlay">
      <section
        className="print-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Експорт карти області"
      >
        <header className="print-export-header">
          <div>
            <h2>Карта області: {region}</h2>
            <p>
              A3 {page.widthMm}×{page.heightMm} мм · масштаб {scaleLabel(currentScale)}
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
                  Альбомний
                </button>
                <button
                  type="button"
                  className={orientation === 'portrait' ? 'selected' : ''}
                  onClick={() => setOrientation('portrait')}
                >
                  Портретний
                </button>
              </div>
            </div>

            <div className="print-control">
              <span className="print-control-label">Масштаб карти</span>
              <select
                value={customScaleMode ? 'custom' : userScale === 'auto' ? 'auto' : String(userScale)}
                onChange={(event) => handleScaleChange(event.target.value)}
              >
                <option value="auto">Авто — {scaleLabel(calculatedAutoScale)}</option>
                {AREA_SCALE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {scaleLabel(value)}
                  </option>
                ))}
                <option value="custom">Інший масштаб…</option>
              </select>
              {customScaleMode && (
                <input
                  type="number"
                  min={100}
                  step={1000}
                  value={customScaleText}
                  placeholder="Наприклад 350000"
                  onChange={(event) => handleCustomScaleInput(event.target.value)}
                />
              )}
            </div>

            <div className="print-control">
              <span className="print-control-label">Підкладка</span>
              <p className="print-control-hint" style={{ margin: 0 }}>
                {basemapTitle || 'Завантаження…'}
              </p>
            </div>

            <p className="print-control-hint">{mapStatus}</p>

            <button
              className="button button-primary print-export-submit"
              onClick={() => void handleExport()}
              disabled={exporting || !mapReady}
              type="button"
            >
              {exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
              {exporting ? 'Формуємо PDF…' : 'Завантажити PDF'}
            </button>
          </aside>

          <div className="print-export-stage" ref={stageRef}>
            <div
              className="print-sheet-holder"
              style={{ width: designW * previewFit, height: designH * previewFit }}
            >
              <div
                className="print-sheet"
                style={{
                  width: designW,
                  height: designH,
                  transform: `scale(${previewFit})`,
                }}
              >
                <div
                  ref={mapContainerRef}
                  className="print-sheet-map"
                  style={{
                    left: frame.xMm * PREVIEW_PX_PER_MM,
                    top: frame.yMm * PREVIEW_PX_PER_MM,
                    width: frame.wMm * PREVIEW_PX_PER_MM,
                    height: frame.hMm * PREVIEW_PX_PER_MM,
                  }}
                />

                <canvas
                  ref={overlayCanvasRef}
                  className="print-sheet-overlay"
                  width={designW}
                  height={designH}
                  style={{ pointerEvents: 'none' }}
                />

                {(!mapReady || mapError) && (
                  <div className="print-sheet-loading">
                    {mapError ? (
                      <span>Не вдалося завантажити карту: {mapError}</span>
                    ) : (
                      <>
                        <Loader2 size={18} className="spin" /> Завантаження карти…
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
