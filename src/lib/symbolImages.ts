/**
 * Растрові зображення умовних позначень для легенди PDF.
 *
 * ArcGIS малює символи у SVG, а полотно PDF приймає лише `CanvasImageSource`.
 * Тому символ спершу перетворюється на SVG-зображення, а потім — на `Image`,
 * який можна вставити в легенду поруч із тим самим знаком на карті.
 */

import type { SymbolUnion } from '@arcgis/core/symbols/types.js';
import { renderPreviewHTML } from '@arcgis/core/symbols/support/symbolUtils.js';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Зовнішні символи (наприклад, picture-marker із URL Portal) завантажуємо
    // з CORS, інакше зображення «забруднить» canvas і PDF не вдасться зберегти.
    if (!src.startsWith('data:')) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не вдалося завантажити зображення символу'));
    image.src = src;
  });
}

/**
 * Перетворює елемент попереднього перегляду символу (як його малює ArcGIS)
 * на `Image`. Підтримує як сам `<svg>`/`<img>`, так і контейнер навколо них.
 */
export function legendElementToImage(element: HTMLElement): Promise<HTMLImageElement> | null {
  // `renderPreviewHTML` повертає контейнер <div>, усередині якого лежить
  // <svg> (звичайні символи) або <img> (picture-marker). Беремо саме вкладений
  // елемент — інакше всі позначки легенди були б порожніми.
  const target = element.matches('svg, img')
    ? element
    : element.querySelector<SVGElement | HTMLImageElement>('svg, img');
  if (!target) return null;

  const tag = target.tagName.toLowerCase();

  if (tag === 'img') {
    const src = (target as HTMLImageElement).src;
    return src ? loadImage(src) : null;
  }

  if (tag !== 'svg') return null;

  const svg = target as SVGElement;
  // Для коректного naturalWidth/naturalHeight у SVG мають бути явні розміри.
  if (!svg.getAttribute('width') || !svg.getAttribute('height')) {
    const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const width = viewBox?.length === 4 ? viewBox[2] : 48;
    const height = viewBox?.length === 4 ? viewBox[3] : 48;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
  }

  // Вбудовані зображення (imageData) уже містяться в SVG, тому серіалізований
  // рядок є самодостатнім і не потребує доступу до сервісу.
  const serialized = new XMLSerializer().serializeToString(svg);
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`);
}

function pictureMarkerDataUrl(symbol: SymbolUnion): string | null {
  const candidate = symbol as { type?: string; url?: string | null };
  if (candidate.type !== 'picture-marker' && candidate.type !== 'esriPMS') return null;
  return candidate.url?.startsWith('data:') ? candidate.url : null;
}

/**
 * Повертає зображення символу для легенди або `null`, якщо символ не вдалося
 * відтворити (тоді легенда малює стандартну позначку).
 */
export async function symbolPreviewImage(
  symbol: SymbolUnion | null | undefined,
): Promise<HTMLImageElement | null> {
  if (!symbol) return null;

  try {
    // WebStyleSymbol та частина CIM-символів доступні лише після load().
    const loadable = symbol as { load?: () => Promise<unknown>; loaded?: boolean };
    if (loadable.loaded === false && typeof loadable.load === 'function') {
      await loadable.load();
    }

    const dataUrl = pictureMarkerDataUrl(symbol);
    if (dataUrl) return await loadImage(dataUrl);

    const element = await renderPreviewHTML(symbol, { size: { width: 48, height: 48 } });
    if (!element) return null;
    const image = legendElementToImage(element);
    return image ? await image : null;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[symbolImages] Не вдалося підготувати позначку для легенди', error);
    }
    return null;
  }
}
