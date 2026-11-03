import { requirePageProfile } from "@/lib/auth/authorization";
import CategoryManagementClient from "@/components/category-management-client";

export default async function ManageCategoriesPage() {
  await requirePageProfile(["lab_manager"]);

  return <CategoryManagementClient />;
}