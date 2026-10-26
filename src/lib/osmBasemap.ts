import Basemap from '@arcgis/core/Basemap.js';
import WebTileLayer from '@arcgis/core/layers/WebTileLayer.js';

/**
 * Відкрита підкладка OpenStreetMap для карт застосунку.
 *
 * Назва `basemap: 'osm'` у ArcGIS SDK 5 не завантажується (basemap id
 * не знаходиться), тому підкладку збираємо явно з WebTileLayer. Це також
 * гарантує, що карта не залежить від токена Portal і не відкриває діалог
 * входу Esri.
 */
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
