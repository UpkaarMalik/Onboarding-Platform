import { useEffect, useRef, useState } from 'react';

/** The app's dropdown: styled trigger, menu that flips up near the bottom
 *  of the window, optional search box. */
export function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  style,
  searchable = false,
  searchPlaceholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  style?: React.CSSProperties;
  /** A filter box at the top of the menu, for lists long enough to scan. */
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function handleToggle() {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropUp(spaceBelow < 240);
    }
    setQuery('');
    setOpen(!open);
  }

  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div className={`custom-select${open ? ' is-open' : ''}${dropUp ? ' drop-up' : ''}`} ref={ref} style={style}>
      <button type="button" className="custom-select__trigger" onClick={handleToggle}>
        <span className={selected ? '' : 'custom-select__placeholder'}>
          {selected ? selected.label : placeholder ?? 'Select…'}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
                  // Enter picks the only / first match, so typing a name is enough.
                  if (e.key === 'Enter' && shown[0]) {
                    e.preventDefault();
                    onChange(shown[0].value);
                    setOpen(false);
                  }
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
