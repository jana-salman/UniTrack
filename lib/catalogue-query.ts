import { pool } from "./db";
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
// TODO (Sprint 2): the loans table does not exist yet, so expectedReturn is
// always null. Join loans here when JS creates it.
export async function getCatalogue(
  search = "",
  category = ""
): Promise<CatalogueItem[]> {
  const { rows } = await pool.query(
    `SELECT i.id,
            i.asset_code AS "assetCode",
            i.name,
            c.name AS category,
            i.status,
            NULL::date AS "expectedReturn"
       FROM equipment_items i
       JOIN equipment_categories c ON c.id = i.category_id
      WHERE i.status <> 'retired'
        AND ($1 = '' OR i.name ILIKE '%' || $1 || '%'
                     OR i.asset_code ILIKE '%' || $1 || '%')
        AND ($2 = '' OR c.name = $2)
      ORDER BY i.name`,
    [search, category]
  );
  return rows.map((r) => ({ ...r, status: getEquipmentStatusLabel(r.status) }));
}