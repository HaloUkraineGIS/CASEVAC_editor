/**
 * Умовні позначення точкових шарів для експорту карти маршруту.
 *
 * Символ береться з `drawingInfo.renderer` шару, який показано на основній
 * карті маршрутів. Основний шлях — рендерер, який карта вже завантажила з
 * Portal (він може відрізнятися від сервісного, якщо його перевизначено у
 * веб-карті). Якщо карта ще не встигла його зберегти, читаємо `?f=json`
 * безпосередньо із сервісу.
 *
 * Символи кешуються: один і той самий об'єкт повертається для того самого
 * шару й значення поля, тому повторні виклики не створюють нових екземплярів.
 */

import { fromJSON as symbolFromJSON } from '@arcgis/core/symbols/support/jsonUtils.js';
import type { SymbolUnion } from '@arcgis/core/symbols/types.js';

export type SymbolLayerKind = 'facility' | 'start';

type JsonObject = Record<string, unknown>;

interface RawUniqueValueInfo {
  value?: unknown;
  values?: unknown[][];
  symbol?: unknown;
  label?: string;
}

interface RawRenderer extends JsonObject {
  type?: string;
  symbol?: unknown;
  defaultSymbol?: unknown;
  /** Плоский список класів (JS API `toJSON()`). */
  uniqueValueInfos?: RawUniqueValueInfo[];
  /** Групований список класів (відповідь REST `drawingInfo.renderer`). */
  uniqueValueGroups?: { classes?: RawUniqueValueInfo[] }[];
  classBreakInfos?: { symbol?: unknown; label?: string }[];
  /** JS API пише `field`, REST — `field1`…`field3`. */
  field?: string;
  field1?: string;
  field2?: string;
  field3?: string;
  fieldDelimiter?: string;
  /** Загальний підпис рендерера (не у всіх форматах). */
  label?: string;
}

interface RawLayerResponse extends JsonObject {
  error?: { code?: number | string; message?: string };
  drawingInfo?: { renderer?: RawRenderer | null } | null;
}

/** Рендерери, отримані з уже завантаженої карти Portal. */
const rememberedRenderers = new Map<SymbolLayerKind, RawRenderer>();

/** Рендерери, прочитані із сервісу (ключ — URL шару). */
const serviceRenderers = new Map<string, Promise<RawRenderer | null>>();

/** Готові символи (ключ — шар + поля рендерера + значення). */
const symbolCache = new Map<string, Promise<SymbolUnion | null>>();

/** Запам'ятовує рендерер шару, який зараз показано на карті. */
export function rememberLayerRenderer(kind: SymbolLayerKind, renderer: unknown): void {
  if (!renderer || typeof renderer !== 'object') return;
  const candidate = renderer as RawRenderer;
  if (!candidate.type) return;
  rememberedRenderers.set(kind, candidate);
}

function readAttribute(attributes: Record<string, unknown>, field: string): unknown {
  if (field in attributes) return attributes[field];
  const lower = field.toLowerCase();
  const key = Object.keys(attributes).find((name) => name.toLowerCase() === lower);
  return key ? attributes[key] : undefined;
}

/** Усі класи рендерера незалежно від форми запису (плоскої чи групованої). */
function rendererInfos(renderer: RawRenderer): RawUniqueValueInfo[] {
  if (renderer.uniqueValueInfos?.length) return renderer.uniqueValueInfos;
  return (renderer.uniqueValueGroups ?? []).flatMap((group) => group.classes ?? []);
}

/** Значення полів рендерера для конкретного об'єкта (якщо їх можна визначити). */
function rendererValues(renderer: RawRenderer, attributes: Record<string, unknown>): unknown[] | undefined {
  const fields = [renderer.field, renderer.field1, renderer.field2, renderer.field3].filter(
    (field, index, all): field is string =>
      typeof field === 'string' && field.length > 0 && all.indexOf(field) === index,
  );
  if (fields.length === 0) return undefined;
  const values = fields.map((field) => readAttribute(attributes, field));
  return values.some((value) => value === undefined || value === null) ? undefined : values;
}

function valueMatches(infoValue: unknown, values: unknown[], delimiter: string): boolean {
  if (values.length === 1) return String(infoValue) === String(values[0]);
  const parts = String(infoValue ?? '').split(delimiter);
  return parts.length === values.length && parts.every((part, index) => part === String(values[index]));
}

