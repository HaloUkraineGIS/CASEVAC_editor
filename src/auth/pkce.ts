/**
 * OAuth 2.0 Authorization Code + PKCE для ArcGIS Enterprise Portal.
 *
 * Реалізовано без Client Secret: у браузері зберігається лише code_verifier
 * на час входу. Токен доступу зберігається в sessionStorage (FR-2).
 */

export interface PkcePair {
  verifier: string;
  challenge: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomUrlSafeString(byteLength = 48): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomUrlSafeString(48);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export interface AuthorizeParams {
  portalUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  expirationMinutes: number;
}

export function buildAuthorizeUrl(params: AuthorizeParams): string {
  const url = new URL(`${params.portalUrl}/sharing/rest/oauth2/authorize`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  url.searchParams.set('expiration', String(params.expirationMinutes));
  url.searchParams.set('locale', 'uk');
  url.searchParams.set('f', 'json');
  return url.toString();
}

export interface TokenResponse {
  accessToken: string;
  expiresInSeconds: number;
  username: string;
}

interface RawTokenResponse {
  access_token?: string;
  expires_in?: number;
  username?: string;
  error?: string | { message?: string };
  error_description?: string;
  message?: string;
}

function describeOauthError(payload: RawTokenResponse): string {
  if (typeof payload.error === 'string') {
    return payload.error_description ?? payload.error;
  }
  return payload.error?.message ?? payload.message ?? 'Невідома помилка авторизації';
}

export interface ExchangeParams {
  portalUrl: string;
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
}

export async function exchangeCodeForToken(params: ExchangeParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code: params.code,
    code_verifier: params.verifier,
    f: 'json',
  });

  const response = await fetch(`${params.portalUrl}/sharing/rest/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Portal повернув HTTP ${response.status}`);
  }

  const payload = (await response.json()) as RawTokenResponse;
  if (!payload.access_token) {
    throw new Error(describeOauthError(payload));
  }

  return {
    accessToken: payload.access_token,
    expiresInSeconds: payload.expires_in ?? 3600,
    username: payload.username ?? '',
  };
}
