import { AppError } from './errors.js';

/**
 * Pagination and sorting for list endpoints. Every list answers with the same shape:
 *   { <items>: [...], meta: { page, limit, total, pages, sort, dir } }
 * Query: ?page=1&limit=50&sort=<key>&dir=asc|desc
 * page/limit are forgiving (bad values fall back to the defaults, limit is capped); an unknown
 * sort key is an error so a typo does not silently give a different order.
 *
 * `sorts` maps public sort keys to trusted SQL expressions. `tiebreak` (a unique column) keeps
 * the order stable between pages. Values put into SQL are only whitelisted columns and integers.
 */
export function listParams(query, { sorts, defaultSort, defaultDir = 'asc', defaultLimit = 50, maxLimit = 100, tiebreak }) {
  const int = (v, d) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : d; };
  const page = int(query.page, 1);
  const limit = Math.min(int(query.limit, defaultLimit), maxLimit);
  const sort = query.sort === undefined || query.sort === '' ? defaultSort : String(query.sort);
  if (!Object.hasOwn(sorts, sort)) {
    throw new AppError(400, 'VALIDATION_ERROR', `Unknown sort "${sort.slice(0, 30)}". Use one of: ${Object.keys(sorts).join(', ')}.`, { field: 'sort' });
  }
  const d = String(query.dir || defaultDir).toLowerCase();
  const dir = d === 'desc' ? 'desc' : 'asc';
  const orderBy = `ORDER BY ${sorts[sort]} ${dir.toUpperCase()}${tiebreak ? `, ${tiebreak} ${dir.toUpperCase()}` : ''}`;
  return {
    page, limit, sort, dir, orderBy,
    limitSql: `LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    meta: (total) => ({ page, limit, total: Number(total), pages: Math.max(1, Math.ceil(Number(total) / limit)), sort, dir }),
  };
}
