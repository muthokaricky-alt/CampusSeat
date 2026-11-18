import { useEffect, useState } from 'react';

/**
 * Motion rules for the whole app:
 * - Every animation checks prefersReducedMotion() first. With reduced motion, things appear in their
 *   final state at once (no movement), so nothing is lost, only the movement.
 * - Heavy libraries are loaded on demand: GSAP (~30 kB gz) the first time something animates,
 *   Lenis only on public pages, three.js + Vanta only for the desktop hero.
 * - Only transform and opacity are animated (no layout properties), so motion stays on the compositor.
 * - Timing: 150-250 ms for feedback, 300-450 ms for entrances, ~600 ms for the booking confirmation.
 */
const query = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

export const prefersReducedMotion = () => !!query?.matches;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion());
  useEffect(() => {
    if (!query) return undefined;
    const on = () => setReduced(query.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, []);
  return reduced;
}

let gsapPromise;
/** Loads GSAP once. Resolves to null when motion is reduced, so callers simply skip animating. */
export function loadGsap() {
  if (prefersReducedMotion()) return Promise.resolve(null);
  gsapPromise ??= import('gsap').then((m) => m.gsap || m.default).catch(() => null);
  return gsapPromise;
}

/** Desktop with a precise pointer, motion allowed, and not on a data saver: where heavy visuals are welcome. */
export function canAffordHeavyVisuals() {
  if (typeof window === 'undefined' || prefersReducedMotion()) return false;
  if (navigator.connection?.saveData) return false;
  return window.matchMedia('(min-width: 768px) and (pointer: fine)').matches;
}
