# @internal/plugin-permission-backend-module-blitzy-policy

## 0.1.0

### Minor Changes

- Initial scaffolding for `@internal/plugin-permission-backend-module-blitzy-policy`.

  This release contains the workspace metadata needed for downstream
  implementation work (`package.json`, `tsconfig`, `.eslintrc.js`,
  `catalog-info.yaml`, `README.md`, `CHANGELOG.md`, `knip-report.md`) plus a
  minimal `src/index.ts` entry-point placeholder that documents the upcoming
  `BlitzyPermissionPolicy` contract via a `BlitzyPermissionPolicyModulePlaceholder`
  interface.

  The intent (forthcoming in a subsequent checkpoint, per Agent Action Plan
  §0.6.1.4) is to ship `BlitzyPermissionPolicy`: a permission policy that
  enforces read-only access for any user whose verified email domain is not
  `@blitzy.com` and for Backstage Guest principals, replacing the registration
  of `@backstage/plugin-permission-backend-module-allow-all-policy` in
  `packages/backend/src/index.ts`.

  Planned decision matrix:

  - `read` action → `ALLOW` regardless of principal.
  - Any action when the user's email ends with `@blitzy.com` (case-insensitive,
    strict suffix match) → `ALLOW`.
  - Guest principal (`user:default/guest`) attempting `create`, `update`, or
    `delete` → `DENY`.
  - Non-Blitzy email (or missing email) attempting `create`, `update`, or
    `delete` → `DENY`.

  Planned email-source resolution (the upstream `BackstageUserInfo` carried in
  `PolicyQueryUser.info` exposes only `userEntityRef` and
  `ownershipEntityRefs` and does **not** carry an email field, so the policy
  cannot read the email from `info.email`):

  1. The augmented GitHub `signInResolver` in
     `packages/backend/src/authModuleGithubProvider.ts` will extract the email
     from `result.fullProfile.emails[0].value` (primary) or
     `result.userinfo.email`.
  2. The resolver will persist that email onto the corresponding `User`
     catalog entity at `spec.profile.email` (the same convention used by the
     upstream AWS ALB auth provider, see
     `plugins/auth-backend-module-aws-alb-provider/src/resolvers.ts`).
  3. At permission-check time, `BlitzyPermissionPolicy` will resolve
     `user.info.userEntityRef` against the catalog via the injected
     `catalogService` and read `spec.profile.email` from the returned `User`
     entity. If the lookup fails or the entity has no `spec.profile.email`,
     the policy will fail closed and treat the user as non-Blitzy.

  See the package `README.md` for the full design contract.

### Dependencies

- @backstage/backend-plugin-api@workspace:^
- @backstage/plugin-auth-node@workspace:^
- @backstage/plugin-catalog-common@workspace:^
- @backstage/plugin-permission-common@workspace:^
- @backstage/plugin-permission-node@workspace:^
