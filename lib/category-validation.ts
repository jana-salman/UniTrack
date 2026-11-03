export function validateCreateCategoryInput(
  input: unknown //receives unknown because API requests can contain any kind of data
): string[] {
  const errors: string[] = [];

  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    return ["Category data must be an object."];
  }

  const category = input as Record<string, unknown>;

  // Validate category name
  if (
    typeof category.name !== "string" ||
    category.name.trim().length === 0
  ) {
    errors.push("Category name is required.");
  }

  // Validate description
  if (
    category.description !== undefined &&
    category.description !== null &&
    typeof category.description !== "string"
  ) {
    errors.push("Description must be a string.");
  }

  return errors;
}