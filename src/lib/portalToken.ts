import esriConfig from '@arcgis/core/config.js';
import IdentityManager from '@arcgis/core/identity/IdentityManager.js';
import { appConfig } from '../config/appConfig';

/**
 * Реєструє токен Portal для веб-карт і пов'язаних сервісів.
 *
 * Потрібно перед завантаженням `WebMap` та шарів, опублікованих у Portal
 * або на gis-services.htgoims.org.
 */
export function registerPortalToken(token: string, expiresAt: number): void {
  esriConfig.portalUrl = appConfig.portalUrl;
  const expires = expiresAt > Date.now() ? expiresAt : undefined;
  IdentityManager.registerToken({
    server: `${appConfig.portalUrl}/sharing/rest`,
    token,
    expires,
    ssl: true,
  });
  // Сервіси, опубліковані на федеративному сервері Portal (зокрема Route_World).
  IdentityManager.registerToken({
    server: `${appConfig.portalUrl}/sharing/servers`,
    token,
    expires,
    ssl: true,
  });
  IdentityManager.registerToken({
    server: 'https://gis-services.htgoims.org/arcgis/rest/services',
    token,
    expires,
    ssl: true,
  });
  IdentityManager.registerToken({
    server: 'https://gis.htgoims.org/server/rest/services',
    token,
    expires,
    ssl: true,
  });
}
