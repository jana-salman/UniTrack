import { getDatabasePool } from "./db";
export const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function getItemsByIds(ids: string[], labId: number) {
  if (!ids.length) return [];
  const result = await getDatabasePool().query(
    'SELECT id, asset_code, name, status, lab_id, condition, is_restricted FROM public.equipment_items WHERE id = ANY($1::uuid[]) AND lab_id = $2 ORDER BY id', [ids, labId]);
  return result.rows;
}
export async function getItem(id: string, labId: number) {
  return (await getItemsByIds([id], labId))[0] ?? null;
}
export async function getComponents(itemId: string, labId: number) {
  const result = await getDatabasePool().query(
    'SELECT c.id, c.component_name, c.quantity_required, c.tracked_item_id, c.is_required, c.is_active FROM public.kit_components c JOIN public.kits k ON k.item_id = c.kit_item_id AND k.lab_id = c.lab_id WHERE c.kit_item_id = $1 AND c.lab_id = $2 ORDER BY c.component_name, c.id', [itemId, labId]);
  return result.rows;
}
