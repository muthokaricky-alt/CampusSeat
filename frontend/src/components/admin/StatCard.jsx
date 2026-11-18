/**
 * Dashboard figures. Adapted from the "Stat Card" component by aadixc0de on 21st.dev (from chatcn,
 * chatcn.dev): a value, a change that turns green or red by which direction is good news, and a
 * sparkline. Rebuilt on CampusSeat's own CSS tokens (no Tailwind, no injected <style> tag) and
 * React without TypeScript; colour is never the only signal (arrow + screen-reader word).
 */
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

const nf = new Intl.NumberFormat('en-GB');

/** Line + soft area, last point marked. Strokes keep their width when the box stretches. */
export function Sparkline({ values, className = '' }) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return <svg aria-hidden="true" className={`sparkline ${className}`} />;
  const min = Math.min(...pts);
  const span = Math.max(...pts) - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * 94 + 3, 29 - ((v - min) / span) * 26]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
  const [lx, ly] = xy.at(-1);
  return (
    <svg aria-hidden="true" viewBox="0 0 100 32" preserveAspectRatio="none" className={`sparkline ${className}`}>
      <path d={`${d}L${lx},32L${xy[0][0]},32Z`} className="spark-area" />
      <path d={d} className="spark-line" vectorEffect="non-scaling-stroke" />
      <path d={`M${lx},${ly}h0`} className="spark-dot-halo" vectorEffect="non-scaling-stroke" />
      <path d={`M${lx},${ly}h0`} className="spark-dot" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * label, value (number or text), unit, hint,
 * delta: { value: signed number, format: 'percent' | 'number', label: 'vs last week' },
 * goodDirection: 'up' | 'down' | 'neutral', trend: number[] (oldest first), loading.
 */
export function StatCard({ label, value, unit, hint, delta, goodDirection = 'up', trend, loading, icon: Icon }) {
  let tone = 'flat';
  let DeltaIcon = Minus;
  let word = 'No change';
  if (delta && delta.value !== 0) { // Infinity = something now, nothing before: an increase
    const up = delta.value > 0;
    DeltaIcon = up ? ArrowUpRight : ArrowDownRight;
    word = up ? 'Up' : 'Down';
    if (goodDirection !== 'neutral') tone = (goodDirection === 'up') === up ? 'good' : 'bad';
  }
  const deltaText = !delta ? '' : !Number.isFinite(delta.value) ? 'up from 0'
    : delta.format === 'percent'
      ? new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(delta.value)
      : new Intl.NumberFormat('en-GB', { signDisplay: 'exceptZero' }).format(delta.value);
  const shown = typeof value === 'number' ? nf.format(value) : value;
  return (
    <div className="stat-card" aria-busy={loading || undefined}>
      <div className="stat-label">{Icon && <Icon size={15} aria-hidden />}<span>{label}</span></div>
      <div className="stat-row">
        {loading
          ? <span className="skeleton" style={{ width: '5rem', height: '2rem' }} aria-hidden="true" />
          : <span className="stat-value">{shown ?? '-'}{unit && <span className="stat-unit">{' '}{unit}</span>}</span>}
        {!loading && trend?.length > 1 && (
          <>
            <Sparkline values={trend} />
            <span className="sr-only">{`Trend over ${trend.length} days, from ${trend[0]} to ${trend.at(-1)}.`}</span>
          </>
        )}
      </div>
      {delta && !loading && (
        <span className={`stat-delta ${tone}`}>
          <DeltaIcon size={14} aria-hidden />
          <span className="sr-only">{word}</span>
          <strong>{deltaText}</strong>
          {delta.label && <span className="muted">{delta.label}</span>}
        </span>
      )}
      {hint && !loading && <p className="stat-hint">{hint}</p>}
    </div>
  );
}

/** A row of figures divided by hairlines instead of separate cards. */
export const StatCardGroup = ({ children, label }) => <div className="stat-group" role="group" aria-label={label}>{children}</div>;

/** Change from `prev` to `cur` as a fraction (0.25 = +25%); Infinity when there was nothing before. */
export const change = (cur, prev) => (prev ? (cur - prev) / prev : cur ? Infinity : 0);
