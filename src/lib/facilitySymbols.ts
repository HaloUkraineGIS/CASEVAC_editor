/**
 * Символи точок медичних закладів, спільні для карти закладів і демо-графіки
 * A3-аркуша.
 *
 * Легенда експорту має показувати ті самі позначки, що й карта. Щоб демо-режим
 * (без шару Portal) не малював «свій» символ, обидві карти беруть його звідси.
 */

import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';

/** Активний (перевірений) медичний заклад. */
export const FACILITY_VERIFIED_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 8,
  color: [66, 170, 120],
  outline: { color: [255, 255, 255], width: 1 },
});

/** Заклад, який давно не обстежували. */
export const FACILITY_STALE_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 8,
  color: [214, 163, 82],
  outline: { color: [255, 255, 255], width: 1 },
});

/** Вибраний заклад у списку. */
export const FACILITY_SELECTED_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 16,
  color: [190, 92, 71],
  outline: { color: [255, 255, 255], width: 2 },
});

/** Кільце навколо вибраного закладу, коли символи дає шар веб-карти. */
export const FACILITY_SELECTION_RING = new SimpleMarkerSymbol({
  style: 'circle',
  size: 24,
  color: [0, 0, 0, 0],
  outline: { color: [21, 122, 90], width: 2.5 },
});
