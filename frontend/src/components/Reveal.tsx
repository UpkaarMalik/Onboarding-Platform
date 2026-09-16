import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

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

  useEffect(() => {
    if (alreadyShown) return;
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
  }, [alreadyShown, key]);

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
