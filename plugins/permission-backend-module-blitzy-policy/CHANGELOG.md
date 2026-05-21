# @internal/plugin-permission-backend-module-blitzy-policy

## 0.1.0

### Minor Changes

- Initial release: `BlitzyPermissionPolicy` enforcing read-only access for non-`@blitzy.com` domains and Guest principals.

  This permission backend module replaces the registration of
  `@backstage/plugin-permission-backend-module-allow-all-policy` in
  `packages/backend/src/index.ts`. It implements the read-only enforcement
  requirement that "any user logging in with a domain other than
  `@blitzy.com` or as a Guest must be strictly assigned read-only access".

  Decision matrix:

  - `read` action → `ALLOW` regardless of principal.
  - Any action when the user's email ends with `@blitzy.com` (case-insensitive,
    strict suffix match) → `ALLOW`.
  - Guest principal (`user:default/guest`) attempting `create`, `update`, or
    `delete` → `DENY`.
  - Non-Blitzy email (or missing email) attempting `create`, `update`, or
    `delete` → `DENY`.

  The policy reads the email from `PolicyQueryUser.info.email` which is
  populated by the augmented GitHub `signInResolver` in
  `packages/backend/src/authModuleGithubProvider.ts`. The policy itself is
  stateless and performs no catalog lookups.

### Dependencies

- @backstage/backend-plugin-api@workspace:^
- @backstage/plugin-auth-node@workspace:^
- @backstage/plugin-catalog-common@workspace:^
- @backstage/plugin-permission-common@workspace:^
- @backstage/plugin-permission-node@workspace:^
