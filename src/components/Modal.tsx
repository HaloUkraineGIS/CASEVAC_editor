import { useEffect, type FormEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

interface ModalProps {
  kicker?: string;
  title: string;
  subtitle: string;
  submitLabel?: string;
  submitDisabled?: boolean;
  /** Інформаційне вікно: без кнопки збереження, лише «Закрити». */
  info?: boolean;
  /** Широка картка для багатопольових форм і таблиць. */
  wide?: boolean;
  /** Власні кнопки у нижній частині (замість стандартних). */
  footer?: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
}

export function Modal({
  kicker = 'CASEVAC PLANNER',
  title,
  subtitle,
  submitLabel = 'Зберегти',
  submitDisabled = false,
  info = false,
  wide = false,
  footer,
  onClose,
  onSubmit,
  children,
}: ModalProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submitDisabled) onSubmit?.();
  };

  // Escape закриває вікно — звична поведінка для модальних форм.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal-card ${wide ? 'modal-card-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <div>
            <span className="modal-kicker">{kicker}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрити">
            <X size={19} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-form-content">{children}</div>
          <div className="modal-footer">
            {footer ? (
              footer
            ) : info ? (
              <button type="button" className="button button-secondary" onClick={onClose}>
                Закрити
              </button>
            ) : (
              <>
                <button type="button" className="button button-secondary" onClick={onClose}>
                  Скасувати
                </button>
                <button type="submit" className="button button-primary" disabled={submitDisabled}>
                  <Plus size={16} />
                  {submitLabel}
                </button>
              </>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
