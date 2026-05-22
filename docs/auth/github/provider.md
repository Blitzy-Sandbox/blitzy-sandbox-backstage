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
- `emailDomain` — The domain portion of the user's verified primary email (e.g., `blitzy.com`, `gmail.com`, `unknown.invalid`). The full email is NEVER included — only the domain bucket. This is a privacy invariant enforced by unit tests in `packages/backend/src/authModuleGithubProvider.test.ts`.

### Lifecycle

The resolver creates the event at the start of the sign-in attempt and finalizes it based on outcome:

- On successful resolution: `auditor.createEvent({...}).success({ meta: { entityRef } })` — the entity ref of the resolved catalog user is appended to the meta.
- On resolver failure: `auditor.createEvent({...}).fail({ error, meta: { provider: 'github', username } })` — the failure cause is recorded and the original error is re-thrown so the upstream auth pipeline can surface it.

The audit event carries the same correlation ID as the HTTP request that triggered the sign-in, so administrators can join the audit event to the request and to OpenTelemetry trace spans via the correlation ID.

### Operator references

- See [`../identity-resolver.md`](../identity-resolver.md) for the full resolver lifecycle and illustrative pseudo-code.
- See [`../index.md#audit-event-emission`](../index.md) for the high-level narrative across the auth surface.

## Email-Domain Authorization (Blitzy Sandbox Customization)

> This section documents how the GitHub provider's verified email is propagated into the identity profile and consumed by the `BlitzyPermissionPolicy` to enforce read-only access for non-`@blitzy.com` principals. For the high-level decision sketch, see [`../index.md#email-domain-authorization`](../index.md).

### Email extraction

The augmented `signInResolver` extracts the user's verified primary email from the GitHub OAuth result with the following priority chain:

1. **Primary:** `result.fullProfile.emails?.[0]?.value` — the typical GitHub OAuth scope `user:email` populates this with the user's verified primary email.
2. **Fallback:** `result.userinfo?.email` — used when the rich GitHub profile does not include an emails array.
3. **Sentinel:** Synthesized as `<username>@unknown.invalid` — used when neither source is available (rare; only when the GitHub user has set their email to private and the OAuth scope does not request `user:email`). The `unknown.invalid` domain is RFC 2606 reserved and cannot match `@blitzy.com`, so it is safe to use as a non-Blitzy fallback.

### Propagation into the identity profile

After extraction, the resolver populates the email into `BackstageIdentityResponse.profile.email`. The `BlitzyPermissionPolicy.handle()` method reads this field on every authorization check — no second catalog lookup is required, and no outbound API call to GitHub is required on every request.

### Privacy posture

Only the extracted email value is propagated into the identity profile. The OAuth access token, OAuth refresh token, and the raw OAuth result payload are NEVER attached to the identity profile or recorded in audit events. The `emailDomain` field in the audit event records only the domain bucket, not the full email. These invariants are verified by unit tests in `packages/backend/src/authModuleGithubProvider.test.ts`.

### Operator references

- See [`../identity-resolver.md`](../identity-resolver.md) for the resolver lifecycle and the illustrative pseudo-code that shows email extraction in context.
- See [`../index.md#email-domain-authorization`](../index.md) for the policy decision sketch (5 branches: read, Blitzy + write, non-Blitzy + write, Guest + write, missing email).
- See [`../../refactor/decision-log.md`](../../refactor/decision-log.md) for the rationale behind the email-source priority chain.
- See [`../../observability/dashboards.md`](../../observability/dashboards.md) for the Prometheus counters that visualize the policy decisions.
- See [`../../permissions/writing-a-policy.md`](../../permissions/writing-a-policy.md) for upstream Backstage patterns on permission policy authoring.
