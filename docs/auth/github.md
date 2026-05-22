# GitHub Authentication Provider

> **Index page.** The canonical content for the GitHub authentication provider lives at [`github/provider.md`](./github/provider.md). This file exists so that links written as `docs/auth/github.md` (used in some AAP references and in `blitzy/documentation/Technical Specifications.md`) resolve to a valid Markdown page. New documentation should link to [`github/provider.md`](./github/provider.md) directly.

## Quick Navigation

| Topic                                                                         | See                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Provider configuration (callback URL, client ID, secret)                      | [`github/provider.md`](./github/provider.md) — top of file                                                   |
| Backend module registration                                                   | [`github/provider.md`](./github/provider.md) — "Backend Installation" section                                |
| Frontend `SignInPage` wiring                                                  | [`github/provider.md`](./github/provider.md) — "Adding the provider to the Backstage frontend" section       |
| Blitzy Sandbox audit event emission (`user-login`)                            | [`github/provider.md`](./github/provider.md) — "Audit Event Emission (Blitzy Sandbox Customization)" section |
| Synthetic correlation id pattern (because SignInResolver lacks `ctx.request`) | [`github/provider.md`](./github/provider.md) — "Correlation" subsection                                      |
| `selectPrimaryGithubEmail()` priority chain                                   | [`github/provider.md`](./github/provider.md) — "Email extraction" subsection                                 |
| Custom JWT `email` claim flow consumed by `BlitzyPermissionPolicy`            | [`github/provider.md`](./github/provider.md) — "Propagation as a custom JWT claim" subsection                |

## Related auth surface documentation

- [`./index.md`](./index.md) — High-level narrative across the auth surface (including the audit event emission and email-domain authorization layers).
- [`./identity-resolver.md`](./identity-resolver.md) — Full resolver lifecycle, illustrative pseudo-code, and the email-extraction priority chain in context.
- [`../refactor/decision-log.md`](../refactor/decision-log.md) — Rationale for the email-source priority chain and the choice to propagate email via a custom JWT claim rather than via `BackstageIdentityResponse.profile.email`.
- [`../observability/dashboards.md`](../observability/dashboards.md) — The audit-event channel and the **planned** Prometheus counters (`user_login_total`, `blitzy_permission_decisions_total`) that will visualize sign-ins and policy decisions once they are wired into their emission sites (implementation tracked in [`../refactor/next-tasks.md`](../refactor/next-tasks.md) entry 1).
- [`../permissions/writing-a-policy.md`](../permissions/writing-a-policy.md) — Upstream Backstage patterns on permission policy authoring.
