# @internal/plugin-permission-backend-module-blitzy-policy

The Blitzy permission policy backend module for the Backstage `permission`
plugin. This module installs `BlitzyPermissionPolicy` into the permission
backend, replacing the upstream
`@backstage/plugin-permission-backend-module-allow-all-policy` registration.

## What it does

`BlitzyPermissionPolicy` enforces a deny-by-default posture for any write
action (`create`, `update`, `delete`) performed by a user whose verified email
domain is not `@blitzy.com`, or by a Backstage Guest user. Read actions remain
unconditionally allowed so that every signed-in user (including Guests and
non-Blitzy domains) can browse the catalog.

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

The policy is stateless and side-effect free: it performs no catalog lookups
and no I/O. Decisions are O(1) based on identity already hydrated by the
upstream `signInResolver`.

## Registration

This module is registered by `packages/backend/src/index.ts` via:

```ts
backend.add(import('@internal/plugin-permission-backend-module-blitzy-policy'));
```

Registration replaces the previous
`backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy'))`
call. Only one permission policy may be installed at a time; mixing this
module with the allow-all module is not supported.

The permission framework must be enabled in `app-config.yaml`:

```yaml
permission:
  enabled: true
```

## How the email is sourced

The policy reads the user's email from `PolicyQueryUser.info.email`. This
field is populated by the augmented GitHub `signInResolver` in
`packages/backend/src/authModuleGithubProvider.ts`, which extracts the email
from `result.fullProfile.emails[0].value` (primary) or `result.userinfo.email`
during sign-in and adds it to the issued identity.

The policy never trusts a client-asserted email. It only reads the email that
the server-side resolver placed onto the identity at sign-in time. If no
email was hydrated (rare GitHub edge case where the user has hidden their
primary email), the policy treats the user as non-Blitzy and enforces
read-only access — failing closed by design.

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

To allow additional email domains, edit `src/policy.ts` and broaden the
`isBlitzyDomain(email)` helper. Document the change in the project decision
log at `docs/refactor/decision-log.md`. Add unit tests in
`src/policy.test.ts` covering each new allowlisted domain.

## Observability

Each policy decision emits an OpenTelemetry counter
`blitzy_permission_decisions_total{result, email_domain, action}` where
`email_domain` is bucketed to `blitzy.com`, `other`, or `guest` (no PII). The
counter is consumed by the Grafana dashboard at
`docs/observability/dashboard-template.json`.

## Testing

This module ships unit tests at `src/policy.test.ts` covering every branch
of `BlitzyPermissionPolicy.handle()`. Run them with:

```bash
yarn workspace @internal/plugin-permission-backend-module-blitzy-policy test
```

The coverage target is **≥ 80%** per the project's authorization testing
mandate. Coverage is verified by running:

```bash
yarn workspace @internal/plugin-permission-backend-module-blitzy-policy test --coverage
```

## See also

- `docs/refactor/decision-log.md` — rationale for choosing a separate plugin
  module over an inline policy in `packages/backend/src/`, and the rejected
  alternatives for email source priority.
- `docs/permissions/writing-a-policy.md` — Backstage upstream guide to
  authoring permission policies.
- `packages/backend/src/authModuleGithubProvider.ts` — augmented GitHub
  `signInResolver` that hydrates `info.email`.

_This plugin was created through the Backstage CLI._
