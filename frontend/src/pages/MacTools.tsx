import { MacbookScroll } from '@/components/ui/macbook-scroll';
import { MAC_TIPS, MAC_TIP_CATEGORIES, type MacTipCategory } from '../data/macTips';

/**
 * The Mac tip sheet, shown on the screen of a laptop that opens as you
 * scroll past it.
 *
 * The laptop is Aceternity's `macbook-scroll`, installed from the
 * registry (`npx shadcn@latest add @aceternity/macbook-scroll`) and then
 * edited in two places: it takes `children` so the screen can hold real
 * text instead of a screenshot, and the base keeps its aluminium colour
 * in light mode rather than turning white. Both live in
 * `components/ui/macbook-scroll.tsx` — registry files are ours to edit.
 *
 * The screen is dressed as a window, following the attached mockup:
 * traffic lights, a title strip, then the tips. As you scroll the lid
 * rotates up from -28deg and the whole screen scales past the frame, so
 * the tips come forward out of the machine instead of sitting boxed
 * inside it.
 *
 * Below the machine the same tips are laid out again as real cards,
 * grouped by what they are for. That section is not a fallback any more —
 * it is where someone who came here to look something up will actually
 * read, since the laptop is a thing to watch rather than to study.
 */
export default function MacTools() {
  const withKeys = MAC_TIPS.filter((t) => t.keys).length;

  return (
    <div className="mac-tools-page">
      <header className="mac-tools-head">
        <span className="mac-tools-eyebrow">New to Mac</span>
        <h1>Mac Tools</h1>
        <p className="muted">
          The shortcuts and gestures worth knowing in your first week — {withKeys} of
          them are a keystroke you can learn in a second. Scroll to open the lid.
        </p>
      </header>

      <div className="mac-tools-scroll">
        <MacbookScroll
          className="min-h-[190vh]"
          title={
            <span className="mac-tools-lede">
              Everything you need to drive a Mac.
              <br />
              Scroll on.
            </span>
          }
        >
          <MacScreen />
        </MacbookScroll>
      </div>

      {/* The readable copy: same tips, grouped, at a size you can study. */}
      <section className="mac-tools-sheet" aria-label="All Mac tips">
        {MAC_TIP_CATEGORIES.map((category) => {
          const tips = MAC_TIPS.filter((t) => t.category === category);
          if (tips.length === 0) return null;
          return (
            <div key={category} className="mac-tools-group">
              <h2 className="mac-tools-group-head">
                <span>{category}</span>
                <span className="mac-tools-group-rule" aria-hidden="true" />
                <span className="mac-tools-group-count">{tips.length}</span>
              </h2>

              <div className="mac-tools-grid">
                {tips.map((tip) => (
                  <article key={tip.title} className="mac-tool-card">
                    <span className="mac-tool-icon" aria-hidden="true">
                      {tip.icon}
                    </span>
                    <div className="mac-tool-body">
                      <div className="mac-tool-top">
                        <strong>{tip.title}</strong>
                        {tip.keys && <KeyCaps keys={tip.keys} />}
                      </div>
                      <p>{tip.content}</p>
                      {tip.gesture && (
                        <p className="mac-tool-gesture">
                          <TrackpadIcon />
                          {tip.gesture}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** A shortcut as physical caps with a + between them. Rendered from the
 *  `keys` array rather than from a string so the separator is never part of
 *  the data — "⌘ + Space" and "⌘+Space" would otherwise both appear. */
function KeyCaps({ keys, small = false }: { keys: string[]; small?: boolean }) {
  return (
    <span className={`keycaps${small ? ' keycaps--sm' : ''}`}>
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="keycaps__slot">
          {i > 0 && (
            <span className="keycaps__plus" aria-hidden="true">
              +
            </span>
          )}
          <kbd className="keycap">{k}</kbd>
        </span>
      ))}
    </span>
  );
}

/** `className` rather than one fixed size: the same glyph sits in the sheet
 *  cards at 14px and inside the laptop screen at 11px, where the lid then
 *  scales it up with everything else around it. */
function TrackpadIcon({ className = 'mac-tool-gesture-icon' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M12 5v14" strokeDasharray="2 2.5" />
    </svg>
  );
}

/** The categories the laptop screen shows.
 *
 *  "Finding things" is deliberately not among them. Dropping a group gave
 *  the remaining three enough height to carry readable type — and nothing is
 *  lost, because the sheet below the machine still lists every category from
 *  MAC_TIP_CATEGORIES. This is what the screen shows, not what the page has. */
const SCREEN_CATEGORIES: MacTipCategory[] = MAC_TIP_CATEGORIES.filter(
  (c) => c !== 'Finding things',
);

/** What sits on the screen: a window, drawn on the lid's own surface.
 *
 *  Every size here is authored small on purpose. The surface is a fixed
 *  968x576 element and the scroll scales it to 1.85, so these numbers are
 *  roughly what you want divided by that. Read a value here as "half of how
 *  it will look". */
function MacScreen() {
  const shownTips = MAC_TIPS.filter((t) => SCREEN_CATEGORIES.includes(t.category)).length;

  return (
    <div className="mac-screen-surface flex h-full w-full flex-col" aria-hidden="true">
      <div className="flex h-[32px] shrink-0 items-center gap-2 border-b border-[rgba(120,120,140,0.28)] bg-[rgba(255,255,255,0.55)] px-[10px]">
        <span className="flex gap-[5px]">
          <span className="h-2 w-2 rounded-full bg-[#ec6a5e]" />
          <span className="h-2 w-2 rounded-full bg-[#f4bf4f]" />
          <span className="h-2 w-2 rounded-full bg-[#61c554]" />
        </span>
        <span className="grow text-center text-[11px] tracking-[0.3px] text-[#6d6d7c]">
          mac-tips
        </span>
        <span className="w-10" />
      </div>

      {/* The same shape as the sheet below the machine: the tips grouped
          under a category rule with a count, rather than the ten-cell table
          this used to be. A table asks you to read every cell to find the
          one you want; the groups let you skip three quarters of them.

          The resting card is icon + title + shortcut and nothing else — the
          shortcut is the single most useful thing on it, so it is never the
          part hidden behind a hover. The answer and its trackpad line are
          what hovering adds.

          The rearranging is flexbox doing its own job rather than anything
          scripted: every card grows to fill its row, and a hovered one takes
          width back off its neighbour. See the note on the row below, where
          the two percentages that make that safe are set.

          Two cards to a row everywhere, so every card is the same size. A
          group of three wraps its odd card onto a second row rather than
          squeezing three across — three narrow cards beside two wide ones
          made the screen look like two different sheets.

          Card height is a resting MINIMUM rather than a share of the screen,
          and that is a bug fix, not a preference. The rows used to stretch to
          fill the screen exactly, which left no spare height anywhere: an
          opened card needs about 124px of content and the row it sat in was
          77px, so it grew straight through the group below and the next row
          painted over its bottom edge — the gesture line was sliced in half.

          So the strip of screen left empty under the last group is not waste,
          it is the room an opened card grows into, and it is nearly gone
          while you are hovering one. 66px is the largest resting height that
          still fits the worst tip (two lines of answer plus a trackpad line)
          — measured, not guessed: at 70 the tallest card overflows by 5px and
          at 78 by 37. If you raise it, or grow the gaps, or set type any
          larger, re-check every card, because only the longest few overflow
          and the failure is invisible until you hover exactly those. */}
      <div className="flex min-h-0 grow flex-col gap-[10px] overflow-hidden px-[16px] py-[12px]">
        {SCREEN_CATEGORIES.map((category) => {
          const tips = MAC_TIPS.filter((t) => t.category === category);
          if (tips.length === 0) return null;
          return (
            <div key={category} className="flex shrink-0 flex-col">
              <div className="mb-[7px] flex shrink-0 items-center gap-[9px]">
                <span className="text-[12px] font-extrabold uppercase tracking-[0.11em] text-[#7c7c8c]">
                  {category}
                </span>
                <span className="h-px grow bg-[rgba(120,120,140,0.3)]" />
                <span className="rounded-full bg-[rgba(255,255,255,0.7)] px-[7px] py-[1px] text-[11px] font-bold text-[#5f5f70]">
                  {tips.length}
                </span>
              </div>

              {/* 42% at rest, 54% hovered — and those two numbers are load
                  bearing, because flexbox breaks lines on flex-BASIS, before
                  any shrinking. A pair has to still fit on one line while one
                  of them is hovered, or the other is pushed onto a new row
                  that the group has no height for and `overflow-hidden` eats
                  it: at 46/70 the card beside the hovered one vanished off
                  the screen. 54 + 42 + the gap stays inside the row, so the
                  neighbour shrinks in place instead. Keep the sum under 100%.

                  42 also has to be over a third, so three cards can never sit
                  on one line — that wrap is what gives a group of three its
                  second row. `grow` then settles the exact widths. */}
              {/* items-start, so an opened card is the only one that gets
                  taller. Stretching would raise its neighbour to the same
                  height around a single line of title. */}
              <div className="flex flex-wrap items-start gap-[10px]">
                {tips.map((tip) => (
                  <div
                    key={tip.title}
                    className="mac-screen-card group flex min-h-[66px] min-w-0 shrink grow basis-[42%] cursor-default flex-col justify-center rounded-[11px] px-[17px] py-[12px] hover:basis-[54%]"
                  >
                    <div className="flex items-center gap-[11px]">
                      <span className="shrink-0 text-[23px] leading-none">{tip.icon}</span>
                      <span className="min-w-0 grow truncate text-[18px] font-semibold leading-[1.25] text-[#26262f] transition-colors duration-200 group-hover:text-[#101017]">
                        {tip.title}
                      </span>
                      {tip.keys && (
                        <span className="shrink-0">
                          <KeyCaps keys={tip.keys} small />
                        </span>
                      )}
                    </div>
                    <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-300 ease-out group-hover:mt-[8px] group-hover:max-h-[96px] group-hover:opacity-100">
                      <p className="m-0 text-[13px] leading-[1.45] text-[#5e5e6d]">{tip.content}</p>
                      {tip.gesture && (
                        <p className="m-0 mt-[6px] flex items-center gap-[6px] text-[12.5px] font-semibold leading-[1.35] text-[#c2700f]">
                          <TrackpadIcon className="h-[13px] w-[13px] shrink-0" />
                          {tip.gesture}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Counts what is ON the screen, not what the page holds: this said
          "10 tips" over a screen showing eight the moment a category was
          dropped from SCREEN_CATEGORIES. */}
      <div className="flex h-[26px] shrink-0 items-center justify-between border-t border-[rgba(120,120,140,0.28)] bg-[rgba(255,255,255,0.5)] px-[12px] text-[10.5px] text-[#6d6d7c]">
        <span>{shownTips} tips</span>
        <span>AndBoard &nbsp;·&nbsp; New to Mac</span>
      </div>
    </div>
  );
}
