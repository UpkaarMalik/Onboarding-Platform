"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MotionValue, motion, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { BrandMark, BrandWord } from "@/components/BrandLogo";
import {
  IconBrightnessDown,
  IconBrightnessUp,
  IconCaretRightFilled,
  IconCaretUpFilled,
  IconChevronUp,
  IconMicrophone,
  IconMoon,
  IconPlayerSkipForward,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
  IconTable,
  IconVolume,
  IconVolume2,
  IconVolume3,
} from "@tabler/icons-react";
import { IconSearch } from "@tabler/icons-react";
import { IconWorld } from "@tabler/icons-react";
import { IconCommand } from "@tabler/icons-react";
import { IconCaretLeftFilled } from "@tabler/icons-react";
import { IconCaretDownFilled } from "@tabler/icons-react";


/** The machine's own coordinate system. Both numbers come from the
 *  mockup: its lid is 326/512 of the width, so a 1000-wide machine is
 *  637 tall. The deck is shallower than the mockup's 352/512 because the
 *  hinge and the painted vent bar are gone — and because the machine's
 *  on-screen width is exactly (available height / (DESIGN_H/DESIGN_W)),
 *  every unit shaved here is width gained. */
const DESIGN_W = 1000;
const DESIGN_H = 1169; // lid 608 + deck 561

/** How far the lid leans before you scroll. Negative about a BOTTOM
 *  origin tips the top edge TOWARDS the camera — the lid leaning into
 *  the room, not reclining away from it. Hinging on the bottom edge is
 *  what keeps the lid and the deck exactly the same width where they
 *  meet, whichever way it leans. 20deg, not the 30 that read as a roof:
 *  the lean should be legible, not the subject. */
const REST_TILT = -20;

