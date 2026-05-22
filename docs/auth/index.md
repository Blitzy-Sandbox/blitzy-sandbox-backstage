---
id: index
title: Authentication in Backstage
description: Introduction to authentication in Backstage
---

The authentication system in Backstage serves two distinct purposes: sign-in and
identification of users, as well as delegating access to third-party resources. It is possible to
configure Backstage to have any number of authentication providers, but only
one of these will typically be used for sign-in, with the rest being used to provide
access to external resources.

:::note Note

Identity management and the Sign-In page in Backstage will only block external access when using the new backend system, without setting `backend.auth.dangerouslyDisableDefaultAuthPolicy` in configuration. Even so, the frontend bundle is not protected from external access, protecting it requires the use of the [experimental public entry point](https://backstage.io/docs/tutorials/enable-public-entry/). You can learn more about this in the [Threat Model](../overview/threat-model.md#operator-responsibilities).

:::

## Built-in Authentication Providers

Backstage comes with many common authentication providers in the core library:

- [Auth0](auth0/provider.md)
- [Atlassian](atlassian/provider.md)
- [Azure](microsoft/provider.md)
- [Azure Easy Auth](microsoft/azure-easyauth.md)
- [Bitbucket](bitbucket/provider.md)
- [Bitbucket Server](bitbucketServer/provider.md)
- [Cloudflare Access](cloudflare/provider.md)
- [GitHub](github/provider.md)
- [GitLab](gitlab/provider.md)
- [Google](google/provider.md)
- [Google IAP](google/gcp-iap-auth.md)
- [Okta](okta/provider.md)
- [OAuth 2 Custom Proxy](oauth2-proxy/provider.md)
- [OneLogin](onelogin/provider.md)
- [OpenShift](openshift/provider.md)
- [VMware Cloud](vmware-cloud/provider.md)

These built-in providers handle the authentication flow for a particular service, including required scopes, callbacks, etc. These providers are each added to a
Backstage app in a similar way.

## Configuring Authentication Providers

Each built-in provider has a configuration block under the `auth` section of
`app-config.yaml`. For example, the GitHub provider:

```yaml
auth:
  environment: development
  providers:
    github:
      development:
        clientId: ${AUTH_GITHUB_CLIENT_ID}
        clientSecret: ${AUTH_GITHUB_CLIENT_SECRET}
```

See the documentation for a particular provider to see what configuration is
needed.

The `providers` key may have several authentication providers if multiple
authentication methods are supported. Each provider may also have configuration
for different authentication environments (development, production, etc). This
allows a single auth backend to serve multiple environments, such as running a
local frontend against a deployed backend. The provider configuration matching
the local `auth.environment` setting will be selected.

## Sign-In Configuration

Using an authentication provider for sign-in is something you need to configure
both in the frontend app as well as the `auth` backend plugin. For information
on how to configure the backend app, see [Sign-in Identities and Resolvers](./identity-resolver.md).
The rest of this section will focus on how to configure sign-in for the frontend app.

Sign-in is configured by providing a custom `SignInPage` app component. It will be
rendered before any other routes in the app and is responsible for providing the
identity of the current user. The `SignInPage` can render any number of pages and
components, or just blank space with logic running in the background. In the end, however, it must provide a valid Backstage user identity through the `onSignInSuccess`
callback prop, at which point the rest of the app is rendered.

If you want to, you can use the `SignInPage` component that is provided by `@backstage/core-components`,
which takes either a `provider` or `providers` (array) prop of `SignInProviderConfig` definitions.

The following example for GitHub shows the additions needed to `packages/app/src/App.tsx`,
and can be adapted to any of the built-in providers:

```tsx title="packages/app/src/App.tsx"
/* highlight-add-start */
import { githubAuthApiRef } from '@backstage/core-plugin-api';
import { SignInPage } from '@backstage/core-components';
/* highlight-add-end */

const app = createApp({
  /* highlight-add-start */
  components: {
    SignInPage: props => (
      <SignInPage
        {...props}
        auto
        provider={{
          id: 'github-auth-provider',
          title: 'GitHub',
          message: 'Sign in using GitHub',
          apiRef: githubAuthApiRef,
        }}
      />
    ),
  },
  /* highlight-add-end */
  // ..
});
```

:::note Note

You can configure sign-in to use a redirect flow with no pop-up by adding
`enableExperimentalRedirectFlow: true` to the root of your `app-config.yaml`

:::

### Using Multiple Providers

You can also use the `providers` prop to enable multiple sign-in methods, for example to allow guest access:

```tsx title="packages/app/src/App.tsx"
const app = createApp({
  /* highlight-add-start */
  components: {
    SignInPage: props => (
      <SignInPage
        {...props}
        providers={[
          'guest',
          {
            id: 'github-auth-provider',
            title: 'GitHub',
            message: 'Sign in using GitHub',
            apiRef: githubAuthApiRef,
          },
        ]}
      />
    ),
  },
  /* highlight-add-end */
  // ..
});
```

### Conditionally Render Sign In Provider

In the above example, you have both Guest and GitHub sign-in options; this is helpful for non-production, but in Production you will most likely not want to offer Guest access. You can easily use information from your config to help conditionally render the provider:

```tsx title="packages/app/src/App.tsx"
import {
  configApiRef,
  githubAuthApiRef,
  useApi,
} from '@backstage/core-plugin-api';

const app = createApp({
  components: {
    SignInPage: props => {
      const configApi = useApi(configApiRef);
      if (configApi.getString('auth.environment') === 'development') {
        return (
          <SignInPage
            {...props}
            providers={[
              'guest',
              {
                id: 'github-auth-provider',
                title: 'GitHub',
                message: 'Sign in using GitHub',
                apiRef: githubAuthApiRef,
              },
            ]}
          />
        );
      }
      return (
        <SignInPage
          {...props}
          provider={{
            id: 'google-auth-provider',
            title: 'Google',
            message: 'Sign In using Google',
            apiRef: googleAuthApiRef,
          }}
        />
      );
    },
  },
  // ..
});
```

## Sign-In with Proxy Providers

Some auth providers are so-called "proxy" providers, meaning they're meant to be used
behind an authentication proxy. Examples of these are
[Amazon Application Load Balancer](https://github.com/backstage/backstage/blob/master/contrib/docs/tutorials/aws-alb-aad-oidc-auth.md),
[Azure EasyAuth](./microsoft/azure-easyauth.md),
[Cloudflare Access](./cloudflare/provider.md),
[Google Identity-Aware Proxy](./google/gcp-iap-auth.md)
and [OAuth2 Proxy](./oauth2-proxy/provider.md).

When using a proxy provider, you'll end up wanting to use a different sign-in page, as
there is no need for further user interaction once you've signed in towards the proxy.
All the sign-in page needs to do is call the `/refresh` endpoint of the auth providers
to get the existing session, which is exactly what the `ProxiedSignInPage` does. The only
thing you need to do to configure the `ProxiedSignInPage` is to pass the ID of the provider like this:

```tsx title="packages/app/src/App.tsx"
import { ProxiedSignInPage } from '@backstage/core-components';

const app = createApp({
  components: {
    SignInPage: props => <ProxiedSignInPage {...props} provider="awsalb" />,
  },
  // ..
});
```

If the provider in auth backend expects additional headers such as `x-provider-token`, there is now a way to configure that in `ProxiedSignInPage` using the optional `headers` prop.

Example:

```tsx
<ProxiedSignInPage
  {...props}
  provider="my-custom-provider"
  /* highlight-next-line */
  headers={{ 'x-some-key': someValue }}
/>
```

Headers can also be returned in an async manner:

```tsx
<ProxiedSignInPage
  {...props}
  provider="my-custom-provider"
  /* highlight-start */
  headers={async () => {
    const someValue = await someFn();
    return { 'x-some-key': someValue };
  }}
  /* highlight-end */
/>
```

A downside of this method is that it can be cumbersome to set up for local development.
As a workaround for this, it's possible to dynamically select the sign-in page based on
what environment the app is running in and then use a different sign-in method for local
development, if one is needed at all. Depending on the exact setup, one might choose to
select the sign-in method based on the `process.env.NODE_ENV` environment variable,
by checking the `hostname` of the current location, or by accessing the configuration API
to read a configuration value. For example:

```tsx title="packages/app/src/App.tsx"
const app = createApp({
  components: {
    SignInPage: props => {
      const configApi = useApi(configApiRef);
      if (configApi.getString('auth.environment') === 'development') {
        return (
          <SignInPage
            {...props}
            provider={{
              id: 'google-auth-provider',
              title: 'Google',
              message: 'Sign In using Google',
              apiRef: googleAuthApiRef,
            }}
          />
        );
      }
      return <ProxiedSignInPage {...props} provider="gcpiap" />;
    },
  },
  // ..
});
```

When using multiple auth providers like this, it's important that you configure the different
sign-in resolvers so that they resolve to the same identity regardless of the method used.

## Scaffolder Configuration (Software Templates)

If you want to use the authentication capabilities of the [Repository Picker](../features/software-templates/writing-templates.md#the-repository-picker) inside your software templates, you will need to configure the [`ScmAuthApi`](https://backstage.io/api/stable/interfaces/_backstage_integration-react.ScmAuthApi.html) alongside your authentication provider. It is an API used to authenticate towards different SCM systems in a generic way, based on what resource is being accessed.

To set it up, you'll need to add an API factory entry to `packages/app/src/apis.ts`. The example below sets up the `ScmAuthApi` for an already configured GitLab authentication provider:

```ts title="packages/app/src/apis.ts"
createApiFactory({
  api: scmAuthApiRef,
  deps: {
    gitlabAuthApi: gitlabAuthApiRef,
  },
  factory: ({ gitlabAuthApi }) => ScmAuth.forGitlab(gitlabAuthApi),
});
```

In case you are using a custom authentication providers, you might need to add a [custom `ScmAuthApi` implementation](./index.md#custom-scmauthapi-implementation).

## For Plugin Developers

The Backstage frontend core APIs provide a set of Utility APIs for plugin developers
to use, both to access the user identity as well as third-party resources.

### Identity for Plugin Developers

For plugin developers, there is one main touchpoint for accessing the user identity: the
`IdentityApi` exported by `@backstage/core-plugin-api` via the `identityApiRef`.

The `IdentityApi` gives access to the signed-in user's identity in the frontend.
It provides access to the user's entity reference, lightweight profile information, and
a Backstage token that identifies the user when making authenticated calls within Backstage.

When making calls to backend plugins, we recommend that the `FetchApi` is used, which
is exported via the `fetchApiRef` from `@backstage/core-plugin-api`. The `FetchApi` will
automatically include a Backstage token in the request, meaning there is no need
to interact directly with the `IdentityApi`.

### Accessing Third Party Resources

A common pattern for talking to third-party services in Backstage is
user-to-server requests, where short-lived OAuth Access Tokens are requested by
plugins to authenticate calls to external services. These calls can be made
either directly to the services or through a backend plugin or service.

By relying on user-to-server calls, we keep the coupling between the frontend and
backend low and provide a much lower barrier for plugins to make use of third
party services. This is in comparison to, for example, a session-based system
where access tokens are stored server-side. Such a solution would require a much
deeper coupling between the auth backend plugin, its session storage, and other
backend plugins or separate services. A goal of Backstage is to make it as easy
as possible to create new plugins, and an auth solution based on user-to-server
OAuth helps in that regard.

The method with which frontend plugins request access to third-party services is
through [Utility APIs](../api/utility-apis.md) for each service provider. These
are all suffixed with `*AuthApiRef`, for example `githubAuthApiRef`. For a
full list of providers, see the
[@backstage/core-plugin-api](https://backstage.io/api/stable/modules/_backstage_core-plugin-api.index.html#alertapiref) reference.

## Custom Authentication Provider

There are generic authentication providers for OAuth2 and SAML. These can reduce
the amount of code needed to implement a custom authentication provider that
adheres to these standards.

Backstage uses [Passport](http://www.passportjs.org/) under the hood, which has
a wide library of authentication strategies for different providers. See
[Add authentication provider](add-auth-provider.md) for details on adding a new
Passport-supported authentication method.

## Custom ScmAuthApi Implementation

The default `ScmAuthApi` provides integrations for `github`, `gitlab`, `azure` and `bitbucket` and is created by the following code in `packages/app/src/apis.ts`:

```ts
ScmAuth.createDefaultApiFactory();
```

If you require only a subset of these integrations, then you will need a custom implementation of the [`ScmAuthApi`](https://backstage.io/api/stable/interfaces/_backstage_integration-react.ScmAuthApi.html). It is an API used to authenticate different SCM systems generically, based on what resource is being accessed, and is used for example, by the Scaffolder (Software Templates) and Catalog Import plugins.

The first step is to remove the code that creates the default providers.

```ts title="packages/app/src/apis.ts"
import {
  ScmIntegrationsApi,
  scmIntegrationsApiRef,
  /* highlight-add-next-line */
  ScmAuth,
} from '@backstage/integration-react';

export const apis: AnyApiFactory[] = [
  /* highlight-add-next-line */
  ScmAuth.createDefaultApiFactory(),
  // ...
];
```

Then replace it with something like this, which will create an `ApiFactory` with only a GitHub provider.

```ts title="packages/app/src/apis.ts"
export const apis: AnyApiFactory[] = [
  createApiFactory({
    api: scmAuthApiRef,
    deps: {
      githubAuthApi: githubAuthApiRef,
    },
    factory: ({ githubAuthApi }) =>
      ScmAuth.merge(
        ScmAuth.forGithub(githubAuthApi),
      ),
  });
```

If you use any custom authentication integrations, a new provider can be added to the `ApiFactory`.

The first step is to create a new authentication ref, which follows the naming convention of `xxxAuthApiRef`. The example below is for a new GitHub enterprise integration which can be defined either inside the app itself if it's only used for this purpose or inside a common internal package for APIs, such as `@internal/apis`:

```ts
const gheAuthApiRef: ApiRef<OAuthApi & ProfileInfoApi & SessionApi> =
  createApiRef({
    id: 'internal.auth.ghe',
  });
```

This new API ref will only work if you define an API factory for it. For example:

```ts
createApiFactory({
  api: gheAuthApiRef,
  deps: {
    discoveryApi: discoveryApiRef,
    oauthRequestApi: oauthRequestApiRef,
    configApi: configApiRef,
  },
  factory: ({ discoveryApi, oauthRequestApi, configApi }) =>
    GithubAuth.create({
      configApi,
      discoveryApi,
      oauthRequestApi,
      provider: { id: 'ghe', title: 'GitHub Enterprise', icon: () => null },
      defaultScopes: ['read:user'],
      environment: configApi.getOptionalString('auth.environment'),
    }),
});
```

The new API ref is then used to add a new provider to the ApiFactory:

```ts
createApiFactory({
  api: scmAuthApiRef,
  deps: {
    gheAuthApi: gheAuthApiRef,
    githubAuthApi: githubAuthApiRef,
  },
  factory: ({ githubAuthApi, gheAuthApi }) =>
    ScmAuth.merge(
      ScmAuth.forGithub(githubAuthApi),
      ScmAuth.forGithub(gheAuthApi, {
        host: 'ghe.example.com',
      }),
    ),
});
```

Finally, you also need to add and configure another provider to the `auth-backend` using the provider ID, which in this example is `ghe`:

```ts
import { providers } from '@backstage/plugin-auth-backend';

// Add the following options to `createRouter` in packages/backend/src/plugins/auth.ts
providerFactories: {
  ghe: providers.github.create(),
},
```

In the new backend system you can leverage the `authProvidersExtensionPoint` for this:

```ts
// your-auth-plugin-module.ts
export const gheAuth = createBackendModule({
  // This ID must be exactly "auth" because that's the plugin it targets
  pluginId: 'auth',
  // This ID must be unique, but can be anything
  moduleId: 'ghe-auth-provider',
  register(reg) {
    reg.registerInit({
      deps: {
        providers: authProvidersExtensionPoint,
        logger: coreServices.logger,
      },
      async init({ providers, logger }) {
        providers.registerProvider({
          // This ID must match the actual provider config, e.g. addressing
          // auth.providers.ghe means that this must be "ghe".
          providerId: 'ghe',
          factory: createOAuthProviderFactory({
            authenticator: githubAuthenticator,
            signInResolverFactories: {
              ...commonSignInResolvers,
            },
          }),
        });
      },
    });
  },
});

// backend index.ts
backend.add(gheAuth);
```

## Configuring token issuers

By default, the Backstage authentication backend generates and manages its own signing keys automatically for any issued
Backstage tokens. However, these keys have a short lifetime and do not persist after instance restarts.

Alternatively, users can provide their own public and private key files to sign issued tokens. This is beneficial in
scenarios where the token verification implementation aggressively caches the list of keys, and doesn't attempt to fetch
new ones even if they encounter an unknown key id. To enable this feature add the following configuration to your config
file:

```yaml
auth:
  keyStore:
    provider: 'static'
    static:
      keys:
        # Must be declared at least once and the first one will be used for signing
        - keyId: 'primary'
          publicKeyFile: /path/to/public.key
          privateKeyFile: /path/to/private.key
          algorithm: # Optional, algorithm used to generate the keys, defaults to ES256
          # More keys can be added so with future key rotations caches already know about it
        - keyId: ...
```

The private key should be stored in the PKCS#8 format. The public key should be stored in the SPKI format.
You can generate the public/private key pair, using openssl and the ES256 algorithm by performing the following
steps:

Generate a private key using the ES256 algorithm

```sh
openssl ecparam -name prime256v1 -genkey -out private.ec.key
```

Convert it to PKCS#8 format

```sh
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in private.ec.key -out private.key
```

Extract the public key

```sh
openssl ec -inform PEM -outform PEM -pubout -in private.key -out public.key
```

## Audit Event Emission

> This section documents Blitzy Sandbox–specific customizations: how authentication events are captured as immutable audit records for security review, compliance, and operational visibility.

The Blitzy Sandbox fork of Backstage augments the GitHub authentication provider's sign-in resolver to emit a `user-login` audit event through `coreServices.auditor` on every sign-in attempt. The event records the outcome (success or failure), the principal that signed in, and the email domain bucket — never the full email address, never any OAuth access or refresh token.

### Event shape

The audit event is created via the standard Backstage `AuditorService` contract. The Backstage `SignInResolver` callback signature is `(info, ctx) => Promise<BackstageSignInResult>` and does **not** expose the inbound Express `request` object, so the resolver synthesizes its own `correlationId` (via `crypto.randomUUID()`) and propagates it through the audit `meta` block:

```typescript
// At the start of every sign-in attempt, the resolver mints a synthetic correlation id
const correlationId = randomUUID();

const event = auditor.createEvent({
  eventId: 'user-login',
  severityLevel: 'medium',
  // Note: no `request` field — the SignInResolver callback does not expose ctx.request.
  // The synthetic correlationId in meta is the join key for matching with surrounding HTTP log lines.
  meta: { provider: 'github', username, emailDomain, correlationId },
});

// On a successful resolution, the resolver finalizes the event with the entity ref and the same correlationId:
await event.success({ meta: { entityRef, correlationId } });

// On a resolver failure, the resolver finalizes the event with the error and the same correlationId:
await event.fail({
  error,
  meta: { provider: 'github', username, correlationId },
});
```

Severity is `medium`. The event lands in the structured JSON log alongside ordinary log lines, distinguishable by the presence of the `eventId` field. The synthetic `correlationId` is **not** identical to the inbound HTTP request's correlation id — joining a `user-login` audit event back to its triggering HTTP request is performed by matching surrounding log lines on the same `requestId` field emitted by `coreServices.httpRouter`, or by inspecting the audit-event timestamp against the request log timeline. By contrast, the complementary `entity-access` event emitted from the access-audit middleware does have access to the Express `request` (the middleware runs in request context) and is created with `auditor.createEvent({ request, ... })` so it carries the canonical request-scoped correlation id directly.

### Surface coverage

The current refactor emits the `user-login` event from the GitHub provider only. Other authentication providers (Google, GitLab, SAML, Okta, OAuth2, OIDC, Auth0, Microsoft, OneLogin, Bitbucket, Atlassian, OpenShift, VMware Cloud, AWS ALB, Cloudflare Access, Azure Easy Auth, Google IAP, OAuth2 Proxy) are not augmented in this iteration; their resolvers continue to emit no audit events.

A complementary `entity-access` audit event is emitted from the catalog backend whenever a user-credentialed entity read is served. That event is documented in [`../observability/dashboards.md`](../observability/dashboards.md) Section 6 (Audit Events).

### Operator references

- See [`./identity-resolver.md`](./identity-resolver.md) (section: "Augmented GitHub Sign-In Resolver (Blitzy Sandbox)") for the resolver implementation walkthrough and illustrative pseudo-code.
- See [`./github/provider.md`](./github/provider.md) (section: "Audit Event Emission (Blitzy Sandbox Customization)") for GitHub-specific configuration details.
- See [`../observability/dashboards.md`](../observability/dashboards.md) for the audit-event channel (the operator's source of truth for sign-in volume at this checkpoint) and for the **planned** Prometheus counter `user_login_total{provider, email_domain}` (not yet emitted — implementation tracked in [`../refactor/next-tasks.md`](../refactor/next-tasks.md) entry 1).
- See [`../refactor/decision-log.md`](../refactor/decision-log.md) for the rationale behind the email-source priority chain and the privacy posture (only the domain bucket is recorded, never the full email).

## Email-Domain Authorization

> This section documents Blitzy Sandbox–specific customizations: how the email domain captured during sign-in flows through into a deny-by-default authorization policy for non-Blitzy users and Guests.

The Blitzy Sandbox fork enforces a deny-by-default authorization posture for all non-read permissions when the signing-in principal's verified email domain is not `@blitzy.com` or when the principal is a Guest. Read permissions remain allowed for every principal so users can browse the catalog without write access.

### How the email reaches the policy

The augmented GitHub `signInResolver` selects the verified primary email using a `selectPrimaryGithubEmail()` helper that prefers entries with `primary === true` before falling back to `emails[0]`, then to `result.userinfo?.email`, then to a deterministic sentinel `<userId>@unknown.invalid` (an RFC 2606 reserved domain). The resolver then passes the resulting email into the Backstage-issued token as a custom JWT claim via `ctx.issueToken({ claims: { sub: userEntityRef, ent: [userEntityRef], email } })`. On every permission check, `BlitzyPermissionPolicy.handle(request, user)` extracts the email from the user's credentials by:

1. First checking `user.info?.email` (forward-compat path that becomes populated if a future `UserInfoService` implementation surfaces the `email` claim directly — the Backstage default `UserInfoService` populates only `sub` and `ent` today, so this path is currently a no-op).
2. Otherwise decoding the JWT token at `user.credentials.token` using `jose.decodeJwt(...)` (a non-verifying decode — the token's cryptographic signature has already been verified by `DefaultAuthService.authenticate` before reaching the policy) and reading the `email` claim from the decoded payload.

No second catalog lookup is required, and no outbound API call to GitHub is required on every request — the email travels with the Backstage-issued JWT itself. See [`./identity-resolver.md`](./identity-resolver.md) for the full resolver lifecycle and the `selectPrimaryGithubEmail()` priority chain, and [`./github/provider.md`](./github/provider.md) for the JWT claim flow specific to GitHub.

### Decision sketch

The `BlitzyPermissionPolicy.handle(request, user)` method evaluates each permission check by the following branches:

- **Read action (any permission whose `attributes.action === 'read'`)** — `ALLOW` for every principal, including Guest. Read access to the catalog is universal in the Blitzy Sandbox so all users can browse projects.
- **Write action (create / update / delete / refresh) with `@blitzy.com` email** — `ALLOW`. Verified Blitzy team members can perform mutations against the catalog.
- **Write action with email domain ≠ `@blitzy.com`** — `DENY`. Users who signed in via GitHub with a personal or third-party email are strictly constrained to read-only access.
- **Write action with Guest principal** — `DENY`. Guest sessions are strictly read-only regardless of any spoofed email claim. The check is performed against the principal type (`user?.principal?.type === 'guest'` or by inspecting the user entity ref), not solely against the email field.
- **Missing email** — Treated as a non-Blitzy principal. The fallback chain in the resolver synthesizes `<username>@unknown.invalid` (an RFC 2606 reserved domain) so the policy has a deterministic non-Blitzy value to evaluate. The result is `DENY` for write actions.

### Where the policy lives

The policy is implemented in `plugins/permission-backend-module-blitzy-policy/` as a stand-alone backend module. The module replaces the previously-registered `plugin-permission-backend-module-allow-all-policy` in `packages/backend/src/index.ts`. The class is `BlitzyPermissionPolicy` and the entry point is the `handle()` method.

For upstream Backstage patterns on which the policy is built, see [`../permissions/writing-a-policy.md`](../permissions/writing-a-policy.md) and [`../permissions/getting-started.md`](../permissions/getting-started.md).

### Operator references

- See [`./identity-resolver.md`](./identity-resolver.md) (section: "Augmented GitHub Sign-In Resolver (Blitzy Sandbox)") for the email-extraction chain that feeds the policy.
- See [`./github/provider.md`](./github/provider.md) (section: "Email-Domain Authorization (Blitzy Sandbox Customization)") for GitHub-specific email handling.
- See [`../observability/dashboards.md`](../observability/dashboards.md) for the audit-event channel (operator's source of truth at this checkpoint) and for the **planned** Prometheus counter `blitzy_permission_decisions_total{result, email_domain, action}` (not yet emitted — implementation tracked in [`../refactor/next-tasks.md`](../refactor/next-tasks.md) entry 1). Until the counter lands, ALLOW/DENY decisions are visible only via the structured logs emitted by `BlitzyPermissionPolicy` and via the policy unit tests in `plugins/permission-backend-module-blitzy-policy/src/policy.test.ts`.
- See [`../refactor/decision-log.md`](../refactor/decision-log.md) for the rationale behind the deny-by-default posture and the email-source priority chain.
- See [`../permissions/writing-a-policy.md`](../permissions/writing-a-policy.md) for upstream Backstage patterns on permission policy authoring.
