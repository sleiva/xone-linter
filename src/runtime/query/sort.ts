interface SortKey { field: string; dir: 1 | -1; }

function parseOrderBy(orderBy: string): SortKey[] {
  return orderBy.split(',').map(part => {
    const tokens = part.trim().split(/\s+/);
    const field = tokens[0].replace(/["`\[\]]/g, '');
    const dir = (tokens[1] ?? 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
    return { field, dir } as SortKey;
  }).filter(k => k.field);
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

export function sortRows<T extends Record<string, unknown>>(rows: T[], orderBy: string | undefined): T[] {
  if (!orderBy || !orderBy.trim()) return rows;
  const keys = parseOrderBy(orderBy);
  if (keys.length === 0) return rows;
  return [...rows].sort((ra, rb) => {
    for (const k of keys) {
      const c = compare(ra[k.field], rb[k.field]);
      if (c !== 0) return c * k.dir;
    }
    return 0;
  });
}

export function applyLimit<T>(rows: T[], limit: number | undefined): T[] {
  return limit != null && limit >= 0 ? rows.slice(0, limit) : rows;
}
