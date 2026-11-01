import { pool } from "./db";

export type CatalogueItem = {
  id: string;
  name: string;
  category: string;
  status: string; // Available, Reserved, Borrowed, Inspection Required, Under Repair
  expectedReturn: string | null; // date, only when the item is borrowed
};

// ASSUMED table and column names. Ask JS for the real ones and rename below:
//   items(id, name, category_id, status, retired_at)
//   categories(id, name)
//   loans(item_id, due_date, returned_at)
// We never select a borrower column, so no student name can leak.
export async function getCatalogue(
  search = "",
  category = ""
): Promise<CatalogueItem[]> {
  const { rows } = await pool.query(
    `SELECT i.id,
            i.name,
            c.name AS category,
            i.status,
            l.due_date AS "expectedReturn"
       FROM items i
       JOIN categories c ON c.id = i.category_id
       LEFT JOIN loans l
              ON l.item_id = i.id AND l.returned_at IS NULL
      WHERE i.retired_at IS NULL
        AND ($1 = '' OR i.name ILIKE '%' || $1 || '%')
        AND ($2 = '' OR c.name = $2)
      ORDER BY i.name`,
    [search, category]
  );
  return rows;
}