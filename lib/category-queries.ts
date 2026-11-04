export type EquipmentCategory = { //defines what a category looks like 
  id: number;
  name: string;
};

export type CategoryDatabase = {
  query: (
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: EquipmentCategory[] }>;
};

export async function getActiveCategories(db: CategoryDatabase) { //reads what are the categories stored in the equipment_categories table
  const sql = `
    SELECT id, name
    FROM public.equipment_categories
    WHERE is_active = true
    ORDER BY name ASC;
  `;

  const result = await db.query(sql);

  return result.rows; //returns the active categories 
}

export type CreateCategoryInput = { //Defines the information required to create a category.
  name: string;
  description?: string | null;
};

export function buildCreateCategoryQuery( 
  category: CreateCategoryInput
) {
  const text = `
    INSERT INTO public.equipment_categories
      (name, description, is_active)
    VALUES ($1, $2, true)
    RETURNING id, name;
  `;

  const values = [
    category.name.trim(),
    category.description?.trim() || null
  ];

  return { text, values };
}

export async function createCategory(
  db: CategoryDatabase,
  category: CreateCategoryInput
): Promise<EquipmentCategory | null> {

  const query = buildCreateCategoryQuery(category);

  const result = await db.query(
    query.text,
    query.values
  );

  return result.rows[0] ?? null;
}