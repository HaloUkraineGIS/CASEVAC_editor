/**
 * Робота з шаром «Медичні заклади» у веб-карті Portal.
 *
 * Ці функції використовують і оглядова карта закладів, і експорт карти
 * області: потрібно однаково знаходити медичний шар, ховати решту шарів
 * веб-карти та читати OBJECTID з атрибутів.
 */

import type Collection from '@arcgis/core/core/Collection.js';
import type FeatureLayer from '@arcgis/core/layers/FeatureLayer.js';
import type GroupLayer from '@arcgis/core/layers/GroupLayer.js';
import type Layer from '@arcgis/core/layers/Layer.js';
import type MapImageLayer from '@arcgis/core/layers/MapImageLayer.js';
import type Sublayer from '@arcgis/core/layers/support/Sublayer.js';
import { appConfig } from '../config/appConfig';

export interface MedicalTarget {
  layer: Layer | Sublayer;
  objectIdField: string;
  /** Початковий вираз шару у веб-карті, який не можна губити. */
  baseExpression: string;
}

/** Чи це шар медичних закладів (за назвою або URL сервісу). */
export function isMedicalLayer(candidate: {
  title?: string | null;
  url?: string | null;
}): boolean {
  const title = (candidate.title ?? '').toLowerCase();
  const titleMatch =
    title.includes('medical') ||
    title.includes('медичних') ||
    title.includes('заклад') ||
    title === 'medical';
  if (titleMatch) return true;
  const url = (candidate.url ?? '').toLowerCase();
  return url.length > 0 && url.startsWith(appConfig.services.facilities.url.toLowerCase());
}

/**
 * Ховає всі шари веб-карти, крім «Medical facilities». Групи лишаються
 * видимими, якщо всередині є медичний шар; у MapImageLayer видимими
 * лишаються тільки медичні підшари.
 */
export function isolateMedicalLayers(layers: Collection<Layer>): boolean {
  let anyVisible = false;
  layers.forEach((layer) => {
    const layerMatch = isMedicalLayer(layer);
    let visible = layerMatch;
    if (layer.type === 'group') {
      visible = isolateMedicalLayers((layer as GroupLayer).layers) || layerMatch;
    } else if (layer.type === 'map-image') {
      let visibleSublayer = false;
      (layer as MapImageLayer).sublayers?.forEach((sublayer) => {
        const match = layerMatch || isMedicalLayer(sublayer);
        sublayer.visible = match;
        visibleSublayer = visibleSublayer || match;
      });
      visible = layerMatch || visibleSublayer;
    }
    layer.visible = visible;
    anyVisible = anyVisible || visible;
  });
  return anyVisible;
}

/** Знаходить шар медичних закладів для фільтрації та визначення OBJECTID. */
export function findMedicalTarget(layers: Collection<Layer>): MedicalTarget | null {
  const items = layers.toArray();
  for (const layer of items) {
    if (layer.type === 'group') {
      const nested = findMedicalTarget((layer as GroupLayer).layers);
      if (nested) return nested;
      continue;
    }
    if (layer.type === 'map-image') {
      const mapImage = layer as MapImageLayer;
      for (const sublayer of mapImage.sublayers?.toArray() ?? []) {
        if (isMedicalLayer(sublayer)) {
          return {
            layer: sublayer,
            objectIdField: 'objectid',
            baseExpression: sublayer.definitionExpression ?? '',
          };
        }
      }
    }
    if (layer.type === 'feature' && isMedicalLayer(layer)) {
      const featureLayer = layer as FeatureLayer;
      return {
        layer,
        objectIdField: featureLayer.objectIdField || 'objectid',
        baseExpression: featureLayer.definitionExpression ?? '',
      };
    }
  }
  return null;
}

/** Знайдений за назвою шар веб-карти разом із ланцюжком батьків. */
export interface NamedLayerHit {
  layer: Layer | Sublayer;
  ancestors: Layer[];
  /** Чи був шар уже видимим до втручання. */
  alreadyVisible: boolean;
}

/**
 * Шукає шар за ключовими словами в назві (регістронезалежно).
 *
 * Достатньо, щоб збіглася будь-яка група (усі слова в ній).
 * Шукає включно з групами та підшарами MapImageLayer.
 */
export function findLayerByTitle(
  layers: Collection<Layer> | Layer[],
  keywords: string[][],
): NamedLayerHit | null {
  const list = Array.isArray(layers) ? layers : layers.toArray();
  const matches = (title: string | null | undefined): boolean => {
    const text = (title ?? '').toLowerCase();
    return keywords.some((group) => group.every((word) => text.includes(word)));
  };

  const walk = (items: Layer[], ancestors: Layer[]): NamedLayerHit | null => {
    for (const layer of items) {
      if (matches(layer.title)) {
        return { layer, ancestors, alreadyVisible: layer.visible };
      }
      if (layer.type === 'group') {
        const found = walk((layer as GroupLayer).layers.toArray(), [...ancestors, layer]);
        if (found) return found;
      } else if (layer.type === 'map-image') {
        const subs = (layer as MapImageLayer).sublayers?.toArray() ?? [];
        for (const sub of subs) {
          if (matches(sub.title)) {
            return {
              layer: sub,
              ancestors: [...ancestors, layer],
              alreadyVisible: sub.visible,
            };
          }
          const nested = (sub as unknown as { sublayers?: Collection<Sublayer> }).sublayers?.toArray() ?? [];
          if (nested.length > 0) {
            const found = walk(nested as unknown as Layer[], [...ancestors, layer, sub as unknown as Layer]);
            if (found) return found;
          }
        }
      }
    }
    return null;
  };

  return walk(list, []);
}

/**
 * Показує шар на карті, але ховає з легенди.
 *
 * Повертає назви шарів, у яких довелося ввімкнути видимість (для діагностики).
 * Батьківські групи/сервіси теж вмикаються — інакше вкладений шар
 * не відмалюється. `legendEnabled = false` ставиться лише на сам шар,
 * тому решта легенди не змінюється.
 */
export function exposeLayerWithoutLegend(hit: NamedLayerHit): string[] {
  const toggled: string[] = [];
  for (const ancestor of hit.ancestors) {
    const holder = ancestor as unknown as { visible?: boolean };
    if (holder.visible === false) {
      holder.visible = true;
      toggled.push(ancestor.title || 'без назви');
    }
  }
  const target = hit.layer as unknown as { visible?: boolean; legendEnabled?: boolean };
  if (target.visible === false) {
    target.visible = true;
    toggled.push(
      (hit.layer as unknown as { title?: string }).title || 'без назви',
    );
  }
  // У легенду шар не додаємо — лише на карту.
  target.legendEnabled = false;
  return toggled;
}

/** OBJECTID з атрибутів графіка (назва поля у різних шарах відрізняється). */
export function readObjectId(
  attributes: Record<string, unknown>,
  field: string,
): number | undefined {
  const direct = attributes[field];
  const directNumber = typeof direct === 'number' ? direct : Number(direct);
  if (direct !== undefined && direct !== null && Number.isFinite(directNumber)) {
    return directNumber;
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (!key.toLowerCase().endsWith('objectid')) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
