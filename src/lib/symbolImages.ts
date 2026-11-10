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
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не вдалося завантажити зображення символу'));
    image.src = src;
  });
}

function elementToImage(element: HTMLElement): Promise<HTMLImageElement> | null {
  const tag = element.tagName.toLowerCase();

  if (tag === 'img') {
    const src = (element as HTMLImageElement).src;
    return src ? loadImage(src) : null;
  }

  if (tag !== 'svg') return null;

  // Вбудовані зображення (imageData) уже містяться в SVG, тому серіалізований
  // рядок є самодостатнім і не потребує доступу до сервісу.
  const svg = new XMLSerializer().serializeToString(element);
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
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
    const dataUrl = pictureMarkerDataUrl(symbol);
    if (dataUrl) return await loadImage(dataUrl);

    const element = await renderPreviewHTML(symbol, { size: { width: 48, height: 48 } });
    if (!element) return null;
    const image = elementToImage(element);
    return image ? await image : null;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[symbolImages] Не вдалося підготувати позначку для легенди', error);
    }
    return null;
  }
}
