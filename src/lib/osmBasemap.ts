import Basemap from '@arcgis/core/Basemap.js';
import TileLayer from '@arcgis/core/layers/TileLayer.js';
import WebTileLayer from '@arcgis/core/layers/WebTileLayer.js';

/**
 * Підкладки, доступні на картах застосунку.
 *
 * Назви на кшталт `basemap: 'osm'` у ArcGIS SDK 5 не завантажуються
 * (basemap id не знаходиться), тому кожну підкладку збираємо явно з шарів.
 * Це також гарантує, що карта не залежить від токена Portal і не відкриває
 * діалог входу Esri.
 */
export type BasemapKey = 'osm' | 'topo' | 'imagery';

export const BASEMAP_OPTIONS: { key: BasemapKey; label: string }[] = [
  { key: 'osm', label: 'OSM' },
  { key: 'topo', label: 'Esri Topographic' },
  { key: 'imagery', label: 'Imagery Hybrid' },
];

const ESRI_WORLD_TOPO =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer';
const ESRI_WORLD_IMAGERY =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const ESRI_WORLD_BOUNDARIES =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer';

/** Відкрита підкладка OpenStreetMap. */
export function createOsmBasemap(): Basemap {
  return new Basemap({
    baseLayers: [
      new WebTileLayer({
        urlTemplate: 'https://tile.openstreetmap.org/{level}/{col}/{row}.png',
        title: 'OpenStreetMap',
        copyright: '© OpenStreetMap contributors',
      }),
    ],
    title: 'OpenStreetMap',
  });
}

function createTopoBasemap(): Basemap {
  return new Basemap({
    baseLayers: [new TileLayer({ url: ESRI_WORLD_TOPO, title: 'Esri Topographic' })],
    title: 'Esri Topographic',
  });
}

function createImageryBasemap(): Basemap {
  return new Basemap({
    baseLayers: [new TileLayer({ url: ESRI_WORLD_IMAGERY, title: 'Imagery' })],
    referenceLayers: [
      new TileLayer({ url: ESRI_WORLD_BOUNDARIES, title: 'Boundaries and Places' }),
    ],
    title: 'Imagery Hybrid',
  });
}

/** Створює підкладку за ключем із випадаючого списку. */
export function createBasemap(key: BasemapKey): Basemap {
  switch (key) {
    case 'topo':
      return createTopoBasemap();
    case 'imagery':
      return createImageryBasemap();
    case 'osm':
    default:
      return createOsmBasemap();
  }
}
