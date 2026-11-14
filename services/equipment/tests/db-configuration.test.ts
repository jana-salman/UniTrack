import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getDatabasePool } from "../lib/db";
import { EquipmentConfigurationError, equipmentFailure } from "../lib/service-errors";
afterEach(() => vi.unstubAllEnvs());
it.each(["", "   "])("rejects missing database configuration before creating a connection", async value => {
 vi.stubEnv("DATABASE_URL", value);
 expect(() => getDatabasePool()).toThrow(EquipmentConfigurationError);
 const response = equipmentFailure(new EquipmentConfigurationError("database"));
 expect(response?.status).toBe(503);
 expect(await response?.json()).toEqual({ error: "Equipment database is not configured.", code: "equipment_not_configured" });
});
