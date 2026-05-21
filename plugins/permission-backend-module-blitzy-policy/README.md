# @internal/plugin-permission-backend-module-blitzy-policy

The Blitzy permission policy backend module for the Backstage `permission`
plugin. This module will install `BlitzyPermissionPolicy` into the permission
backend, replacing the upstream
`@backstage/plugin-permission-backend-module-allow-all-policy` registration.

> **Status — Checkpoint 1 (foundation):** This package currently contains
> only its workspace scaffolding and a minimal `src/index.ts` entry-point
> placeholder. The policy implementation (`src/policy.ts`), backend module
> wiring (`src/module.ts`), and unit tests (`src/policy.test.ts`) are
> forthcoming in a subsequent implementation checkpoint per Agent Action
> Plan §0.6.1.4. The descriptive sections below document the planned
> behavior so that downstream agents have a stable design contract.

## What it will do

`BlitzyPermissionPolicy` will enforce a deny-by-default posture for any
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
from the request and the user identity. It performs a single, cacheable
catalog lookup per unknown `userEntityRef` to read `spec.profile.email`
from the corresponding `User` entity (see _How the email is sourced_
below) — the catalog client's existing entity cache absorbs repeat reads,
so steady-state throughput is dominated by O(1) string comparisons.

## Registration (planned)

Once delivered, this module will be registered by
`packages/backend/src/index.ts` via:

```ts
backend.add(import('@internal/plugin-permission-backend-module-blitzy-policy'));
```

Registration will replace the previous
`backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy'))`
call. Only one permission policy may be installed at a time; mixing this
module with the allow-all module is not supported.

The permission framework must be enabled in `app-config.yaml` (this is
already true at Checkpoint 1):

```yaml
permission:
  enabled: true
```

## How the email is sourced

The Backstage `PolicyQueryUser.info` type is `BackstageUserInfo`, which by
contract exposes only `userEntityRef` and `ownershipEntityRefs` — it does
**not** carry the user's email. The policy therefore reads the email via the
canonical upstream pattern:

1. The augmented GitHub `signInResolver` in
   `packages/backend/src/authModuleGithubProvider.ts` extracts the email
   from `result.fullProfile.emails[0].value` (primary) or
   `result.userinfo.email` during sign-in.
2. The resolver persists that email onto the corresponding `User` catalog
   entity at `spec.profile.email` (the same convention used by the
   upstream AWS ALB auth provider; see
   `plugins/auth-backend-module-aws-alb-provider/src/resolvers.ts`).
3. At permission-check time, `BlitzyPermissionPolicy` resolves
   `user.info.userEntityRef` against the catalog via the injected
   `catalogService` and reads `spec.profile.email` from the returned
   `User` entity.

The policy never trusts a client-asserted email — it only reads what the
server-side catalog returned. If the catalog lookup fails or the User
entity has no `spec.profile.email` (rare GitHub edge case where the user
has hidden their primary email and the sign-in resolver never persisted
one), the policy treats the user as non-Blitzy and enforces read-only
access — failing closed by design.

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

## Extending the allowlist (once the policy lands)

Once the policy implementation is delivered, allowing additional email
domains will be done by editing `src/policy.ts` (forthcoming — Checkpoint
2/5 deliverable) and broadening the `isBlitzyDomain(email)` helper. The
change should be documented in the project decision log at
`docs/refactor/decision-log.md` (forthcoming — Checkpoint 4 documentation
deliverable per AAP §0.6.1.7). Unit tests in `src/policy.test.ts`
(forthcoming) should cover each new allowlisted domain.

## Observability (planned)

Once the policy implementation lands, each policy decision will emit an
OpenTelemetry counter
`blitzy_permission_decisions_total{result, email_domain, action}` where
`email_domain` is bucketed to `blitzy.com`, `other`, or `guest` (no PII).
The counter will be consumed by the Grafana dashboard at
`docs/observability/dashboard-template.json` (forthcoming — Checkpoint 4
deliverable per AAP §0.6.1.7).

## Testing

When the policy implementation arrives, this module will ship unit tests
at `src/policy.test.ts` (forthcoming) covering every branch of
`BlitzyPermissionPolicy.handle()`. They will be runnable with:

```bash
yarn workspace @internal/plugin-permission-backend-module-blitzy-policy test
```

The coverage target is **≥ 80%** per the project's authorization testing
mandate. Coverage is verified by running:

```bash
yarn workspace @internal/plugin-permission-backend-module-blitzy-policy test --coverage
```

The lint workflow already runs today against the metadata scaffolding:

```bash
yarn workspace @internal/plugin-permission-backend-module-blitzy-policy lint
```

## See also

- `docs/refactor/decision-log.md` (forthcoming — Checkpoint 4 per AAP
  §0.6.1.7) will record the rationale for choosing a separate plugin
  module over an inline policy in `packages/backend/src/`, and the
  rejected alternatives for the email-source resolution path.
- `docs/permissions/writing-a-policy.md` — Backstage upstream guide to
  authoring permission policies.
- `packages/backend/src/authModuleGithubProvider.ts` — the GitHub
  `signInResolver` that will be augmented to populate
  `spec.profile.email` on the User catalog entity in a subsequent
  checkpoint.

_This plugin was created through the Backstage CLI._
