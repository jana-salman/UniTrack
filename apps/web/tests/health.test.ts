import { expect, it } from "vitest";
import { GET } from "@/app/health/route";
import { config } from "@/proxy";

it("exposes public process health without a Supabase dependency", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    service: "web",
    status: "ok",
    version: "0.1.0",
  });
  expect(config.matcher.join(" ")).toContain("health(?:/|$)");
});
