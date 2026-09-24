import { MacbookScroll } from '@/components/ui/macbook-scroll';
import { MAC_TIPS } from '../data/macTips';

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
 */
export default function MacTools() {
  return (
    <div className="mac-tools-page">
      <header className="mac-tools-head">
        <h1>Mac Tools</h1>
        <p className="muted">
          Shortcuts and gestures worth knowing in your first week on a Mac.
          Scroll to open the lid.
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

      {/* The same tips as plain cards, for narrow screens, print, and
          anyone who lands here with the laptop scrolled out of view. */}
      <section className="mac-tools-fallback" aria-label="All Mac tips">
        <div className="mac-tools-grid">
          {MAC_TIPS.map((tip) => (
            <article key={tip.title} className="mac-tool-card">
              <span className="mac-tool-icon" aria-hidden="true">
                {tip.icon}
              </span>
              <div>
                <strong>{tip.title}</strong>
                <p>{tip.content}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

/** What sits on the screen: a window, drawn at the lid's own scale.
 *  Everything here is sized for a 512x384 surface — the lid then scales
 *  it up by half again, so a 9px title reads at about 13px. */
function MacScreen() {
  return (
    <div
      className="flex h-full w-full flex-col bg-[#f4f4f7]"
      aria-hidden="true"
    >
      <div className="flex h-[32px] shrink-0 items-center gap-2 border-b border-[#d9d9e0] bg-[#e9e9ee] px-[10px]">
        <span className="flex gap-[5px]">
          <span className="h-2 w-2 rounded-full bg-[#ec6a5e]" />
          <span className="h-2 w-2 rounded-full bg-[#f4bf4f]" />
          <span className="h-2 w-2 rounded-full bg-[#61c554]" />
        </span>
        <span className="grow text-center text-[10px] tracking-[0.3px] text-[#5d5d68]">
          mac-tips
        </span>
        <span className="w-10" />
      </div>

      {/* An FAQ sheet: a question you can scan, an answer when you want
          it. Two columns rather than three so each card is wide enough to
          be a card, and every one carries its own surface and border at
          rest instead of only appearing on hover.

          Five fixed rows, and each card is centred and clips its own
          overflow: the answer growing pushes the question up by half its
          height inside the card it already occupies. Without the fixed
          rows the hovered row grew and nudged every row below it down,
          which is a lot of movement for reading one tip. */}
      <div className="grid min-h-0 grow grid-cols-2 grid-rows-5 gap-[10px] overflow-hidden px-[15px] py-[11px]">
        {MAC_TIPS.map((tip) => (
          <div
            key={tip.title}
            className="group flex min-h-0 cursor-default flex-col justify-center overflow-hidden rounded-[7px] border border-[#dcdce3] bg-white px-[16px] py-[10px] shadow-[0_1px_2px_rgba(16,16,24,0.05)] transition-colors duration-200 hover:border-[#bdbdc9] hover:bg-[#fbfbfd]"
          >
            <div className="flex items-center gap-[11px]">
              <span className="text-[21px] leading-none">{tip.icon}</span>
              <span className="text-[15.5px] font-semibold leading-[1.25] text-[#2a2a33] transition-colors duration-200 group-hover:text-[#101017]">
                {tip.title}
              </span>
            </div>
            <p className="m-0 max-h-0 overflow-hidden text-[11.5px] leading-[1.5] text-[#63636f] opacity-0 transition-all duration-200 group-hover:mt-[6px] group-hover:max-h-[70px] group-hover:opacity-100">
              {tip.content}
            </p>
          </div>
        ))}
      </div>

      <div className="flex h-6 shrink-0 items-center justify-between border-t border-[#d9d9e0] bg-[#e9e9ee] px-[10px] text-[8.5px] text-[#63636f]">
        <span>{MAC_TIPS.length} tips</span>
        <span>AndBoard &nbsp;·&nbsp; New to Mac</span>
      </div>
    </div>
  );
}
