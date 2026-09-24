/**
 * Supabase/PostgREST commonly caps a response at 1,000 rows. Financial shift
 * reports must not silently omit late orders or split-tender payment rows.
 * Callers must create a NEW, deterministically ordered query for every page.
 */
type QueryError = { message: string };
type PageResult<T> = { data: T[] | null; error: QueryError | null };
type PageLoader<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

export async function collectPagedShiftRows<T>(
  fetchPage: PageLoader<T>,
  pageSize = 500
): Promise<PageResult<T>> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("Invalid shift query page size.");
  }
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    all.push(...page);
    if (page.length < pageSize) return { data: all, error: null };
  }
}

/** Keep PostgREST `in.(uuid,...)` URL lengths bounded as a shift grows. */
export async function collectShiftRowsForIds<T>(
  ids: readonly string[],
  fetchPage: (batch: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
  idsPerBatch = 100
): Promise<PageResult<T>> {
  if (!Number.isSafeInteger(idsPerBatch) || idsPerBatch < 1 || idsPerBatch > 100) {
    throw new Error("Invalid shift query ID batch size.");
  }
  const all: T[] = [];
  for (let offset = 0; offset < ids.length; offset += idsPerBatch) {
    const batch = ids.slice(offset, offset + idsPerBatch);
    const result = await collectPagedShiftRows((from, to) => fetchPage(batch, from, to));
    if (result.error) return { data: null, error: result.error };
    all.push(...result.data ?? []);
  }
  return { data: all, error: null };
}
