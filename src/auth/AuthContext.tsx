import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { appConfig, type AuthMode } from '../config/appConfig';
import { buildAuthorizeUrl, createPkcePair, exchangeCodeForToken, randomUrlSafeString } from './pkce';
import { fetchPortalUser, type PortalUser } from './portal';

const SESSION_KEY = 'casevac.portal.session';
const PKCE_KEY = 'casevac.portal.pkce';
/** Скільки часу даємо користувачу на вхід у Portal, перш ніж вважати спробу застарілою. */
const PENDING_TTL_MS = 10 * 60 * 1000;

export type AuthStatus = 'demo' | 'restoring' | 'signedOut' | 'signingIn' | 'signedIn' | 'error';

export interface AuthSession {
  token: string;
  expiresAt: number;
  user: PortalUser;
}

interface PendingAuth {
  verifier: string;
  state: string;
  createdAt: number;
}

interface AuthContextValue {
  mode: AuthMode;
  status: AuthStatus;
  session: AuthSession | null;
  user: PortalUser | null;
  error: string | null;
  /** Чи відкрите модальне вікно входу. */
  promptOpen: boolean;
  /** Почати вхід: перехід на сторінку Portal у поточній вкладці. */
  signIn: () => Promise<void>;
  openPrompt: () => void;
  closePrompt: () => void;
  signOut: () => void;
  dismissError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.token || !parsed.expiresAt || parsed.expiresAt - 30_000 <= Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function readPendingAuth(): PendingAuth | null {
  try {
    const raw = sessionStorage.getItem(PKCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAuth;
    if (!parsed.verifier || !parsed.state || Date.now() - parsed.createdAt > PENDING_TTL_MS) {
      sessionStorage.removeItem(PKCE_KEY);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(PKCE_KEY);
    return null;
  }
}

function clearCallbackQuery(): void {
  const url = new URL(window.location.href);
  ['code', 'state', 'error', 'error_description'].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function readOAuthError(): string | null {
  const params = new URL(window.location.href).searchParams;
  const value = params.get('error_description') ?? params.get('error');
  return value ? `Portal відхилив вхід: ${value}` : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const mode = appConfig.authMode;
  const [status, setStatus] = useState<AuthStatus>(mode === 'demo' ? 'demo' : 'restoring');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  const bootHandled = useRef(false);

  /** Обмінює код авторизації на токен і завантажує користувача Portal. */
  const completeSignIn = useCallback(async (code: string, state: string) => {
    const pending = readPendingAuth();
    if (!pending || !state || pending.state !== state) {
      setError('Не знайдено активну спробу входу. Спробуйте увійти ще раз.');
      setStatus('error');
      setPromptOpen(true);
      return;
    }

    setError(null);
    setStatus('signingIn');
    try {
      const token = await exchangeCodeForToken({
        portalUrl: appConfig.portalUrl,
        clientId: appConfig.oauth.clientId,
        redirectUri: appConfig.oauth.redirectUri,
        code,
        verifier: pending.verifier,
      });
      const user = await fetchPortalUser(appConfig.portalUrl, token.accessToken);
      const nextSession: AuthSession = {
        token: token.accessToken,
        expiresAt: Date.now() + token.expiresInSeconds * 1000,
        user,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setStatus('signedIn');
      setPromptOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Невідома помилка входу через Portal');
      setStatus('error');
      setPromptOpen(true);
    } finally {
      sessionStorage.removeItem(PKCE_KEY);
    }
  }, []);

  /**
   * Вхід як у NTS: сторінка Portal відкривається в цій самій вкладці,
   * після чого Portal повертає код на зареєстрований Redirect URI.
   */
  const signIn = useCallback(async () => {
    if (mode === 'demo') return;
    setError(null);
    setStatus('signingIn');

    try {
      const pkce = await createPkcePair();
      const state = randomUrlSafeString(24);
      const pending: PendingAuth = { verifier: pkce.verifier, state, createdAt: Date.now() };
      sessionStorage.setItem(PKCE_KEY, JSON.stringify(pending));
      const url = buildAuthorizeUrl({
        portalUrl: appConfig.portalUrl,
        clientId: appConfig.oauth.clientId,
        redirectUri: appConfig.oauth.redirectUri,
        state,
        challenge: pkce.challenge,
        expirationMinutes: appConfig.oauth.expirationMinutes,
      });
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося розпочати вхід через Portal');
      setStatus('error');
      setPromptOpen(true);
    }
  }, [mode]);

  const openPrompt = useCallback(() => {
    setPromptOpen(true);
    setError(null);
    setStatus((current) => (current === 'error' ? 'signedOut' : current));
  }, []);

  const closePrompt = useCallback(() => {
    setPromptOpen(false);
    setStatus((current) => (current === 'signingIn' ? 'signedOut' : current));
  }, []);

  /** Повернення з Portal у поточній вкладці + відновлення збереженої сесії. */
  useEffect(() => {
    if (mode !== 'portal' || bootHandled.current) return;
    bootHandled.current = true;

    const oauthError = readOAuthError();
    if (oauthError) {
      clearCallbackQuery();
      setError(oauthError);
      setStatus('error');
      setPromptOpen(true);
      return;
    }

    const params = new URL(window.location.href).searchParams;
    const code = params.get('code');
    if (code) {
      const state = params.get('state') ?? '';
      clearCallbackQuery();
      void completeSignIn(code, state);
      return;
    }

    const restored = readSession();
    if (restored) {
      setSession(restored);
      setStatus('signedIn');
      return;
    }

    setStatus('signedOut');
    // У режимі Portal застосунок без сесії нічого не показує, тож одразу пропонуємо вхід.
    setPromptOpen(true);
  }, [mode, completeSignIn]);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(PKCE_KEY);
    setSession(null);
    setError(null);
    setPromptOpen(false);
    setStatus(mode === 'demo' ? 'demo' : 'signedOut');
  }, [mode]);

  const dismissError = useCallback(() => {
    setError(null);
    setStatus((current) => (current === 'error' ? (mode === 'demo' ? 'demo' : 'signedOut') : current));
  }, [mode]);

  const value = useMemo<AuthContextValue>(
    () => ({
      mode,
      status,
      session,
      user: session?.user ?? null,
      error,
      promptOpen,
      signIn,
      openPrompt,
      closePrompt,
      signOut,
      dismissError,
    }),
    [mode, status, session, error, promptOpen, signIn, openPrompt, closePrompt, signOut, dismissError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
