import type { CatalogueItem } from "./catalogue-query";

// TEMPORARY sample data. Delete this file before S1-12 is marked Done.
// Used only when USE_MOCK=true is set in .env.local.
const MOCK_ITEMS: CatalogueItem[] = [
  { id: "CAM-001", name: "Camera Canon", category: "Cameras", status: "Available", expectedReturn: null },
  { id: "KIT-002", name: "Arduino Kit", category: "Kits", status: "Borrowed", expectedReturn: "2026-11-10" },
  { id: "SEN-003", name: "Temperature Sensor", category: "Sensors", status: "Under Repair", expectedReturn: null },
  { id: "MCU-004", name: "Raspberry Pi 4", category: "Microcontrollers", status: "Available", expectedReturn: null },
  { id: "FPG-005", name: "FPGA Board", category: "Microcontrollers", status: "Reserved", expectedReturn: null },
  { id: "SEN-006", name: "Humidity Sensor", category: "Sensors", status: "Inspection Required", expectedReturn: null },
  { id: "CAM-007", name: "GoPro Hero", category: "Cameras", status: "Borrowed", expectedReturn: "2026-11-06" },
  { id: "DRN-008", name: "Drone DJI Mini", category: "Drones", status: "Available", expectedReturn: null },
];

export function getMockCatalogue(search = "", category = ""): CatalogueItem[] {
  const s = search.toLowerCase();
  return MOCK_ITEMS.filter(
    (i) =>
      (s === "" || i.name.toLowerCase().includes(s)) &&
      (category === "" || i.category === category)
  );
}