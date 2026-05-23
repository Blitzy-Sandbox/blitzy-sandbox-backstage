---
id: provider
title: GitHub Authentication Provider
sidebar_label: GitHub
description: Adding GitHub OAuth as an authentication provider in Backstage
---

The Backstage `core-plugin-api` package comes with a GitHub authentication
provider that can authenticate users using GitHub or GitHub Enterprise OAuth.

## Create an OAuth App on GitHub

To add GitHub authentication, you must create either a GitHub App or an OAuth
App from the GitHub
[developer settings](https://github.com/settings/developers). The `Homepage URL`
should point to Backstage's frontend, while the `Authorization callback URL`
will point to the auth backend.

Note that if you're using a GitHub App, the allowed scopes are configured as
part of that app. This means you need to verify what scopes the plugins you use
require, so be sure to check the plugin READMEs for that information.

Settings for local development:

- Application name: Backstage (or your custom app name)
- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:7007/api/auth/github/handler/frame`

### Difference between GitHub Apps and GitHub OAuth Apps

GitHub Apps handle OAuth scope at the app installation level, meaning that the
`scope` parameter for the call to `getAccessToken` in the frontend has no
effect. When calling `getAccessToken` in open source plugins, one should still
include the appropriate scope, but also document in the plugin README what
scopes are required for GitHub Apps.

## Configuration

The provider configuration can then be added to your `app-config.yaml` under the
root `auth` configuration:

```yaml
auth:
  environment: development
  providers:
    github:
      development:
        clientId: ${AUTH_GITHUB_CLIENT_ID}
        clientSecret: ${AUTH_GITHUB_CLIENT_SECRET}
        ## uncomment if using GitHub Enterprise
        # enterpriseInstanceUrl: ${AUTH_GITHUB_ENTERPRISE_INSTANCE_URL}
        ## uncomment to set lifespan of user session
        # sessionDuration: { hours: 24 } # supports `ms` library format (e.g. '24h', '2 days'), ISO duration, "human duration" as used in code
        signIn:
          resolvers:
            # See https://backstage.io/docs/auth/github/provider#resolvers for more resolvers
            - resolver: usernameMatchingUserEntityName
```

The GitHub provider is a structure with these configuration keys:

- `clientId`: The client ID that you generated on GitHub, e.g.,
  `b59241722e3c3b4816e2`
- `clientSecret`: The client secret tied to the generated client ID.
- `enterpriseInstanceUrl` (optional): The base URL for a GitHub Enterprise
  instance, e.g., `https://ghe.<company>.com`. Only needed for GitHub Enterprise.
- `callbackUrl` (optional): The callback URL that GitHub will use when
  initiating an OAuth flow, e.g.,
  `https://your-intermediate-service.com/handler`. Only needed if Backstage is
  not the immediate receiver (e.g., one OAuth app for many backstage instances).
- `sessionDuration` (optional): Lifespan of the user session.
- `signIn`: The configuration for the sign-in process, including the **resolvers**
  that should be used to match the user from the auth provider with the user
  entity in the Backstage catalog (typically a single resolver is sufficient).

### Resolvers

This provider includes several resolvers out of the box that you can use:

- `emailMatchingUserEntityProfileEmail`: Matches the email address from the auth provider with the User entity that has a matching `spec.profile.email`. If no match is found, it will throw a `NotFoundError`.
- `emailLocalPartMatchingUserEntityName`: Matches the [local part](https://en.wikipedia.org/wiki/Email_address#Local-part) of the email address from the auth provider with the User entity that has a matching `name`. If no match is found, it will throw a `NotFoundError`.
- `usernameMatchingUserEntityName`: Matches the username from the auth provider with the User entity that has a matching `name`. If no match is found, it will throw a `NotFoundError`.
- `userIdMatchingUserEntityAnnotation`: Matches the GitHub user ID with the User entity that has a matching `github.com/user-id`. If no match is found, it will throw a `NotFoundError`.

:::note Note

The resolvers will be tried in order but will only be skipped if they throw a `NotFoundError`.

:::

If these resolvers do not fit your needs, you can build a custom resolver; this is covered in the [Building Custom Resolvers](../identity-resolver.md#building-custom-resolvers) section of the Sign-in Identities and Resolvers documentation.

## Backend Installation

To add the provider to the backend we will first need to install the package by running this command:

```bash title="from your Backstage root directory"
yarn --cwd packages/backend add @backstage/plugin-auth-backend-module-github-provider
```

Then we will need to add this line:

```ts title="in packages/backend/src/index.ts"
backend.add(import('@backstage/plugin-auth-backend'));
/* highlight-add-start */
backend.add(import('@backstage/plugin-auth-backend-module-github-provider'));
/* highlight-add-end */
```

## Adding the provider to the Backstage frontend

To add the provider to the frontend, add the `githubAuthApi` reference and
`SignInPage` component as shown in
[Adding the provider to the sign-in page](../index.md#sign-in-configuration).

## Audit Event Emission (Blitzy Sandbox Customization)

> This section documents a Blitzy Sandbox–specific customization layered on top of the upstream GitHub authentication provider. For the high-level narrative across the auth surface, see [`../index.md#audit-event-emission`](../index.md). For the resolver implementation walkthrough, see [`../identity-resolver.md#augmented-github-sign-in-resolver-blitzy-sandbox`](../identity-resolver.md).

In the Blitzy Sandbox fork of Backstage, the GitHub `signInResolver` emits a `user-login` audit event via Backstage's `coreServices.auditor` on every sign-in attempt.

### Event identity

- **Event ID:** `user-login`
- **Severity level:** `medium`
- **Source:** the augmented `signInResolver` in `packages/backend/src/authModuleGithubProvider.ts`

### Metadata fields

The event's `meta` payload contains:

- `provider` — Always `github` for events emitted by this provider.
- `username` — The GitHub login (e.g., `octocat`), sourced from `result.fullProfile.username`.
- `emailDomain` — The domain portion of the user's verified primary email (e.g., `blitzy.com`, `gmail.com`, `unknown.invalid`). The full email is NEVER included — only the domain bucket. This is a privacy invariant verified by unit tests in `packages/backend/src/authModuleGithubProvider.test.ts`.
- `userEntityRef` — The resolved catalog user entity reference (e.g., `user:default/octocat`).
- `correlationId` — A synthetic UUID minted via `crypto.randomUUID()` inside the resolver. The Backstage `SignInResolver` callback signature is `(info, ctx) => Promise<BackstageSignInResult>` and does **not** expose the inbound Express `request` object, so the resolver cannot read the canonical HTTP correlation id and must synthesize its own join key. See "Correlation" below.

### Lifecycle

The resolver creates the event at the start of the sign-in attempt and finalizes it based on outcome:

- On successful token issuance: `auditor.createEvent({...}).success({ meta: { entityRef, correlationId } })` — the entity ref of the resolved catalog user and the synthetic correlationId are appended to the meta.
- On resolver failure: `auditor.createEvent({...}).fail({ error, meta: { provider: 'github', username, correlationId } })` — the failure cause is recorded and the original error is re-thrown so the upstream auth pipeline can surface it.

### Correlation

The audit event carries a synthetic `correlationId` (a `randomUUID()` minted inside the resolver) rather than the inbound HTTP request's correlation id, because the Backstage `SignInResolver` callback does not expose the Express `request` object. Operators correlating a `user-login` event back to its triggering HTTP request should match surrounding log lines on the same `requestId` field emitted by `coreServices.httpRouter`, or use the audit-event timestamp against the request log timeline. By contrast, the complementary `entity-access` event emitted from the catalog access-audit middleware does run in HTTP request context and carries the canonical request-scoped correlation id directly.

### Operator references

- See [`../identity-resolver.md`](../identity-resolver.md) for the full resolver lifecycle and illustrative pseudo-code, including the synthetic correlationId generation and the email-extraction priority chain.
- See [`../index.md#audit-event-emission`](../index.md) for the high-level narrative across the auth surface.

## Email-Domain Authorization (Blitzy Sandbox Customization)

> This section documents how the GitHub provider's verified email is propagated through a custom JWT claim and consumed by the `BlitzyPermissionPolicy` to enforce read-only access for non-`@blitzy.com` principals. For the high-level decision sketch, see [`../index.md#email-domain-authorization`](../index.md).

### Email extraction

The augmented `signInResolver` selects the user's verified primary email from the GitHub OAuth result with a `selectPrimaryGithubEmail()` helper that walks the email array and prefers entries flagged as primary. The full priority chain:

1. **Primary-flagged entry:** `result.fullProfile.emails.find(e => e.primary === true)?.value` — the verified primary email as flagged by GitHub. When the OAuth scope `user:email` is granted and `allRawEmails: true` is enabled, the emails array can return secondary emails before the primary, so the resolver must explicitly search for the entry with `primary === true` rather than blindly reading index 0.
2. **Index 0 fallback:** `result.fullProfile.emails?.[0]?.value` — used when no entry carries `primary: true` (some older OAuth payload shapes do not include the `primary` flag).
3. **OAuth userinfo fallback:** `result.userinfo?.email` — used when the rich GitHub profile does not include an emails array.
4. **Sentinel:** Synthesized as `<userId>@unknown.invalid` — used when neither source is available (rare; only when the GitHub user has set their email to private and the OAuth scope does not request `user:email`). The `unknown.invalid` domain is RFC 2606 reserved and cannot match `@blitzy.com`, so it is safe to use as a non-Blitzy fallback.

### Propagation as a custom JWT claim

After extraction, the resolver does **not** mutate or return `BackstageIdentityResponse.profile.email`. Instead, it issues the Backstage identity token via `ctx.issueToken({ claims: { sub: userEntityRef, ent: [userEntityRef], email: primaryEmail } })`, embedding the email as a custom JWT claim alongside the standard `sub` and `ent` claims. The `BlitzyPermissionPolicy.extractEmail()` method then decodes the token on every authorization check:

1. First, it checks `user.info?.email` (forward-compat path — Backstage's default `UserInfoService` populates only `sub` and `ent` today, so this path is a no-op until a future `UserInfoService` implementation surfaces the `email` claim).
2. Otherwise, it calls `jose.decodeJwt(user.credentials.token)` (a non-verifying decode — the token's cryptographic signature has already been verified by `DefaultAuthService.authenticate` before reaching the policy) and reads `payload.email` from the decoded JWT.

No second catalog lookup is required, and no outbound API call to GitHub is required on every request — the email travels with the Backstage-issued JWT itself.

### Privacy posture

Only the extracted email value is propagated into the JWT `email` claim. The OAuth access token, OAuth refresh token, and the raw OAuth result payload are NEVER attached to the identity token or recorded in audit events. The `emailDomain` field in the audit event records only the domain bucket, not the full email. These invariants are verified by unit tests in `packages/backend/src/authModuleGithubProvider.test.ts`.

### Operator references

- See [`../identity-resolver.md`](../identity-resolver.md) for the resolver lifecycle and the illustrative pseudo-code that shows email extraction in context, including `selectPrimaryGithubEmail()` and `ctx.issueToken({ claims: { email } })`.
- See [`../index.md#email-domain-authorization`](../index.md) for the policy decision sketch (5 branches: read, Blitzy + write, non-Blitzy + write, Guest + write, missing email).
- See [`../../refactor/decision-log.md`](../../refactor/decision-log.md) for the rationale behind the email-source priority chain and the choice to propagate email via a custom JWT claim rather than via `BackstageIdentityResponse.profile.email`.
- See [`../../observability/dashboards.md`](../../observability/dashboards.md) for the audit-event channel and the **emitted** Prometheus counters (`user_login_total{provider, email_domain}`, `blitzy_permission_decisions_total{result, email_domain, action}`, `entity_access_total{action}`) that visualize sign-ins, policy decisions, and entity reads. All three counters are implemented at their canonical emission sites — `packages/backend/src/authModuleGithubProvider.ts` for `user_login_total`, `plugins/permission-backend-module-blitzy-policy/src/policy.ts` for `blitzy_permission_decisions_total`, and `plugins/catalog-backend-module-access-audit/src/module.ts` for `entity_access_total`. Verify by triggering a guest sign-in and an entity read, then `curl -s http://localhost:9464/metrics | grep -E '^(user_login_total|entity_access_total|blitzy_permission_decisions_total)'`.
- See [`../../permissions/writing-a-policy.md`](../../permissions/writing-a-policy.md) for upstream Backstage patterns on permission policy authoring.
