import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { prefersReducedMotion } from './index.js';

let lenis = null;

/** Scroll to the top on navigation (instantly: a route change should not glide). */
export function scrollToTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true });
  else window.scrollTo(0, 0);
}

/**
 * Lenis smooth scrolling on public pages only (never in the admin panel, where people scan tables
 * and expect native scrolling). Off with reduced motion. Touch scrolling stays native (Lenis default).
 * Loaded lazily, so pages that never use it do not pay for it.
 */
export default function SmoothScroll() {
  const { pathname } = useLocation();
  const wanted = !pathname.startsWith('/admin') && !prefersReducedMotion();

  useEffect(() => {
    if (!wanted) return undefined;
    let cancelled = false;
    let raf = 0;
    import('lenis').then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({ duration: 0.9, smoothWheel: true, anchors: true });
      const loop = (t) => { lenis?.raf(t); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }).catch(() => { /* native scrolling is fine */ });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      lenis?.destroy();
      lenis = null;
    };
  }, [wanted]);

  return null;
}
