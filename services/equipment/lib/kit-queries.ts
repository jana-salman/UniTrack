import "server-only";
import type { PoolClient } from "pg";
import { getDatabasePool } from "./db";
import { buildCreateEquipmentQuery, type UpdateEquipmentInput } from "./equipment-queries";
import type { CreateEquipmentInput } from "./equipment-validation";

export interface KitComponentInput { tracked_item_id: string }

export async function listKits(labId: number) {
  const { rows } = await getDatabasePool().query(
    `select i.id, i.asset_code, i.name, i.description, i.category_id, i.lab_id,
            i.condition, i.is_restricted, i.status, i.created_at
       from public.kits k join public.equipment_items i on i.id = k.item_id
      where k.lab_id = $1 order by i.name, i.asset_code`, [labId]);
  return rows;
}

export async function getKit(kitId: string, labId: number) {
  const { rows } = await getDatabasePool().query(
    `select i.id, i.asset_code, i.name, i.description, i.serial_number,
            i.category_id, i.lab_id, i.condition, i.is_restricted, i.status,
            i.created_at, i.updated_at
       from public.kits k join public.equipment_items i on i.id = k.item_id
      where k.item_id = $1 and k.lab_id = $2`, [kitId, labId]);
  if (!rows[0]) return null;
  const components = await getDatabasePool().query(
    `select c.id, c.component_name, c.quantity_required, c.tracked_item_id,
            c.is_required, c.is_active, i.asset_code as tracked_asset_code,
            i.status as tracked_status, i.is_restricted as tracked_is_restricted
       from public.kit_components c
       left join public.equipment_items i on i.id = c.tracked_item_id and i.lab_id = c.lab_id
      where c.kit_item_id = $1 and c.lab_id = $2
      order by c.created_at, c.id`, [kitId, labId]);
  return { ...rows[0], components: components.rows };
}

async function validateTrackedComponents(client: PoolClient, ids: string[], labId: number) {
  if (!ids.length) return [];
  const { rows } = await client.query<{ id: string; name: string; status: string; is_restricted: boolean }>(
    `select i.id, i.name, i.status, i.is_restricted
       from public.equipment_items i
      where i.id = any($1::uuid[]) and i.lab_id = $2
        and not exists (select 1 from public.kits k where k.item_id = i.id)
      order by i.id for share`, [ids, labId]);
  if (rows.length !== ids.length) throw Object.assign(new Error("Every tracked component must be a different item in your laboratory."), { code: "KIT_COMPONENT_INVALID" });
  if (rows.some(row => row.status !== "available" || row.is_restricted)) throw Object.assign(new Error("Kit components must be available, unrestricted equipment."), { code: "KIT_COMPONENT_INELIGIBLE" });
  return rows;
}

async function insertComponents(client: PoolClient, kitId: string, labId: number, rows: { id: string; name: string }[]) {
  for (const row of rows) {
    await client.query(
      `insert into public.kit_components
       (kit_item_id, lab_id, component_name, quantity_required, tracked_item_id, is_required, is_active)
       values ($1, $2, $3, 1, $4, true, true)`,
      [kitId, labId, row.name, row.id]);
  }
}

export async function createKit(item: CreateEquipmentInput, createdBy: string, componentIds: string[]) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("BEGIN");
    const components = await validateTrackedComponents(client, componentIds, item.lab_id);
    const query = buildCreateEquipmentQuery(item, createdBy);
    const main = await client.query<{ id: string }>(query.text, query.values);
    const kitId = main.rows[0]?.id;
    if (!kitId) throw new Error("Kit main item was not created.");
    await client.query("insert into public.kits (item_id, lab_id) values ($1, $2)", [kitId, item.lab_id]);
    await insertComponents(client, kitId, item.lab_id, components);
    await client.query("COMMIT");
    return getKit(kitId, item.lab_id);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function updateKit(kitId: string, labId: number, input: UpdateEquipmentInput) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `update public.equipment_items i
          set name = $1, description = $2, serial_number = $3, category_id = $4,
              condition = $5, is_restricted = $6
        where i.id = $7 and i.lab_id = $8
          and exists (select 1 from public.kits k where k.item_id = i.id and k.lab_id = i.lab_id)
        returning i.id`,
      [input.name.trim(), input.description?.trim() || null, input.serial_number?.trim() || null,
        input.category_id, input.condition ?? "unknown", input.is_restricted ?? false, kitId, labId]);
    if (!updated.rows[0]) { await client.query("ROLLBACK"); return null; }
    await client.query("COMMIT");
    return getKit(kitId, labId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function addKitComponent(kitId: string, labId: number, componentId: string) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("BEGIN");
    const kit = await client.query("select item_id from public.kits where item_id = $1 and lab_id = $2 for update", [kitId, labId]);
    if (!kit.rows[0]) { await client.query("ROLLBACK"); return null; }
    const [component] = await validateTrackedComponents(client, [componentId], labId);
    const inserted = await client.query(
      `insert into public.kit_components
       (kit_item_id, lab_id, component_name, quantity_required, tracked_item_id, is_required, is_active)
       values ($1, $2, $3, 1, $4, true, true) returning id`,
      [kitId, labId, component.name, component.id]);
    await client.query("COMMIT");
    return inserted.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function removeKitComponent(kitId: string, labId: number, componentId: string) {
  const { rows } = await getDatabasePool().query(
    `update public.kit_components c set is_active = false
      where c.id = $1 and c.kit_item_id = $2 and c.lab_id = $3 and c.is_active
        and exists (select 1 from public.kits k where k.item_id = c.kit_item_id and k.lab_id = c.lab_id)
      returning c.id`, [componentId, kitId, labId]);
  return rows[0] ?? null;
}

export async function getReservationComponents(kitId: string, labId: number) {
  const { rows } = await getDatabasePool().query(
    `select i.id as tracked_item_id, i.status, i.is_restricted
       from public.kit_components c
       join public.kits k on k.item_id = c.kit_item_id and k.lab_id = c.lab_id
       join public.equipment_items i on i.id = c.tracked_item_id and i.lab_id = c.lab_id
      where c.kit_item_id = $1 and c.lab_id = $2 and c.is_active and c.tracked_item_id is not null
      order by i.id`, [kitId, labId]);
  return rows;
}
