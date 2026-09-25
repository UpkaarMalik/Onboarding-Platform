import { useEffect, useRef, useState } from 'react';

const X_ICON = (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);
const CHEVRON = (
  <svg className="custom-select__chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  style,
  searchable = false,
  searchPlaceholder = 'Search…',
  multi = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  style?: React.CSSProperties;
  searchable?: boolean;
  searchPlaceholder?: string;
  multi?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedValues = multi ? value.split(',').filter(Boolean) : [];
  const singleSelected = multi ? null : (value ? options.find((o) => o.value === value) ?? null : null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function openMenu() {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setDropUp(window.innerHeight - rect.bottom < 240);
    }
    setQuery('');
    setOpen(true);
  }

  function toggleMulti(optValue: string) {
    const next = selectedValues.includes(optValue)
      ? selectedValues.filter((v) => v !== optValue)
      : [...selectedValues, optValue];
    onChange(next.join(','));
  }

  function removeChip(e: React.MouseEvent, optValue: string) {
    e.stopPropagation();
    const next = selectedValues.filter((v) => v !== optValue);
    onChange(next.join(','));
  }

  function clearAll(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
  }

  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  /* ── Multi trigger ── */
  if (multi) {
    const chips = options.filter((o) => selectedValues.includes(o.value));
    return (
      <div
        className={`custom-select custom-select--multi${open ? ' is-open' : ''}${dropUp ? ' drop-up' : ''}`}
        ref={ref}
        style={style}
      >
        {/* Clicking the wrapper opens; individual chip × buttons stop propagation */}
        <div
          className="custom-select__multi-trigger"
          role="button"
          tabIndex={0}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={openMenu}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(); } }}
        >
          <span className="custom-select__multi-body">
            {chips.length === 0 && (
              <span className="custom-select__placeholder">{placeholder ?? 'Select…'}</span>
            )}
            {chips.map((opt) => (
              <span key={opt.value} className="custom-select__tag">
                <span className="custom-select__tag-text">{opt.label}</span>
                <button
                  type="button"
                  className="custom-select__tag-remove"
                  onClick={(e) => removeChip(e, opt.value)}
                  aria-label={`Remove ${opt.label}`}
                >
                  {X_ICON}
                </button>
              </span>
            ))}
          </span>
          <span className="custom-select__multi-actions">
            {chips.length > 0 && (
              <button
                type="button"
                className="custom-select__clear"
                onClick={clearAll}
                aria-label="Clear all"
              >
                {X_ICON}
              </button>
            )}
            {CHEVRON}
          </span>
        </div>

        {open && (
          <ul className="custom-select__menu" role="listbox">
            {searchable && (
              <li className="custom-select__search">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                />
              </li>
            )}
            {shown.length === 0 && <li className="custom-select__none">No matches</li>}
            {shown.map((opt) => {
              const active = selectedValues.includes(opt.value);
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={active}
                  className={`custom-select__option${active ? ' is-active' : ''}`}
                  onClick={() => toggleMulti(opt.value)}
                >
                  <span className="custom-select__checkbox" aria-hidden="true">
                    {active ? '✓' : ''}
                  </span>
                  {opt.label}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  /* ── Single trigger (unchanged) ── */
  return (
    <div className={`custom-select${open ? ' is-open' : ''}${dropUp ? ' drop-up' : ''}`} ref={ref} style={style}>
      <button
        type="button"
        className="custom-select__trigger"
        onClick={() => { setQuery(''); setOpen((o) => !o); if (!open && ref.current) { const rect = ref.current.getBoundingClientRect(); setDropUp(window.innerHeight - rect.bottom < 240); } }}
      >
        <span className={singleSelected ? '' : 'custom-select__placeholder'}>
          {singleSelected ? singleSelected.label : placeholder ?? 'Select…'}
        </span>
        {CHEVRON}
      </button>
      {open && (
        <ul className="custom-select__menu">
          {searchable && (
            <li className="custom-select__search">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onChange(shown[0].value); setOpen(false); }
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </li>
          )}
          {shown.length === 0 && <li className="custom-select__none">No matches</li>}
          {shown.map((opt) => (
            <li
              key={opt.value}
              className={`custom-select__option${opt.value === value ? ' is-active' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
              {opt.value === value && <span className="custom-select__check">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
