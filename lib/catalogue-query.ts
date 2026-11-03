import { getDatabasePool } from "./db";
import { getEquipmentStatusLabel } from "./equipment-status";

export type CatalogueItem = {
  id: string; // database UUID
  assetCode: string; // the code staff see and QR labels use, e.g. CAM-001
  name: string;
  category: string;
  status: string; // label: Available, Reserved, Borrowed, Inspection Required, Under Repair
  expectedReturn: string | null;
};

// Tables from JS's Supabase database:
//   equipment_items(id, asset_code, name, description, serial_number,
//                   category_id, status, created_by, created_at, updated_at)
//   equipment_categories(id, name, description, is_active, created_at)
// Retired items have status = 'retired'. We never select created_by or any
// user column, so no student name can leak.
//   loans(item_id, due_date, returned_at, ...)  -> active loan = returned_at IS NULL
// Only items of the signed-in user's lab are returned (lab_id, NF-11).
// The loans join only reads due_date. borrower_id is never selected.
export async function getCatalogue(
  search = "",
  category = "",
  labId: number
): Promise<CatalogueItem[]> {
  const { rows } = await getDatabasePool().query(
    `SELECT i.id,
            i.asset_code AS "assetCode",
            i.name,
            c.name AS category,
            i.status,
            l.due_date AS "expectedReturn"
       FROM equipment_items i
       JOIN equipment_categories c ON c.id = i.category_id
       LEFT JOIN loans l
              ON l.item_id = i.id AND l.returned_at IS NULL
      WHERE i.status <> 'retired'
        AND ($1 = '' OR i.name ILIKE '%' || $1 || '%'
                     OR i.asset_code ILIKE '%' || $1 || '%')
        AND ($2 = '' OR c.name = $2)
        AND i.lab_id = $3
      ORDER BY i.name`,
    [search, category, labId]
  );
  return rows.map((r) => ({ ...r, status: getEquipmentStatusLabel(r.status) }));
}