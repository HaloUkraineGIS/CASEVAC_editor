import { useEffect, useRef } from 'react';
import { AlertCircle, ArrowUpRight, Lock, ShieldCheck, X } from 'lucide-react';
import { appConfig } from '../config/appConfig';
import { useAuth } from '../auth/AuthContext';

/**
 * Модальне вікно входу через ArcGIS Enterprise Portal.
 *
 * Сама авторизація виконується на сторінці Portal у цій самій вкладці
 * (без спливаючих вікон), після чого Portal повертає користувача в застосунок.
 */
export function AuthModal() {
  const { mode, status, error, promptOpen, signIn, closePrompt } = useAuth();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const busy = status === 'signingIn';

  useEffect(() => {
    if (promptOpen) primaryRef.current?.focus();
  }, [promptOpen]);

  useEffect(() => {
    if (!promptOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePrompt();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [promptOpen, closePrompt]);

  if (mode !== 'portal' || !promptOpen) return null;

  return (
    <div
      className="modal-backdrop auth-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePrompt();
      }}
    >
      <section
        className="modal-card auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <div className="modal-header">
          <div>
            <span className="modal-kicker">CASEVAC PLANNER</span>
            <h2 id="auth-modal-title">Вхід через ArcGIS Portal</h2>
            <p>Корпоративний обліковий запис медичного відділу</p>
          </div>
          <button className="icon-button" onClick={closePrompt} aria-label="Закрити">
            <X size={19} />
          </button>
        </div>

        <div className="auth-body">
          <div className="auth-brand">
            <div className="auth-brand-mark">
              <ShieldCheck size={20} />
            </div>
            <div className="auth-brand-copy">
              <strong>gis.htgoims.org</strong>
              <span>ArcGIS Enterprise Portal</span>
            </div>
            <span className="auth-brand-badge">SSO</span>
          </div>

          {busy ? (
            <div className="auth-wait" role="status">
              <span className="auth-spinner" aria-hidden="true" />
              <div>
                <strong>Відкриваємо сторінку Portal…</strong>
                <span>Зачекайте, будь ласка.</span>
              </div>
            </div>
          ) : (
            <p className="auth-lead">
              Щоб увійти, відкриється сторінка ArcGIS Portal у цій самій вкладці. Після авторизації ви
              автоматично повернетеся до CASEVAC Planner.
            </p>
          )}

          {error && (
            <div className="auth-error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="auth-portal">
            <span>Портал</span>
            <code>{appConfig.portalUrl}</code>
          </div>

          <p className="auth-note">
            <Lock size={13} />
            <span>
              Пароль вводиться лише на сторінці Portal. Застосунок зберігає токен доступу в пам’яті вкладки до
              виходу або закриття браузера.
            </span>
          </p>
        </div>

        <div className="auth-modal-footer">
          <button type="button" className="button button-secondary" onClick={closePrompt}>
            Пізніше
          </button>
          <button
            ref={primaryRef}
            type="button"
            className="button button-primary"
            onClick={() => void signIn()}
            disabled={busy}
          >
            <ArrowUpRight size={15} />
            {busy ? 'Переходимо…' : 'Перейти до Portal'}
          </button>
        </div>
      </section>
    </div>
  );
}
