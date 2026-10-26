/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_MODE?: 'demo' | 'portal';
  readonly VITE_PORTAL_URL?: string;
  readonly VITE_OAUTH_CLIENT_ID?: string;
  readonly VITE_OAUTH_REDIRECT_URI?: string;
  readonly VITE_WEBMAP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
