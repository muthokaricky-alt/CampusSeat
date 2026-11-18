import { useId } from 'react';
import { categoryOf } from '../lib/categories.js';

/**
 * Generated cover art for an event: a category colour with a pattern that hints at the category
 * (stripes for careers, sound rings for talks, a grid for workshops, ...). Deterministic per event,
 * so a card always looks the same, but no two events are identical. Pure inline SVG: no image files,
 * no network, allowed by the strict CSP, and decorative (aria-hidden).
 */
function rng(seed) {
  let s = (Number(seed) * 2654435761) % 4294967296 || 1;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const PATTERNS = {
  career: (r, c) => Array.from({ length: 9 }, (_, i) => (
    <rect key={i} x={-60 + i * 48 + r() * 10} y={-40} width={10 + r() * 14} height={260} fill={c.light} opacity={0.12 + r() * 0.2} transform="rotate(-28 200 90)" />)),
  talk: (r, c) => {
    const cx = 260 + r() * 100; const cy = 40 + r() * 80;
    return Array.from({ length: 7 }, (_, i) => <circle key={i} cx={cx} cy={cy} r={22 + i * 26} fill="none" stroke={c.light} strokeWidth={3 + r() * 3} opacity={0.5 - i * 0.06} />);
  },
  workshop: (r, c) => {
    const out = [];
    for (let x = 0; x < 420; x += 34) out.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={180} stroke={c.light} strokeWidth={1} opacity={0.18} />);
    for (let y = 0; y < 180; y += 34) out.push(<line key={`h${y}`} x1={0} y1={y} x2={420} y2={y} stroke={c.light} strokeWidth={1} opacity={0.18} />);
    for (let i = 0; i < 6; i++) out.push(<rect key={`s${i}`} x={Math.floor(r() * 12) * 34} y={Math.floor(r() * 5) * 34} width={34} height={34} fill={c.light} opacity={0.18 + r() * 0.25} />);
    return out;
  },
  academic: (r, c) => Array.from({ length: 5 }, (_, i) => {
    const y = 30 + i * 32 + r() * 8;
    return <path key={i} d={`M0 ${y} Q 105 ${y - 30 - r() * 20} 210 ${y} T 420 ${y}`} fill="none" stroke={c.light} strokeWidth={2 + r() * 3} opacity={0.22 + r() * 0.2} />;
  }),
  social: (r, c) => Array.from({ length: 26 }, (_, i) => (
    <circle key={i} cx={r() * 420} cy={r() * 180} r={3 + r() * 11} fill={i % 3 ? c.light : '#ffffff'} opacity={0.18 + r() * 0.4} />)),
  sports: (r, c) => Array.from({ length: 4 }, (_, i) => (
    <path key={i} d={`M ${-40 + i * 30} 200 A ${180 - i * 25} ${150 - i * 20} 0 0 1 ${440 - i * 10} 200`} fill="none" stroke={c.light} strokeWidth={6 - i} opacity={0.18 + i * 0.07} />)),
  other: (r, c) => Array.from({ length: 4 }, (_, i) => (
    <circle key={i} cx={r() * 420} cy={r() * 180} r={40 + r() * 70} fill={c.light} opacity={0.12 + r() * 0.12} />)),
};

export default function CoverArt({ category, seed = 1, className = '' }) {
  const c = categoryOf(category);
  const id = useId().replace(/:/g, '');
  const r = rng(seed);
  const Icon = c.icon;
  return (
    <div className={`cover-art ${className}`} aria-hidden="true">
      <svg viewBox="0 0 420 180" preserveAspectRatio="xMidYMid slice" role="presentation">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c.deep} />
            <stop offset="1" stopColor={c.deep} stopOpacity="0.82" />
          </linearGradient>
        </defs>
        <rect width="420" height="180" fill={`url(#g${id})`} />
        {(PATTERNS[c.key] || PATTERNS.other)(r, c)}
      </svg>
      <Icon className="cover-icon" size={64} strokeWidth={1.25} />
    </div>
  );
}
