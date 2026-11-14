import { withInternalAuth } from "../../lib/auth";
// Test fixture only; not inside app/ and never exposed as a production endpoint.
export function fixture(secret: string) {
  return withInternalAuth((_request, identity) => Response.json({ kind: identity.kind, labId: identity.lab_id }), {
    secret, roles: ["lab_manager"],
  });
}

// Actual GET route-handler export for tests, never part of the app route tree.
export const GET = fixture("public-dummy-test-secret-not-for-deployment");
