import { useEffect, useRef } from 'react';
import { canAffordHeavyVisuals } from '../motion/index.js';

/**
 * Animated network backdrop for the landing hero (Vanta NET on three.js).
 * - Only on desktop with a fine pointer, motion allowed and no data saver (canAffordHeavyVisuals):
 *   phones, reduced motion and the admin panel never load it. A static CSS gradient is always
 *   underneath, so the hero looks complete without it.
 * - three.js + Vanta (~150 kB gz) are fetched only after the hero is on screen and the browser is idle.
 * - Paused (destroyed) when scrolled out of view, rebuilt with the right colours when the theme changes.
 * - Works under the strict Content-Security-Policy: WebGL only, no eval, no inline scripts.
 */
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hex = (c) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  return m ? parseInt(m[1], 16) : 0x2447d6;
};

export default function HeroBackdrop() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !canAffordHeavyVisuals()) return undefined;
    let effect = null;
    let visible = false;
    let disposed = false;
    let libs = null;

    const build = async () => {
      if (disposed || effect || !visible) return;
      libs ??= await Promise.all([import('three'), import('vanta/dist/vanta.net.min.js')]).catch(() => null);
      if (!libs || disposed || effect || !visible) return;
      const [THREE, vanta] = libs;
      // UMD bundle: through Vite's CommonJS interop the effect function sits at default.default.
      const NET = [vanta?.default?.default, vanta?.default, vanta].find((f) => typeof f === 'function');
      if (!NET) return;
      effect = NET({
        el, THREE,
        mouseControls: true, touchControls: false, gyroControls: false,
        scale: 1, scaleMobile: 1,
        color: hex(css('--primary')),
        backgroundColor: hex(css('--hero-bg')),
        points: 9, maxDistance: 20, spacing: 18, showDots: true,
      });
      el.classList.add('is-live');
    };
    const destroy = () => { effect?.destroy(); effect = null; el.classList.remove('is-live'); };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) (window.requestIdleCallback || setTimeout)(build);
      else destroy();
    }, { threshold: 0.05 });
    io.observe(el);

    // Theme switch: rebuild with the new colours.
    const mo = new MutationObserver(() => { destroy(); build(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => { disposed = true; io.disconnect(); mo.disconnect(); destroy(); };
  }, []);

  return <div ref={ref} className="hero-backdrop" aria-hidden="true" />;
}