export const MacbookScroll = ({
  src,
  showGradient,
  title,
  badge,
  children,
  className,
}: {
  src?: string;
  showGradient?: boolean;
  title?: string | React.ReactNode;
  badge?: React.ReactNode;
  /** Rendered on the screen in place of `src`. The registry component
   *  only takes an image; ours puts real, selectable text up there so the
   *  tips are readable by a screen reader and not a picture of words. */
  children?: React.ReactNode;
  /** Overrides on the runway: its height sets how much scroll the whole
   *  sequence takes, and the padding sets the empty space around it. */
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // ["start start", "end end"] makes progress run exactly across the
  // stretch the composition below is pinned for, so the animation both
  // starts and finishes while the laptop is on screen. The registry's
  // ["start", "end start"] assumes the laptop scrolls past in flow.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  const [isMobile, setIsMobile] = useState(false);

  // The machine is drawn at DESIGN_W x DESIGN_H and then scaled to fit
  // whatever room the pinned box has. This replaces a hand-picked
  // `lg:scale-[…]` that was measured at 1440x900 and was wrong at every
  // other size — which is why the laptop looked different on a big
  // monitor. Fixing the proportions means the on-screen width is set by
  // the viewport's HEIGHT, so a taller screen genuinely gets a bigger
  // laptop instead of the same one with more space around it.
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    // offsetWidth/Height, not getBoundingClientRect: the rect reports the
    // element AFTER its own transform, so measuring it here would feed the
    // scale back into itself and converge on zero. offset* are layout
    // values and ignore transforms.
    const measure = () => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      if (!width || !height) return;
      setFit(Math.min(height / DESIGN_H, width / DESIGN_W));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (window && window.innerWidth < 768) {
      setIsMobile(true);
    }
  }, []);

  // Changed from the registry's +1500 travel. Theirs sends the screen
  // sliding 1500px down and off the bottom, which buries the keyboard
  // under it for the whole second half of the scroll. Lifting it 120px
  // instead leaves the keyboard visible below it once it is out.
  //
  // The screen grows past the lid it came out of. Width comes mostly
  // from the lid being 38rem rather than the registry's 32rem — scaling
  // X harder than Y would stretch the type — so this number is really
  // the height, and it is squeezed from both ends: too big and the
  // screen's bottom covers the keys, while pushing it down to compensate
  // tucks its top under the floating topnav, whose bottom is at 85px.
  // The start values are what the screen looks like before you scroll,
  // and they have to be the closed lid's own size or the machine starts
  // as a wedge — a display wider than the body it sits on. 1.0 across
  // matches the lid's 50rem; 0.4 down is the closed lid's 12rem against
  // this screen's 30rem. The registry's 1.2/0.6 were right for ITS
  // 32rem x 24rem lid and stopped being right when those changed.
  // 1.85 is the point of the effect: the screen grows past the lid it came
  // out of, so the tips arrive in front of the machine rather than staying
  // boxed inside it. It was briefly capped at 1 to keep the panel inside the
  // bezel, which did keep the laptop a laptop — and also made the whole
  // sequence a lid that opens onto a panel that never moves. Anything from
  // about 1.1 up overhangs the bezel on purpose; pair it with `translate`
  // below, which is what carries the grown screen clear of the frame.
  const MAX_SCREEN_SCALE = 1.85;
  /**
   * How far down the scroll the machine finishes opening.
   *
   * `useScroll` here is offset ["start start", "end end"], so progress 1 is
   * the LAST scrollable pixel of this section. This used to be 0.3, which
   * meant the whole reveal was over after a third of the scroll and the
   * remaining two thirds moved nothing at all — and once the tip cards below
   * the laptop were removed there was nothing down there to scroll to
   * either. Spread across 0.85, every turn of the wheel advances the
   * machine, and the finished picture IS the bottom of the page.
   *
   * Not 1.0 deliberately: the last 15% is left flat so the finished view
   * holds still for a moment at the end instead of existing only on the
   * final pixel, where a nudge either way would start closing it again.
   *
   * Every transform below shares it, so the scale, the travel and the lid's
   * rotation land together — a resting picture means all three arriving at
   * once, not the screen still drifting after the lid has stopped.
   */
  const OPEN_BY = 0.85;
  const scaleX = useTransform(
    scrollYProgress,
    [0, OPEN_BY],
    [1, isMobile ? 1 : MAX_SCREEN_SCALE],
  );
  const scaleY = useTransform(
    scrollYProgress,
    [0, OPEN_BY],
    [1, isMobile ? 1 : MAX_SCREEN_SCALE],
  );
  // The travel that carries the grown screen clear of the lid. It only makes
  // sense alongside a MAX_SCREEN_SCALE above 1: at 1 the screen has nowhere
  // to go and the travel just slides it down inside the frame, leaving an
  // empty strip of lid above it and its bottom edge on the keys.
  const translate = useTransform(scrollYProgress, [0, OPEN_BY], [0, 110]);
  // At rest the lid is reclined; it stands up as you scroll. The camera
  // is deliberately far away (6000px, not the registry's 800) — a near
  // camera projects the reclined lid's bottom edge much narrower than
  // its top, so the machine met the deck as a trapezoid. Far away, the
  // tilt reads as foreshortening (height x cos0) with the width left
  // alone, so the lid still meets the deck edge to edge.
  const rotate = useTransform(scrollYProgress, [0, OPEN_BY], [REST_TILT, 0]);
  // The heading above the machine keeps its own short range rather than
  // OPEN_BY: it says "scroll on", so it should be gone early, not linger
  // most of the way down the page repeating an instruction being followed.
  const textTransform = useTransform(scrollYProgress, [0, 0.3], [0, 100]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);

  return (
    <div ref={ref} className={cn("relative min-h-[200vh]", className)}>
      {/* Pinned: the laptop holds still, centred under the topnav, while
          the scroll runs the animation. */}
      {/* The lg step is ours: at scale-100 the machine is 512px wide on a
          1440px page, which leaves the screen's type small. There is room
          in the pinned box for half again as much. The nudge down goes
          with it: scaling the pinned box about its centre pushes the
          screen's title bar up under the topnav. */}
      <div
        ref={stageRef}
        className="sticky top-[88px] relative flex h-[calc(100vh-88px)] shrink-0 transform flex-col items-center justify-center [perspective:800px]"
        style={{ transform: `scale(${fit})` }}
      >
      <motion.h2
        style={{
          translateY: textTransform,
          opacity: textOpacity,
        }}
        className="absolute inset-x-0 top-0 text-center text-2xl font-bold text-neutral-800 dark:text-white"
      >
        {title || (
          <span>
            This Macbook is built with Tailwindcss. <br /> No kidding.
          </span>
        )}
      </motion.h2>
      {/* Lid */}
      <Lid
        src={src}
        scaleX={scaleX}
        scaleY={scaleY}
        rotate={rotate}
        translate={translate}
      >
        {children}
      </Lid>
      {/* Base area. Its height is the keyboard's: vent + keys + trackpad.
          shrink-0 because it is a flex item in a column that can
          overflow, and it clips — so a squash here silently eats the
          trackpad instead of showing anything. */}
      <div className="relative -z-10 h-[561px] w-[62.5rem] shrink-0 overflow-hidden rounded-2xl bg-gradient-to-b from-[#4e4e56] via-[#3d3d45] to-[#2b2b31]">
        {/* The gap between the hinge and the keys. The mockup paints a
            black bar across it; no MacBook has one, and it read as a
            drawn line. Bare deck, and shallower — the keyboard wants
            the height more. */}
        <div className="h-[18px] w-full" />
        {/* The keypad is a fixed width, not a percentage of the base.
            Every key in it is a fixed number of pixels wide, so on a
            wider machine a percentage leaves the rows ending short and a
            band of bare metal on the right. A real MacBook does the same
            thing — the 14" and the 16" have the same keyboard and the
            bigger one just has longer speaker grilles. */}
        <div className="relative flex">
          <div className="flex-1 self-stretch overflow-hidden">
            <SpeakerGrid />
          </div>
          {/* Scaled as a block rather than by editing every key: each
              row is a run of fixed pixel widths (esc 40, shift 58, space
              132 …) and they only line up with each other at one size.
              The wrapper is sized to the scaled result so layout still
              knows how tall the keyboard is. */}
          <div className="h-[335px] w-[50rem] shrink-0">
            <div className="w-[25.5rem] origin-top-left scale-[1.96]">
              <Keypad />
            </div>
          </div>
          <div className="flex-1 self-stretch overflow-hidden">
            <SpeakerGrid />
          </div>
        </div>
        <Trackpad />
        <div className="absolute inset-x-0 bottom-0 mx-auto h-2 w-20 rounded-tl-3xl rounded-tr-3xl bg-gradient-to-t from-[#3a3a42] to-[#141418]" />
        {showGradient && (
          <div className="absolute inset-x-0 bottom-0 z-50 h-40 w-full bg-gradient-to-t from-white via-white to-transparent dark:from-black dark:via-black"></div>
        )}
        {badge && <div className="absolute bottom-4 left-4">{badge}</div>}
        </div>
      </div>
    </div>
  );
};