function infoMatches(info: RawUniqueValueInfo, values: unknown[], delimiter: string): boolean {
  // Групований формат: values — масив наборів значень для кожного класу.
  const grouped = info.values?.[0];
  if (Array.isArray(grouped) && grouped.length === values.length) {
    return grouped.every((value, index) => String(value) === String(values[index]));
  }
  return info.value !== undefined && valueMatches(info.value, values, delimiter);
}

/** Вибір символу з рендерера: простий / унікальні значення / класи. */
function pickSymbolJson(renderer: RawRenderer, attributes: Record<string, unknown>): unknown {
  switch (renderer.type) {
    case 'simple':
      return renderer.symbol ?? null;
    // REST і toJSON() пишуть `uniqueValue`, а властивість JS API — `unique-value`.
    case 'unique-value':
    case 'uniqueValue': {
      const infos = rendererInfos(renderer);
      const values = rendererValues(renderer, attributes);
      if (values) {
        const delimiter = renderer.fieldDelimiter ?? ',';
        const match = infos.find((info) => infoMatches(info, values, delimiter));
        if (match?.symbol) return match.symbol;
      }
      return renderer.defaultSymbol ?? infos[0]?.symbol ?? null;
    }
    case 'class-breaks':
    case 'classBreaks':
      return renderer.defaultSymbol ?? renderer.classBreakInfos?.[0]?.symbol ?? null;
    default:
      return renderer.symbol ?? null;
  }
}

/** Чи можна намалювати символ на точці. */
function isPointSymbolJson(symbol: unknown): boolean {
  if (!symbol || typeof symbol !== 'object') return false;
  const type = (symbol as { type?: string }).type;
  // `esriSMS`/`esriPMS` — REST-формат, `simple-marker`/`picture-marker` — toJSON() JS API.
  if (type === 'esriSMS' || type === 'esriPMS') return true;
  if (type === 'simple-marker' || type === 'picture-marker') return true;
  if (type === 'cim') {
    const dataType = (symbol as { data?: { type?: string } }).data?.type;
    return typeof dataType === 'string' && dataType.includes('Point');
  }
  return false;
}

async function fetchRenderer(url: string, token?: string | null): Promise<RawRenderer | null> {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set('f', 'json');
  if (token) requestUrl.searchParams.set('token', token);

  const response = await fetch(requestUrl.toString());
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as RawLayerResponse;
  if (payload.error) {
    throw new Error(payload.error.message ?? 'невідома помилка сервісу');
  }
  return payload.drawingInfo?.renderer ?? null;
}

function getServiceRenderer(url: string, token?: string | null): Promise<RawRenderer | null> {
  const cached = serviceRenderers.get(url);
  if (cached) return cached;
  const request = fetchRenderer(url, token).catch((error) => {
    // Невдалу спробу не кешуємо: наступне відкриття вікна може мати свіжий токен.
    serviceRenderers.delete(url);
    if (import.meta.env.DEV) {
      console.warn('[layerSymbols] Не вдалося прочитати стиль шару', url, error);
    }
    return null;
  });
  serviceRenderers.set(url, request);
  return request;
}

export interface ResolveLayerSymbolOptions {
  url: string;
  token?: string | null;
  /** Атрибути об'єкта — потрібні для рендерерів за унікальними значеннями. */
  attributes?: Record<string, unknown>;
}

