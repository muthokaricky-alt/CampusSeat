/**
 * Table helpers for the admin lists. The interaction pattern (sortable headers, "Showing 1-50 of 312",
 * numbered pages, page size) follows the "Data Table" component by ephraimduncan on 21st.dev, rebuilt
 * without TanStack Table or Radix: sorting and paging are done by the API (?sort=&dir=&page=&limit=),
 * so the browser only ever holds one page.
 */
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

/** A column header that sorts by `sortKey`. Click toggles direction; aria-sort tells screen readers. */
export function SortHeader({ label, sortKey, sort, dir, onSort, className, defaultDir = 'asc' }) {
  const active = sort === sortKey;
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  const next = active ? (dir === 'asc' ? 'desc' : 'asc') : defaultDir;
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={className}>
      <button type="button" className={`th-sort ${active ? 'on' : ''}`} onClick={() => onSort(sortKey, next)}>
        {label}<Icon size={14} aria-hidden />
        <span className="sr-only">{active ? `, sorted ${dir === 'asc' ? 'ascending' : 'descending'}` : ', sortable'}</span>
      </button>
    </th>
  );
}

/** Pages to show as buttons: first, last, current and its neighbours, with gaps as "…". */
function pageList(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => { if (i && p - sorted[i - 1] > 1) out.push('gap' + p); out.push(p); });
  return out;
}

/** "Showing 1 to 50 of 312" + page size + numbered pages. `meta` is the API's list meta. */
export function TableFooter({ meta, onPage, onLimit, sizes = [25, 50, 100], noun = 'entries' }) {
  if (!meta) return null;
  const { page, limit, total, pages } = meta;
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(page * limit, total);
  return (
    <div className="table-footer">
      <p className="small muted" aria-live="polite">Showing {from}{'–'}{to} of {total} {noun}</p>
      <div className="row">
        {onLimit && (
          <label className="small muted page-size">Rows
            <select value={limit} onChange={(e) => onLimit(Number(e.target.value))}>{sizes.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </label>
        )}
        {pages > 1 && (
          <nav className="pages" aria-label="Pages">
            <button type="button" className="btn secondary sm icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} aria-hidden /></button>
            {pageList(page, pages).map((p) => (typeof p === 'string'
              ? <span key={p} className="muted small" aria-hidden>{'…'}</span>
              : <button key={p} type="button" className={`btn sm icon-sm ${p === page ? '' : 'secondary'}`} aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p}`} onClick={() => onPage(p)}>{p}</button>))}
            <button type="button" className="btn secondary sm icon-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} aria-hidden /></button>
          </nav>
        )}
      </div>
    </div>
  );
}

/** Rows of grey bars with the table's own column count, shown while a page loads. */
export const TableSkeleton = ({ cols = 5, rows = 6 }) => (
  <tbody aria-hidden="true">
    {Array.from({ length: rows }, (_, r) => (
      <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}><span className="skeleton" style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%`, height: '0.9rem' }} /></td>)}</tr>
    ))}
  </tbody>
);

/** A small hook-free helper: list state kept in the URL so views can be bookmarked and shared. */
export function listState(params, defaults) {
  const get = (k) => params.get(k) ?? defaults[k] ?? '';
  return {
    page: Number(get('page')) || 1,
    limit: Number(get('limit')) || defaults.limit || 50,
    sort: get('sort'),
    dir: get('dir') || 'desc',
    get,
  };
}