export const Lid = ({
  scaleX,
  scaleY,
  rotate,
  translate,
  src,
  children,
}: {
  scaleX: MotionValue<number>;
  scaleY: MotionValue<number>;
  rotate: MotionValue<number>;
  translate: MotionValue<number>;
  src?: string;
  children?: React.ReactNode;
}) => {
  return (
    <div className="[perspective:3000px]">
      {/* Both lids recline together, about their shared bottom edge. The
          rotation lives out here rather than on either lid because the
          screen also scales, and the scale wants a different origin (the
          top) — one element cannot have two. */}
      <motion.div
        className="relative"
        style={{
          rotateX: rotate,
          transformOrigin: "bottom",
          transformStyle: "preserve-3d",
        }}
      >
      <div
        style={{
          transformStyle: "preserve-3d",
        }}
        className="relative h-[38rem] w-[62.5rem] rounded-2xl bg-gradient-to-b from-[#5c5c64] via-[#46464e] to-[#33333a] p-4 [box-shadow:0px_2px_0px_2px_rgba(255,255,255,0.14)_inset,0px_0px_0px_1px_rgba(0,0,0,0.55)]"
      >
        <div className="absolute inset-4 flex items-center justify-center rounded-[20px] bg-[#f4f4f7] [box-shadow:0_0_0_1px_rgba(0,0,0,0.25)]">
          <span className="flex items-center gap-1.5">
            <BrandMark className="h-[18px] w-[18px] shrink-0 overflow-visible" />
            <BrandWord
              className="text-[13px] font-bold tracking-tight text-[#1d1d1f]"
              brandClassName="text-[#ef9b3c]"
            />
          </span>
        </div>
      </div>
      <motion.div
        style={{
          scaleX: scaleX,
          scaleY: scaleY,
          // No rotateX here: the group above reclines both lids together.
          // Rotating again on this one stacked a second 30deg on top of
          // the first and folded the screen away from its own frame.
          translateY: translate,
          transformStyle: "preserve-3d",
          transformOrigin: "top",
        }}
        className="absolute inset-0 h-[38rem] w-[62.5rem] rounded-2xl bg-gradient-to-b from-[#5c5c64] via-[#46464e] to-[#33333a] p-4 [box-shadow:0px_2px_0px_2px_rgba(255,255,255,0.14)_inset,0px_0px_0px_1px_rgba(0,0,0,0.55)]"
      >
        {/* inset-2, not inset-0. An absolutely positioned child resolves
            `inset` against the padding box, so the registry's inset-0
            screen covers the p-2 the lid sets aside for its bezel — the
            display ran edge to edge and the machine had no frame. */}
        <div className="absolute inset-4 overflow-hidden rounded-[20px] bg-[#f4f4f7] [box-shadow:0_0_0_1px_rgba(0,0,0,0.25)]">
          {children ??
            (src ? (
              <img
                src={src}
                alt=""
                className="h-full w-full object-cover object-left-top"
              />
            ) : null)}
        </div>
        {/* Notch. Shallower than the mockup's 18px: it hangs over the top
            of the display, and at 18 it sat right on the window title —
            which was invisible while the title bar was dark and obvious
            the moment the screen went light. */}
        <div className="absolute inset-x-0 top-4 mx-auto h-[9px] w-[170px] rounded-b-lg bg-[#3c3c44]" />
      </motion.div>
      </motion.div>
    </div>
  );
};

