import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Wraps a section/card so it animates in the first time it scrolls
 * into view, instead of only on initial page load — the same
 * fadeInUp everything already uses on mount, just re-triggered by
 * scroll position. Unobserves itself once shown, so scrolling back up
 * and down again doesn't replay it.
 */
export default function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'reveal-visible' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}
