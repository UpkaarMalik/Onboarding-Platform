import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

/** The wire format everywhere in this app: what <input type="date"> holds,
 *  what the API takes, what Postgres stores. */
const ISO = 'yyyy-MM-dd';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Date field with a calendar popover, in place of `<input type="date">`.
 *
 * The native control was the problem this replaces: every browser draws
 * it differently, Chrome's picker cannot be told which days are out of
 * bounds beyond graying the whole thing, and the collapsed field reads
 * "dd/mm/yyyy" — a format nothing else in this app uses. This shows the
 * same "28 Sep 2026" the roster, the confirm step and the joinee's own
 * screens show.
 *
 * Structurally it is HeroUI's DatePicker: a trigger that reads as one
 * field, and a popover holding the month grid. None of HeroUI is
 * installed — it needs Tailwind and a provider this project does not
 * have, and its palette is not this one — so the parts are built from
 * the project's own tokens.
 *
 * `min` and `max` disable days rather than hide them. A joining date of
 * last Tuesday is not an option, but seeing it greyed out says "not
 * allowed" where an empty grid would say "broken".
 */
export default function DatePickerField({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select a date',
  invalid = false,
  onClose,
  id,
}: {
  /** yyyy-MM-dd, or '' for empty. */
  value: string;
  onChange: (next: string) => void;
  min?: Date;
  max?: Date;
  placeholder?: string;
  invalid?: boolean;
  /** Fired when the popover closes, so the caller can mark the field
   *  touched exactly as it would on an input's blur. */
  onClose?: () => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => {
    if (!value) return null;
    const d = parseISO(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [value]);

  const floor = min ? startOfDay(min) : undefined;
  const ceil = max ? startOfDay(max) : undefined;

  /** The day the arrow keys are sitting on. Starts at the selection, or
   *  at the first day that is actually allowed — landing the cursor on a
   *  disabled day would make the first arrow press look broken. */
  const [cursor, setCursor] = useState<Date>(
    () => selected ?? (floor && isAfter(floor, new Date()) ? floor : startOfDay(new Date())),
  );
  const [month, setMonth] = useState<Date>(() => startOfMonth(cursor));

  // Re-sync when the value is changed from outside (Back from step 3,
  // a reset after a successful create).
  useEffect(() => {
    if (selected) {
      setCursor(selected);
      setMonth(startOfMonth(selected));
    }
  }, [selected]);

  const isDisabled = useCallback(
    (d: Date) => (floor ? isBefore(d, floor) : false) || (ceil ? isAfter(d, ceil) : false),
    [floor, ceil],
  );

  const close = useCallback(
    (refocus: boolean) => {
      setOpen(false);
      onClose?.();
      if (refocus) triggerRef.current?.focus();
    },
    [onClose],
  );

  // Outside click, on mousedown for the same reason the roster search
  // uses mousedown: a click that starts outside and ends inside should
  // still count as leaving.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
      onClose?.();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onClose]);

  /* Fixed-positioned and portalled into <body>, not absolutely positioned
     inside the field. The form this sits in lives in .modal-body, which
     is its own scroll container — an absolute popover taller than the
     remaining space is clipped by it, and the calendar is ~300px tall in
     a body that is rarely that far from its bottom edge. */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      if (!t) return;
      const height = popRef.current?.offsetHeight ?? 330;
      const width = popRef.current?.offsetWidth ?? 300;
      const below = window.innerHeight - t.bottom;
      setPos({
        top: below < height + 12 && t.top > height + 12 ? t.top - height - 8 : t.bottom + 8,
        // Clamped so a field near the right edge does not push the
        // calendar off screen.
        left: Math.max(8, Math.min(t.left, window.innerWidth - width - 8)),
      });
    };
    place();
    window.addEventListener('resize', place);
    // Capture: the scroll happens on .modal-body, not on window, and a
    // non-capturing window listener never hears it.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Roving tabindex: one stop for the whole grid, arrows do the rest.
  const cursorRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cursorRef.current?.focus();
  }, [open, cursor]);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month)),
        end: endOfWeek(endOfMonth(month)),
      }),
    [month],
  );

  function moveTo(next: Date) {
    setCursor(next);
    if (!isSameMonth(next, month)) setMonth(startOfMonth(next));
  }

  function onGridKey(e: React.KeyboardEvent) {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addWeeks(cursor, -1),
      ArrowDown: () => addWeeks(cursor, 1),
      Home: () => startOfWeek(cursor),
      End: () => endOfWeek(cursor),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      moveTo(move());
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    }
  }

  function pick(d: Date) {
    if (isDisabled(d)) return;
    onChange(format(d, ISO));
    close(true);
  }

  const today = startOfDay(new Date());
  const todayBlocked = isDisabled(today);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        id={id}
        className={`datepicker__trigger${open ? ' is-open' : ''}${invalid ? ' is-invalid' : ''}`}
        onClick={() => (open ? close(false) : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={selected ? '' : 'datepicker__placeholder'}>
          {selected ? format(selected, 'dd MMM yyyy') : placeholder}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2.5" />
          <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            className="datepicker__pop"
            role="dialog"
            aria-label="Choose a date"
            style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
          >
            <div className="datepicker__head">
              <button
                type="button"
                className="datepicker__nav"
                onClick={() => setMonth(addMonths(month, -1))}
                aria-label="Previous month"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M7.5 2L4 6l3.5 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <span className="datepicker__month">{format(month, 'MMMM yyyy')}</span>
              <button
                type="button"
                className="datepicker__nav"
                onClick={() => setMonth(addMonths(month, 1))}
                aria-label="Next month"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4.5 2L8 6l-3.5 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>

            <div className="datepicker__weekdays" aria-hidden="true">
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>

            {/* One keydown handler on the grid rather than one per day:
                only the cursor day is ever focused, so the event always
                arrives here anyway. */}
            <div className="datepicker__grid" onKeyDown={onGridKey} role="grid">
              {days.map((d) => {
                const outside = !isSameMonth(d, month);
                const disabled = isDisabled(d);
                const isSel = selected ? isSameDay(d, selected) : false;
                const isCur = isSameDay(d, cursor);
                return (
                  <button
                    key={d.toISOString()}
                    ref={isCur ? cursorRef : undefined}
                    type="button"
                    tabIndex={isCur ? 0 : -1}
                    disabled={disabled}
                    aria-selected={isSel}
                    aria-label={format(d, 'd MMMM yyyy')}
                    className={
                      'datepicker__day' +
                      (outside ? ' is-outside' : '') +
                      (isSel ? ' is-selected' : '') +
                      (isSameDay(d, today) ? ' is-today' : '')
                    }
                    onClick={() => pick(d)}
                  >
                    {format(d, 'd')}
                  </button>
                );
              })}
            </div>

            <div className="datepicker__foot">
              <button
                type="button"
                className="datepicker__shortcut"
                disabled={todayBlocked}
                onClick={() => pick(today)}
              >
                Today
              </button>
              {/* The common case for a joining date, and two clicks
                  cheaper than paging the month forward. */}
              <button
                type="button"
                className="datepicker__shortcut"
                onClick={() => pick(addDays(today, 7))}
              >
                In a week
              </button>
              {value && (
                <button
                  type="button"
                  className="datepicker__shortcut datepicker__shortcut--muted"
                  onClick={() => {
                    onChange('');
                    close(true);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
