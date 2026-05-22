# @internal/plugin-permission-backend-module-blitzy-policy

The Blitzy permission policy backend module for the Backstage `permission`
plugin. This module installs `BlitzyPermissionPolicy` into the permission
backend, replacing the upstream
`@backstage/plugin-permission-backend-module-allow-all-policy` registration.

## What it does

`BlitzyPermissionPolicy` enforces a deny-by-default posture for any
write action (`create`, `update`, `delete`) performed by a user whose
verified email domain is not `@blitzy.com`, or by a Backstage Guest user.
Read actions remain unconditionally allowed so that every signed-in user
(including Guests and non-Blitzy domains) can browse the catalog.

The implementation satisfies the verbatim user requirement that "any user
logging in with a domain other than `@blitzy.com` or as a Guest must be
strictly assigned read-only access."

## Decision matrix

| Permission action          | Principal                                                              | Decision |
| -------------------------- | ---------------------------------------------------------------------- | -------- |
| `read`                     | Any (Blitzy / non-Blitzy / Guest)                                      | `ALLOW`  |
| `create`/`update`/`delete` | User with email ending `@blitzy.com` (case-insensitive, strict suffix) | `ALLOW`  |
| `create`/`update`/`delete` | Guest principal (`user:default/guest`)                                 | `DENY`   |
| `create`/`update`/`delete` | User with non-Blitzy email                                             | `DENY`   |
| `create`/`update`/`delete` | User with no email available                                           | `DENY`   |

The policy has no in-memory state of its own; each decision is computed
from the request and the user identity. Email extraction is O(1) — a
single `jose.decodeJwt` call against the already-verified credentials
token (see _How the email is sourced_ below) — and there are no catalog
lookups, so steady-state throughput is dominated by O(1) string
comparisons.

## Registration

This module is registered by `packages/backend/src/index.ts` via:

```ts
backend.add(import('@internal/plugin-permission-backend-module-blitzy-policy'));
```

The registration replaces the previous
`backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy'))`
call. Only one permission policy may be installed at a time; mixing this
module with the allow-all module is not supported.

The permission framework must be enabled in `app-config.yaml`:

```yaml
permission:
  enabled: true
```

## How the email is sourced

The Backstage `PolicyQueryUser.info` type is `BackstageUserInfo`, which by
contract exposes only `userEntityRef` and `ownershipEntityRefs` — it does
**not** carry the user's email by default. The Blitzy implementation
propagates the email through a custom JWT claim rather than via a catalog
`User` entity lookup:

1. The augmented GitHub `signInResolver` in
   `packages/backend/src/authModuleGithubProvider.ts` runs the
   `selectPrimaryGithubEmail()` helper over the OAuth `fullProfile.emails`
   array, preferring the entry with `primary === true` before falling
   back to index 0. If no entry is available, the resolver falls back to
   `result.userinfo.email`, and finally to the sentinel
   `<userId>@unknown.invalid` (which guarantees a non-Blitzy domain so
   the policy fails closed for edge cases).
2. The resolver calls `ctx.issueToken({ claims: { sub, ent, email } })`
   to mint the Backstage identity token. The custom `email` claim rides
   on the JWT and is cryptographically signed by Backstage's default
   auth pipeline.
3. At permission-check time, `BlitzyPermissionPolicy.extractEmail(user)`
   first consults `user.info?.email` (forward-compatible — picks up any
   future deployment that wires a custom `UserInfoService` exposing
   email), and then decodes `user.credentials.token` via
   `jose.decodeJwt` (a non-verifying decode — the token is already
   cryptographically verified by `DefaultAuthService.authenticate`
   before the credentials object reaches this policy, so re-verifying
   here would be redundant work without any security improvement).

The policy never trusts a client-asserted email — it only reads claims
from the server-validated JWT. If the JWT carries no `email` claim
(rare GitHub edge case where the user has hidden their primary email
AND the resolver's fallback chain produced an `@unknown.invalid`
sentinel), the policy enforces read-only access — failing closed by
design. See `blitzy/documentation/Technical Specifications.md` IR-2 for
the as-implemented email propagation path and the rejected
catalog-lookup alternative.

## How Guests are detected

Guest sign-ins produced by the Backstage Guest sign-in page result in an
identity whose `info.userEntityRef` is the canonical literal
`user:default/guest`. The policy detects Guests by exact-string comparison on
that ref. As a defensive secondary check, the policy also inspects
`credentials.principal.type === 'guest'` for any provider that may surface a
guest principal type natively.

## Domain comparison rules

- The comparison is **case-insensitive**: `Someone@Blitzy.COM` is treated
  as a Blitzy domain.
- The comparison is a **strict suffix match on `@blitzy.com`**. The string
  must end with the literal `@blitzy.com` (including the at-sign). This means
  `someone@dev.blitzy.com` is **not** treated as Blitzy (subdomain spoofing
  guard) and `someone@notblitzy.com` is also not treated as Blitzy.

## Extending the allowlist

Allowing additional email domains is done by editing `src/policy.ts` and
broadening the `isBlitzyDomain(email)` helper. The change should be
documented in the project decision log at
[`docs/refactor/decision-log.md`](../../docs/refactor/decision-log.md).
Unit tests in `src/policy.test.ts` should cover each new allowlisted
domain.

## Observability (planned counter)

Each policy decision is **planned to** emit an OpenTelemetry counter
`blitzy_permission_decisions_total{result, email_domain, action}` where
`email_domain` is bucketed to `blitzy.com`, `other`, or `guest` (no
PII). The counter is currently **not yet emitted** by `src/policy.ts` —
no `@opentelemetry/api-metrics` import or `Counter.add(...)` call is
present in the source. The Grafana dashboard at
[`docs/observability/dashboard-template.json`](../../docs/observability/dashboard-template.json)
references the counter and the panel will populate automatically once
the instrumentation lands. See
[`docs/refactor/next-tasks.md`](../../docs/refactor/next-tasks.md)
entry 1 for the deferred follow-up tracker, and
[`blitzy/documentation/Technical Specifications.md`](../../blitzy/documentation/Technical%20Specifications.md)
IR-5 for the divergence record.

## Testing

This module ships unit tests at `src/policy.test.ts` covering every
branch of `BlitzyPermissionPolicy.handle()` (read action ALLOW,
Blitzy-domain ALLOW, non-Blitzy DENY, Guest principal DENY,
missing-email DENY, JWT-decode failure DENY). They are runnable with:

```bash
yarn workspace @internal/plugin-permission-backend-module-blitzy-policy test
```

The coverage target is **≥ 80%** per the project's authorization testing
mandate. Coverage is verified by running:

```bash
yarn workspace @internal/plugin-permission-backend-module-blitzy-policy test --coverage
```

The lint workflow is also runnable:

```bash
yarn workspace @internal/plugin-permission-backend-module-blitzy-policy lint
```

## See also

- [`docs/refactor/decision-log.md`](../../docs/refactor/decision-log.md)
  — rationale for choosing a separate plugin module over an inline
  policy in `packages/backend/src/`, the rejected alternatives for the
  email-source resolution path (including the catalog-lookup approach
  described in earlier drafts of this README), and the deferred custom
  Prometheus counter.
- [`docs/permissions/writing-a-policy.md`](../../docs/permissions/writing-a-policy.md)
  — Backstage upstream guide to authoring permission policies.
- [`packages/backend/src/authModuleGithubProvider.ts`](../../packages/backend/src/authModuleGithubProvider.ts)
  — the augmented GitHub `signInResolver` that emits the custom JWT
  `email` claim consumed by this policy.

_This plugin was created through the Backstage CLI._