/** Повертає символ точки з шару або `null`, якщо його не вдалося визначити. */
export async function resolveLayerPointSymbol(
  kind: SymbolLayerKind,
  { url, token, attributes = {} }: ResolveLayerSymbolOptions,
): Promise<SymbolUnion | null> {
  const remembered = rememberedRenderers.get(kind);
  let renderer: RawRenderer | null = null;
  let source = 'map';

  if (remembered && isPointSymbolJson(pickSymbolJson(remembered, attributes))) {
    renderer = remembered;
  } else {
    renderer = await getServiceRenderer(url, token);
    source = url;
  }
  if (!renderer) return null;

  const values = rendererValues(renderer, attributes);
  const symbolJson = pickSymbolJson(renderer, attributes);
  if (!isPointSymbolJson(symbolJson)) return null;

  const valueKey = values ? values.map((value) => String(value)).join('\u0001') : '';
  const fieldKey = renderer.field ?? renderer.field1 ?? '';
  const key = [kind, source, renderer.type ?? '', fieldKey, valueKey].join('\u0000');

  const cached = symbolCache.get(key);
  if (cached) return cached;

  const request = Promise.resolve()
    .then(() => symbolFromJSON(symbolJson))
    .then((symbol) => (symbol as SymbolUnion | null) ?? null)
    .catch((error) => {
      symbolCache.delete(key);
      if (import.meta.env.DEV) {
        console.warn('[layerSymbols] Не вдалося створити символ', url, error);
      }
      return null;
    });

  symbolCache.set(key, request);
  return request;
}

export interface LayerLegendEntry {
  label: string;
  symbol: SymbolUnion;
}

/** Підпис класу легенди: явний label, значення або загальний підпис шару. */
function legendEntryLabel(
  info: RawUniqueValueInfo,
  index: number,
  total: number,
  fallbackLabel: string,
): string {
  const explicit = typeof info.label === 'string' ? info.label.trim() : '';
  if (explicit) return explicit;
  if (total === 1 && fallbackLabel) return fallbackLabel;
  const rawValue = info.value ?? info.values?.[0]?.[0];
  if (rawValue !== undefined && rawValue !== null && String(rawValue).trim()) {
    return String(rawValue);
  }
  return fallbackLabel ? `${fallbackLabel} ${index + 1}` : `Клас ${index + 1}`;
}

function rendererLegendItems(
  renderer: RawRenderer,
  fallbackLabel: string,
): { label: string; symbolJson: unknown }[] {
  switch (renderer.type) {
    case 'unique-value':
    case 'uniqueValue': {
      const infos = rendererInfos(renderer);
      return infos.map((info, index) => ({
        label: legendEntryLabel(info, index, infos.length, fallbackLabel),
        symbolJson: info.symbol,
      }));
    }
    case 'class-breaks':
    case 'classBreaks': {
      const infos = renderer.classBreakInfos ?? [];
      return infos.map((info, index) => ({
        label:
          (typeof info.label === 'string' && info.label.trim()) ||
          (infos.length === 1 ? fallbackLabel : `${fallbackLabel} ${index + 1}`),
        symbolJson: info.symbol,
      }));
    }
    default:
      return [
        {
          label: fallbackLabel || 'Медичні заклади',
          symbolJson: pickSymbolJson(renderer, {}),
        },
      ];
  }
}

/**
 * Будує рядки легенди з рендерера шару.
 *
 * Потрібно для експорту карти області: на аркуші показуємо саме ті умовні
 * позначення, які налаштовані в шарі «Медичні заклади», а не одну умовну
 * позначку. Підкладка в легенду не потрапляє.
 */
export async function legendFromRenderer(
  rendererJson: unknown,
  fallbackLabel = 'Медичні заклади',
): Promise<LayerLegendEntry[]> {
  if (!rendererJson || typeof rendererJson !== 'object') return [];
  const renderer = rendererJson as RawRenderer;
  const rawItems = rendererLegendItems(renderer, fallbackLabel).filter((item) =>
    isPointSymbolJson(item.symbolJson),
  );

  const entries = await Promise.all(
    rawItems.map(async (item) => {
      try {
        const symbol = await symbolFromJSON(item.symbolJson);
        return symbol ? { label: item.label, symbol: symbol as SymbolUnion } : null;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[layerSymbols] Не вдалося створити символ легенди', error);
        }
        return null;
      }
    }),
  );

  // На A3-аркуші більше 8 рядків легенди вже нечитабельні.
  return entries
    .filter((entry): entry is LayerLegendEntry => entry !== null)
    .slice(0, 8);
}

/** Читає рендерер безпосередньо із сервісу шару (без глобального кешу карти). */
export async function resolveLayerLegendFromService(
  url: string,
  token?: string | null,
  fallbackLabel = 'Медичні заклади',
): Promise<LayerLegendEntry[]> {
  const renderer = await getServiceRenderer(url, token);
  if (!renderer) return [];
  return legendFromRenderer(renderer, fallbackLabel);
}
