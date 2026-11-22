import type { ProfileRole } from "@/lib/auth/model";
import type { IconName } from "./icon";

export type WorkspaceLink = {
  href: string;
  label: string;
  icon: IconName;
  description: string;
};

const dashboard: WorkspaceLink = {
  href: "/dashboard",
  label: "Dashboard",
  icon: "home",
  description: "Open your workspace.",
};
const catalogue: WorkspaceLink = {
  href: "/catalogue",
  label: "Catalogue",
  icon: "catalogue",
  description: "Browse equipment and check availability.",
};
const lookup: WorkspaceLink = {
  href: "/equipment/lookup",
  label: "Find equipment",
  icon: "search",
  description: "Find an item by asset code, serial number, or equipment ID.",
};

const management: WorkspaceLink[] = [
  { href: "/manager/equipment", label: "Equipment", icon: "equipment", description: "Create equipment records and update your lab’s inventory." },
  { href: "/manager/kits", label: "Kits", icon: "kit", description: "Manage kits and their tracked components." },
  { href: "/manager/categories", label: "Categories", icon: "categories", description: "Organize your lab’s catalogue categories." },
  { href: "/manager/users", label: "Manage roles", icon: "users", description: "Review accounts and manage roles in your lab." },
];

export function workspaceLinks(role: ProfileRole): WorkspaceLink[] {
  const links = [dashboard, catalogue];
  if (role !== "student") {
    links.push(lookup, {
      href: "/scan",
      label: "Scan",
      icon: "scan",
      description: role === "lab_assistant"
        ? "Scan a QR label or enter an equipment ID to find a pickup or active loan."
        : "Identify equipment from its QR label.",
    });
  }
  if (role === "lab_manager") links.push(...management);
  return links;
}
