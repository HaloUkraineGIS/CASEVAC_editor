/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_MODE?: 'demo' | 'portal';
  readonly VITE_PORTAL_URL?: string;
  readonly VITE_OAUTH_CLIENT_ID?: string;
  readonly VITE_OAUTH_REDIRECT_URI?: string;
  readonly VITE_WEBMAP_ID?: string;
  readonly VITE_ROUTING_PROVIDER?: 'arcgis' | 'osrm';
  readonly VITE_ROUTING_ARCGIS_URL?: string;
  readonly VITE_ROUTING_OSRM_URL?: string;
  readonly VITE_ROUTING_TIMEOUT_MS?: string;
  readonly VITE_ROUTING_SIMPLIFY_METERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
