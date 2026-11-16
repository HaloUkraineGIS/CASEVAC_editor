/**
 * Шар «Населені пункти» на картах маршрутів.
 *
 * Шар прихований у веб-карті Portal, але має показуватися на карті
 * редагування маршрутів і на карті експорту маршруту — без додавання
 * в легенду (за це відповідає `legendEnabled = false`: легенда ArcGIS
 * не показує такі шари, а на карту й LayerList це не впливає).
 */

import type Collection from '@arcgis/core/core/Collection.js';
import type Layer from '@arcgis/core/layers/Layer.js';
import { findLayerByTitle, type NamedLayerHit } from './medicalLayers';
export { exposeLayerWithoutLegend as exposeSettlementsLayer } from './medicalLayers';
export type SettlementsHit = NamedLayerHit;

/** Впізнаємо шар за назвою (регістронезалежно, українською або англійською). */
export function isSettlementsTitle(title: string | null | undefined): boolean {
  const text = (title ?? '').toLowerCase();
  return (
    (text.includes('населен') && text.includes('пункт')) ||
    text.includes('settlement') ||
    text.includes('populated')
  );
}

/** Ключові слова назви шару населених пунктів. */
const SETTLEMENT_KEYWORDS = [['населен', 'пункт'], ['settlement'], ['populated']];

/** Знаходить шар населених пунктів (див. `findLayerByTitle`). */
export function findSettlementsLayer(
  layers: Collection<Layer> | Layer[],
): SettlementsHit | null {
  return findLayerByTitle(layers, SETTLEMENT_KEYWORDS);
}
