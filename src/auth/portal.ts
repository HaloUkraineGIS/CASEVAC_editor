/** Запити до ArcGIS Portal REST API від імені користувача. */

export interface PortalUser {
  username: string;
  fullName: string;
  email: string;
  role: string;
  thumbnail?: string;
}

interface RawPortalSelf {
  username?: string;
  fullName?: string;
  email?: string;
  role?: string;
  thumbnail?: string;
  error?: {
    message?: string;
    details?: string[];
  };
}

export async function fetchPortalUser(portalUrl: string, token: string): Promise<PortalUser> {
  const url = new URL(`${portalUrl}/sharing/rest/community/self`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('token', token);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Portal повернув HTTP ${response.status}`);
  }

  const payload = (await response.json()) as RawPortalSelf;
  if (payload.error) {
    throw new Error(payload.error.message ?? 'Не вдалося отримати дані користувача Portal');
  }

  return {
    username: payload.username ?? '',
    fullName: payload.fullName?.trim() || payload.username || 'Користувач Portal',
    email: payload.email ?? '',
    role: payload.role ?? '',
    thumbnail: payload.thumbnail,
  };
}

/** Адреса виходу з Portal (використовується за потреби в новій вкладці). */
export function buildPortalLogoutUrl(portalUrl: string, clientId: string, redirectUri: string): string {
  const url = new URL(`${portalUrl}/sharing/rest/oauth2/portal/logout`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  return url.toString();
}
