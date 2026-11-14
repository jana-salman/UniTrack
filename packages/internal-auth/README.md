# @unitrack/internal-auth

Signs and verifies internal JWTs with jose. Only HS256 is accepted, issuer is unitrack-gateway, and exp must be exactly 60 seconds after iat. Verification requires sub, role, lab_id, rid, iat and exp and checks signature, issuer, expiry, token age and claim types before returning an InternalIdentity. No decoded claims are used as trusted identity. Service/user identities are distinguished using role, subject and lab_id; kind is returned by the verifier and is not trusted from a token.

## Usage

Build packages with npm run build:packages from the repository root. In a future server-side workspace, declare @unitrack/internal-auth and @unitrack/contracts dependencies before importing them. No gateway or service uses them yet.

```ts
import { getRequestId, signInternalToken, verifyInternalToken } from "@unitrack/internal-auth";

// configuredSecret is supplied explicitly by trusted server configuration.
// Its configuration variable name is INTERNAL_JWT_SECRET.
const rid = getRequestId(incomingRequestId);
const token = await signInternalToken({
  kind: "user", sub: profileId, role: "lab_assistant", lab_id: labId, rid,
}, configuredSecret);
const verifiedIdentity = await verifyInternalToken(token, configuredSecret);
```

For gateway-to-Users bootstrap calls, sign { kind: "service", sub: "gateway", role: "service", lab_id: null, rid }. Downstream authorization must explicitly restrict service operations and enforce user role/lab checks. A valid signature alone does not authorize every operation.

The library never reads process.env or environment files. Missing/empty/whitespace-only secrets are rejected without a fallback. Callers must handle missing/invalid authentication as appropriate (for example 401); helpers throw InternalAuthError with a fixed message and no token, secret or nested cause. Do not log tokens or authorization headers. Production INTERNAL_JWT_SECRET provisioning remains a later setup step; no credential or private environment file is created by this task. HS256 verifiers also possess signing capability, so future service deployment must treat every holder as trusted.

getRequestId preserves 1-128 character ASCII IDs starting with an alphanumeric character and containing only letters, digits, dot, underscore or hyphen. Missing/invalid IDs get a UUID v4. isRequestId validates without generating. Incoming IDs are untrusted tracing labels; never use them for permissions or idempotency.

## Checks

Root npm test builds both packages and runs all existing web tests plus focused internal-auth tests. Dummy test secrets are public fixtures and must never be used in deployment. Tests cover valid user/service tokens, malformed/missing/tampered/expired tokens, wrong signature/issuer/algorithm, missing or invalid claims, explicit secrets and request ID handling. No real credentials, network calls or database operations are needed.

Reference: https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md
