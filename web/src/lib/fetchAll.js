// Supabase returns at most 1,000 rows per request; read a whole list in pages. The query needs an
// order that is unique per row, or the pages can repeat some rows and skip others.
export async function fetchAll(query, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}
