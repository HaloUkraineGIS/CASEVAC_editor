/// <reference types="vite/client" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/CASEVAC_editor/',
  optimizeDeps: {
    include: [
      '@arcgis/core/Basemap.js',
      '@arcgis/core/config.js',
      '@arcgis/core/geometry/Point.js',
      '@arcgis/core/Graphic.js',
      '@arcgis/core/identity/IdentityManager.js',
      '@arcgis/core/layers/FeatureLayer.js',
      '@arcgis/core/layers/GraphicsLayer.js',
      '@arcgis/core/layers/MapImageLayer.js',
      '@arcgis/core/layers/TileLayer.js',
      '@arcgis/core/layers/WebTileLayer.js',
      '@arcgis/core/Map.js',
      '@arcgis/core/renderers/SimpleRenderer.js',
      '@arcgis/core/symbols/SimpleLineSymbol.js',
      '@arcgis/core/symbols/SimpleMarkerSymbol.js',
      '@arcgis/core/views/MapView.js',
      '@arcgis/core/WebMap.js',
      '@arcgis/core/widgets/Legend.js',
    ],
  },
  server: {
    watch: {
      // Templates are input assets and may be locked by Office/PDF viewers on Windows.
      ignored: ['**/template/**'],
    },
  },
});
