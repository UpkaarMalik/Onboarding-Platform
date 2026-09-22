import { useEffect, useMemo, useRef, useState } from 'react';
import RingChart from '../charts/ring-chart';
import RingCenter from '../charts/ring-center';
import { Ring } from '../charts/ring';
import { departmentSlices, nextHidden, type DeptRow } from '../lib/departmentStats';
import { deptTint, type DeptSlots } from '../lib/deptColor';
import { useCountUp } from '../lib/useCountUp';

/**
 * Department headcount, drawn with the @bklit/ring-chart component from the
 * shadcn registry (src/charts, left as the registry wrote it).
 *
 * That chart is a set of concentric progress rings rather than a pie: one
 * ring per department, each filled to its share of the visible total. The
 * hand-rolled donut it replaces is gone, but everything around it is
 * unchanged — the same counts off the same rows, the same legend with its
 * names and numbers, the same click-to-toggle with the last department
 * refused, and the same hover readout.
 *
 * The counts come from the roster rows the page already fetched, so the
 * chart, the stat cards and the list below can never disagree.
 */
export default function DepartmentDonut({
  rows,
  slots,
}: {
  rows: DeptRow[];
  slots: DeptSlots;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const figureRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(0);

  /* RingChart's ring geometry is absolute pixels, so it cannot scale itself:
     at the registry defaults the rings needed a 240px chart and drew nothing
     at all in a narrower column. Measuring the box and deriving the radii
     from it is what makes the chart responsive — and lets it be generous on
     a laptop without overflowing a phone. */
  useEffect(() => {
    const el = figureRef.current;
    // `rows.length` is in the deps because the figure does not exist while
    // the list is empty: with [] deps this ran once against a null ref, the
    // early-return branch, and never re-attached when the rows arrived — so
    // the chart stayed on its fallback size forever.
    if (!el) return;
    const measure = () => setBox(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows.length]);

  /* The tint comes off the shared slot map, so a ring matches that
     department's avatar, badge and card. A department with no slot falls
     back to the muted ink rather than borrowing another's colour. */
  const slices = useMemo(
    () =>
      departmentSlices(rows).map((s) => ({
        ...s,
        tint: deptTint(slots, s.id) ?? 'var(--color-muted-soft)',
      })),
    [rows, slots],
  );

  const visible = slices.filter((s) => !hidden.has(s.id));
  const total = visible.reduce((n, s) => n + s.count, 0);
  const lastOne = visible.length === 1;

  /* One ring per visible department, each filled to its share of the total
     — which is the same reading the donut gave, as rings rather than
     wedges. */
  const data = useMemo(
    () =>
      visible.map((s) => ({
        label: s.name,
        value: s.count,
        maxValue: total || 1,
        color: s.tint,
      })),
    [visible, total],
  );

  /* `size` is passed to RingChart rather than letting it measure: left to
     itself it measured a different element than this does, drew rings for a
     240px canvas inside a 288px SVG, and the chart came out small and
     adrift in its box.

     The radii are shares of that size, deliberately sized so the outermost
     ring reaches the edge. RingChart scales them down itself if they would
     not fit (it keeps an 8px margin), so these are a target rather than a
     constraint — but it only ever shrinks, never grows, which is why they
     have to be generous to begin with. */
  const size = Math.max(170, Math.min(box || 240, 300));
  const ringCount = Math.max(1, visible.length);
  const strokeWidth = Math.round(size * 0.082);
  const ringGap = Math.max(3, Math.round(size * 0.02));
  // Whatever is left over after the rings is the hole in the middle, floored
  // so the count in the centre always has somewhere to sit.
  const baseInnerRadius = Math.max(
    Math.round(size * 0.17),
    Math.round(size / 2 - 8 - ringCount * strokeWidth - (ringCount - 1) * ringGap),
  );

  const hoveredSlice = hovered === null ? null : visible[hovered] ?? null;
  /* Above the early return, not below it: every hook has to run on every
     render. Called after the `slices.length === 0` bail-out, this one was
     skipped on the first render and then appeared once the rows arrived,
     which is React's "rendered more hooks than during the previous render"
     — it took the whole HR page down the moment the roster loaded. */
  const shownCount = useCountUp(hoveredSlice ? hoveredSlice.count : total);

  function toggle(id: string) {
    setHidden((prev) => nextHidden(prev, id, slices.length));
    setHovered(null);
  }

  if (slices.length === 0) {
    return <p className="muted">No departments to chart yet.</p>;
  }

  return (
    <div className="dept-donut">
      <div className="dept-donut-figure" ref={figureRef}>
        <RingChart
          className="dept-donut-ring"
          data={data}
          size={size}
          strokeWidth={strokeWidth}
          ringGap={ringGap}
          baseInnerRadius={baseInnerRadius}
          hoveredIndex={hovered}
          onHoverChange={setHovered}
        >
          {/* One <Ring> per department. The chart draws no arcs from `data`
              on its own — data supplies the geometry, these render it. */}
          {visible.map((s, i) => (
            <Ring key={s.id} color={s.tint} index={i} lineCap="round" />
          ))}

          {/* The hero number in the hole: the rings show the split, this
              shows what it is a split of. */}
          {/* The count is tweened by useCountUp rather than handed to the
              registry's NumberFlow, which mounted but never rolled here. */}
          <RingCenter defaultLabel={total === 1 ? 'joinee' : 'joinees'}>
            {() => (
              <span className="dept-donut-center">
                <strong className="dept-donut-value">{shownCount}</strong>
                <small className="dept-donut-label">
                  {hoveredSlice ? hoveredSlice.name : total === 1 ? 'joinee' : 'joinees'}
                </small>
              </span>
            )}
          </RingCenter>
        </RingChart>

        {/* The "hover a ring" instruction is gone; the share stays, since it
            is the one thing the centre does not show. The element is always
            rendered, empty at rest, so appearing on hover cannot shove the
            chart 24px up the panel. */}
        <p className="dept-donut-tip" role="status">
          {hoveredSlice
            ? `${hoveredSlice.name} — ${hoveredSlice.count} of ${total} (${Math.round(
                (hoveredSlice.count / total) * 100,
              )}%)`
            : ''}
        </p>
      </div>

      {/* Identity is never colour alone: every department is named and
          counted here, which also covers the amber ring's low contrast
          against the panel. */}
      <ul className="dept-donut-legend">
        {slices.map((s) => {
          const off = hidden.has(s.id);
          const index = visible.findIndex((v) => v.id === s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`dept-donut-key${off ? ' is-off' : ''}`}
                aria-pressed={!off}
                disabled={!off && lastOne}
                title={!off && lastOne ? 'At least one department has to stay on' : undefined}
                onClick={() => toggle(s.id)}
                onMouseEnter={() => !off && setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="dept-donut-swatch" style={{ background: s.tint }} aria-hidden="true" />
                <span className="dept-donut-name">{s.name}</span>
                <span className="dept-donut-count">{s.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
