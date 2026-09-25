import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const shownIds = new Set<string>();

export default function Reveal({
  children,
  delay = 0,
  className = '',
  id,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  id?: string;
}) {
  const autoId = useId();
  const key = id ?? autoId;
  const alreadyShown = shownIds.has(key);

  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(alreadyShown);

  // Runs before the browser paints: if the element is already in the viewport
  // (above the fold), mark it visible immediately so the first paint shows it
  // fully — no invisible frame, no 0.6s fade for content the user is looking at.
  useLayoutEffect(() => {
    if (alreadyShown || visible) return;
    const el = ref.current;
    if (!el) return;
    if (el.getBoundingClientRect().top < window.innerHeight) {
      setVisible(true);
      shownIds.add(key);
    }
  }, [alreadyShown, key, visible]);

  // Sections below the fold still get the scroll-in animation via the observer.
  useEffect(() => {
    if (alreadyShown || visible) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          shownIds.add(key);
          observer.unobserve(el);
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [alreadyShown, key, visible]);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'reveal-visible' : ''} ${className}`.trim()}
      style={alreadyShown ? undefined : { transitionDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}
