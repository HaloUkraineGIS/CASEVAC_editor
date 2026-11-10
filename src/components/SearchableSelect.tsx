import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

/**
 * Випадаючий список зі швидким пошуком.
 *
 * Використовується для довгих довідників (ділянки розмінування, медичні
 * заклади), щоб не гортати сотні значень. За замовчуванням список
 * розгортається в потоці форми — так його не обрізає прокручувана панель
 * планувальника. Для панелей інструментів передавайте `popover`, щоб список
 * накладався поверх вмісту, а не зсував сусідні елементи.
 */
export interface SearchableOption {
  value: string;
  label: string;
  /** Додаткові дані для пошуку (наприклад, адреса закладу). */
  keywords?: string;
}

export interface SearchableSelectProps {
  value: string;
  options: SearchableOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  /** Підпис поля для скрінрідерів (візуальний підпис стоїть окремо). */
  ariaLabel: string;
  onChange: (value: string) => void;
  /** Накладати список поверх вмісту (для панелей інструментів). */
  popover?: boolean;
}

export function SearchableSelect({
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  ariaLabel,
  onChange,
  popover = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value);

  // Клік поза списком закриває його.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  // Одразу фокусуємо поле пошуку, щоб можна було друкувати без зайвих кліків.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const normalized = query.trim().toLocaleLowerCase('uk');
  const filtered = normalized
    ? options.filter((option) =>
        `${option.label} ${option.keywords ?? ''}`.toLocaleLowerCase('uk').includes(normalized),
      )
    : options;

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (next: string) => {
    onChange(next);
    close();
  };

  return (
    <div
      className={`search-select ${popover ? 'is-popover' : ''}`}
      ref={rootRef}
      onKeyDown={(event) => {
        // Escape закриває лише список, а не все вікно планувальника.
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        type="button"
        className={`search-select-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className={`search-select-value ${selected ? '' : 'is-placeholder'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={14} className="search-select-chevron" />
      </button>

      {open && (
        <div className="search-select-menu">
          <div className="search-select-search">
            <Search size={13} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && filtered.length > 0) {
                  event.preventDefault();
                  choose(filtered[0].value);
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="search-select-clear"
                onClick={() => setQuery('')}
                aria-label="Очистити пошук"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {filtered.length > 0 ? (
            <ul className="search-select-list" role="listbox">
              {filtered.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={`search-select-option ${option.value === value ? 'is-selected' : ''}`}
                    onClick={() => choose(option.value)}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="search-select-empty">{emptyLabel}</p>
          )}
        </div>
      )}
    </div>
  );
}