export const Trackpad = () => {
  return (
    // The registry's single 1px inset line is invisible against the
    // deck at this size — the trackpad read as bare metal. A full inset
    // ring plus a soft top shadow gives it an edge without turning it
    // into a drawn rectangle.
    <div
      className="mx-auto my-[10px] h-[188px] w-[40%] rounded-[23px] bg-gradient-to-b from-[#43434b] to-[#383840]"
      style={{
        boxShadow:
          "0 0 0 1.5px rgba(0,0,0,0.6) inset, 0 1px 0 0 rgba(255,255,255,0.09) inset, 0 5px 11px -4px rgba(0,0,0,0.55) inset",
      }}
    ></div>
  );
};

export const Keypad = () => {
  return (
    <div className="mx-1 h-full [transform:translateZ(0)] rounded-md bg-[#1b1b20] p-1 [will-change:transform]">
      {/* First Row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn
          className="w-10 items-end justify-start pb-[2px] pl-[4px]"
          childrenClassName="items-start"
        >
          esc
        </KBtn>
        <KBtn>
          <IconBrightnessDown className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F1</span>
        </KBtn>
        <KBtn>
          <IconBrightnessUp className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F2</span>
        </KBtn>
        <KBtn>
          <IconTable className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F3</span>
        </KBtn>
        <KBtn>
          <IconSearch className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F4</span>
        </KBtn>
        <KBtn>
          <IconMicrophone className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F5</span>
        </KBtn>
        <KBtn>
          <IconMoon className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F6</span>
        </KBtn>
        <KBtn>
          <IconPlayerTrackPrev className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F7</span>
        </KBtn>
        <KBtn>
          <IconPlayerSkipForward className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F8</span>
        </KBtn>
        <KBtn>
          <IconPlayerTrackNext className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F9</span>
        </KBtn>
        <KBtn>
          <IconVolume3 className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F10</span>
        </KBtn>
        <KBtn>
          <IconVolume2 className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F11</span>
        </KBtn>
        <KBtn>
          <IconVolume className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F12</span>
        </KBtn>
        <KBtn>
          <div className="h-4 w-4 rounded-full bg-gradient-to-b from-neutral-900 from-20% via-black via-50% to-neutral-900 to-95% p-px">
            <div className="h-full w-full rounded-full bg-black" />
          </div>
        </KBtn>
      </div>

      {/* Second row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn>
          <span className="block">~</span>
          <span className="mt-1 block">`</span>
        </KBtn>
        <KBtn>
          <span className="block">!</span>
          <span className="block">1</span>
        </KBtn>
        <KBtn>
          <span className="block">@</span>
          <span className="block">2</span>
        </KBtn>
        <KBtn>
          <span className="block">#</span>
          <span className="block">3</span>
        </KBtn>
        <KBtn>
          <span className="block">$</span>
          <span className="block">4</span>
        </KBtn>
        <KBtn>
          <span className="block">%</span>
          <span className="block">5</span>
        </KBtn>
        <KBtn>
          <span className="block">^</span>
          <span className="block">6</span>
        </KBtn>
        <KBtn>
          <span className="block">&</span>
          <span className="block">7</span>
        </KBtn>
        <KBtn>
          <span className="block">*</span>
          <span className="block">8</span>
        </KBtn>
        <KBtn>
          <span className="block">(</span>
          <span className="block">9</span>
        </KBtn>
        <KBtn>
          <span className="block">)</span>
          <span className="block">0</span>
        </KBtn>
        <KBtn>
          <span className="block">&mdash;</span>
          <span className="block">_</span>
        </KBtn>
        <KBtn>
          <span className="block">+</span>
          <span className="block"> = </span>
        </KBtn>
        <KBtn
          className="w-10 items-end justify-end pr-[4px] pb-[2px]"
          childrenClassName="items-end"
        >
          delete
        </KBtn>
      </div>

      {/* Third row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn
          className="w-10 items-end justify-start pb-[2px] pl-[4px]"
          childrenClassName="items-start"
        >
          tab
        </KBtn>
        <KBtn>
          <span className="block">Q</span>
        </KBtn>
        <KBtn>
          <span className="block">W</span>
        </KBtn>
        <KBtn>
          <span className="block">E</span>
        </KBtn>
        <KBtn>
          <span className="block">R</span>
        </KBtn>
        <KBtn>
          <span className="block">T</span>
        </KBtn>
        <KBtn>
          <span className="block">Y</span>
        </KBtn>
        <KBtn>
          <span className="block">U</span>
        </KBtn>
        <KBtn>
          <span className="block">I</span>
        </KBtn>
        <KBtn>
          <span className="block">O</span>
        </KBtn>
        <KBtn>
          <span className="block">P</span>
        </KBtn>
        <KBtn>
          <span className="block">{`{`}</span>
          <span className="block">{`[`}</span>
        </KBtn>
        <KBtn>
          <span className="block">{`}`}</span>
          <span className="block">{`]`}</span>
        </KBtn>
        <KBtn>
          <span className="block">{`|`}</span>
          <span className="block">{`\\`}</span>
        </KBtn>
      </div>

      {/* Fourth Row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn
          className="w-[2.8rem] items-end justify-start pb-[2px] pl-[4px]"
          childrenClassName="items-start"
        >
          caps lock
        </KBtn>
        <KBtn>
          <span className="block">A</span>
        </KBtn>
        <KBtn>
          <span className="block">S</span>
        </KBtn>
        <KBtn>
          <span className="block">D</span>
        </KBtn>
        <KBtn>
          <span className="block">F</span>
        </KBtn>
        <KBtn>
          <span className="block">G</span>
        </KBtn>
        <KBtn>
          <span className="block">H</span>
        </KBtn>
        <KBtn>
          <span className="block">J</span>
        </KBtn>
        <KBtn>
          <span className="block">K</span>
        </KBtn>
        <KBtn>
          <span className="block">L</span>
        </KBtn>
        <KBtn>
          <span className="block">{`:`}</span>
          <span className="block">{`;`}</span>
        </KBtn>
        <KBtn>
          <span className="block">{`"`}</span>
          <span className="block">{`'`}</span>
        </KBtn>
        <KBtn
          className="w-[2.85rem] items-end justify-end pr-[4px] pb-[2px]"
          childrenClassName="items-end"
        >
          return
        </KBtn>
      </div>

      {/* Fifth Row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn
          className="w-[3.65rem] items-end justify-start pb-[2px] pl-[4px]"
          childrenClassName="items-start"
        >
          shift
        </KBtn>
        <KBtn>
          <span className="block">Z</span>
        </KBtn>
        <KBtn>
          <span className="block">X</span>
        </KBtn>
        <KBtn>
          <span className="block">C</span>
        </KBtn>
        <KBtn>
          <span className="block">V</span>
        </KBtn>
        <KBtn>
          <span className="block">B</span>
        </KBtn>
        <KBtn>
          <span className="block">N</span>
        </KBtn>
        <KBtn>
          <span className="block">M</span>
        </KBtn>
        <KBtn>
          <span className="block">{`<`}</span>
          <span className="block">{`,`}</span>
        </KBtn>
        <KBtn>
          <span className="block">{`>`}</span>
          <span className="block">{`.`}</span>
        </KBtn>
        <KBtn>
          <span className="block">{`?`}</span>
          <span className="block">{`/`}</span>
        </KBtn>
        <KBtn
          className="w-[3.65rem] items-end justify-end pr-[4px] pb-[2px]"
          childrenClassName="items-end"
        >
          shift
        </KBtn>
      </div>

      {/* sixth Row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn className="" childrenClassName="h-full justify-between py-[4px]">
          <div className="flex w-full justify-end pr-1">
            <span className="block">fn</span>
          </div>
          <div className="flex w-full justify-start pl-1">
            <IconWorld className="h-[6px] w-[6px]" />
          </div>
        </KBtn>
        <KBtn className="" childrenClassName="h-full justify-between py-[4px]">
          <div className="flex w-full justify-end pr-1">
            <IconChevronUp className="h-[6px] w-[6px]" />
          </div>
          <div className="flex w-full justify-start pl-1">
            <span className="block">control</span>
          </div>
        </KBtn>
        <KBtn className="" childrenClassName="h-full justify-between py-[4px]">
          <div className="flex w-full justify-end pr-1">
            <OptionKey className="h-[6px] w-[6px]" />
          </div>
          <div className="flex w-full justify-start pl-1">
            <span className="block">option</span>
          </div>
        </KBtn>
        <KBtn
          className="w-8"
          childrenClassName="h-full justify-between py-[4px]"
        >
          <div className="flex w-full justify-end pr-1">
            <IconCommand className="h-[6px] w-[6px]" />
          </div>
          <div className="flex w-full justify-start pl-1">
            <span className="block">command</span>
          </div>
        </KBtn>
        <KBtn className="w-[8.2rem]"></KBtn>
        <KBtn
          className="w-8"
          childrenClassName="h-full justify-between py-[4px]"
        >
          <div className="flex w-full justify-start pl-1">
            <IconCommand className="h-[6px] w-[6px]" />
          </div>
          <div className="flex w-full justify-start pl-1">
            <span className="block">command</span>
          </div>
        </KBtn>
        <KBtn className="" childrenClassName="h-full justify-between py-[4px]">
          <div className="flex w-full justify-start pl-1">
            <OptionKey className="h-[6px] w-[6px]" />
          </div>
          <div className="flex w-full justify-start pl-1">
            <span className="block">option</span>
          </div>
        </KBtn>
        <div className="mt-[2px] flex h-6 w-[4.9rem] flex-col items-center justify-end rounded-[4px] p-[0.5px]">
          <KBtn className="h-3 w-6">
            <IconCaretUpFilled className="h-[6px] w-[6px]" />
          </KBtn>
          <div className="flex">
            <KBtn className="h-3 w-6">
              <IconCaretLeftFilled className="h-[6px] w-[6px]" />
            </KBtn>
            <KBtn className="h-3 w-6">
              <IconCaretDownFilled className="h-[6px] w-[6px]" />
            </KBtn>
            <KBtn className="h-3 w-6">
              <IconCaretRightFilled className="h-[6px] w-[6px]" />
            </KBtn>
          </div>
        </div>
      </div>
    </div>
  );
};

export const KBtn = ({
  className,
  children,
  childrenClassName,
  backlit = true,
}: {
  className?: string;
  children?: React.ReactNode;
  childrenClassName?: string;
  backlit?: boolean;
}) => {
  return (
    <div
      className={cn(
        "[transform:translateZ(0)] rounded-[4px] p-[0.5px] [will-change:transform]",
        // The backlight is two shadows, not one, so it survives a change
        // of chassis colour: a white bloom that shows against a dark
        // deck, and a dark drop that shows against a light one. On any
        // colour at least one of them is doing the work.
        //
        // Turned down from 12px/3px at 0.65 alpha: at that strength the
        // bloom from neighbouring keys overlapped in the gaps and the
        // keyboard read as a lit slab with dark shapes on it rather than
        // as keys. Halving the spread keeps each key's own glow inside
        // its own outline.
        backlit &&
          "bg-white/20 shadow-[0_0_6px_1px_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.55)]",
      )}
    >
      <div
        className={cn(
          // #16151a rather than #0A090D: near-black keys on a near-black
          // deck meant the only thing separating one key from the next was
          // the backlight, which is the thing being turned down above. A
          // key that is a touch lighter than the deck has its own edge.
          "flex h-6 w-6 items-center justify-center rounded-[3.5px] bg-[#16151a]",
          className,
        )}
        style={{
          boxShadow:
            "0px -0.5px 2px 0 #0D0D0F inset, -0.5px 0 2px 0 #0D0D0F inset",
        }}
      >
        <div
          className={cn(
            // Legends were 5px at 0.2px tracking, which the deck's 1.96x
            // scale renders at about 10px — small enough that the smaller
            // glyphs filled in. Slightly larger, slightly bolder and more
            // open, which is what the keys needed more than more light.
            "flex w-full flex-col items-center justify-center text-[5.5px] font-medium leading-[1.2] tracking-[0.3px] text-white/90",
            childrenClassName,
            backlit && "text-white",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export const SpeakerGrid = () => {
  return (
    <div
      className="mt-1 flex h-[calc(100%-0.25rem)] gap-[2px] px-[0.5px]"
      style={{
        backgroundImage:
          "radial-gradient(circle, #16161a 1.3px, transparent 1.3px)",
        backgroundSize: "6px 6px",
      }}
    ></div>
  );
};

export const OptionKey = ({ className }: { className: string }) => {
  return (
    <svg
      fill="none"
      version="1.1"
      id="icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      className={className}
    >
      <rect
        stroke="currentColor"
        strokeWidth={2}
        x="18"
        y="5"
        width="10"
        height="2"
      />
      <polygon
        stroke="currentColor"
        strokeWidth={2}
        points="10.6,5 4,5 4,7 9.4,7 18.4,27 28,27 28,25 19.6,25"
      />
      <rect
        id="_Transparent_Rectangle_"
        className="st0"
        width="32"
        height="32"
        stroke="none"
      />
    </svg>
  );
};

