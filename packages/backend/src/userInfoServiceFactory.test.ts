/*
 * Copyright 2024 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  BackstageCredentials,
  BackstageUserPrincipal,
} from '@backstage/backend-plugin-api';
import { mockServices } from '@backstage/backend-test-utils';
import { JsonObject } from '@backstage/types';
import { SignJWT, importJWK } from 'jose';
import { BlitzyUserInfoService } from './userInfoServiceFactory';
import {
  _testOnlyCacheSize,
  _testOnlyClearUserEmailCache,
  cacheUserEmail,
  lookupUserEmail,
} from './userEmailCache';

describe('BlitzyUserInfoService', () => {
  // Mock JWK for signing test tokens. The signature is not verified by
  // BlitzyUserInfoService (the upstream auth layer has already done so
  // before the request reaches this service); we use a valid signing
  // key purely to produce a well-formed JWT.
  const mockPrivateKey = {
    kty: 'EC',
    x: 'GHlwg744e8JekzukPTdtix6R868D6fcWy0ooOx-NEZI',
    y: 'Lyujcm0M6X9_yQi3l1eH09z0brU8K9cwrLml_fRFKro',
    crv: 'P-256',
    kid: 'mock',
    alg: 'ES256',
    d: 'KEn_mDqXYbZdRHb-JnCrW53LDOv5x4NL1FnlKcqBsFI',
  };

  async function createToken(payload: JsonObject): Promise<string> {
    return await new SignJWT(payload)
      .setProtectedHeader({
        typ: 'vnd.backstage.user',
        alg: 'ES256',
        kid: mockPrivateKey.kid,
      })
      .sign(await importJWK(mockPrivateKey));
  }

  /**
   * Constructs a `BackstageCredentials<BackstageUserPrincipal>` object
   * with a `token` field — the shape produced by the upstream
   * `DefaultAuthService.authenticate()`.
   */
  function makeCredentials(options: {
    userEntityRef: string;
    token: string;
  }): BackstageCredentials<BackstageUserPrincipal> {
    return {
      $$type: '@backstage/BackstageCredentials',
      version: 'v1',
      token: options.token,
      principal: {
        type: 'user',
        userEntityRef: options.userEntityRef,
      },
      // The `version` and `token` fields are part of the internal
      // shape; we expose them here for the service to read.
    } as unknown as BackstageCredentials<BackstageUserPrincipal>;
  }

  const discovery = mockServices.discovery.mock({
    getBaseUrl: async pluginId => `https://example.com/api/${pluginId}`,
  });

  beforeEach(() => {
    _testOnlyClearUserEmailCache();
  });

  describe('happy path: token carries the email claim', () => {
    it('returns BackstageUserInfo with the email field populated', async () => {
      const token = await createToken({
        sub: 'user:default/alex',
        ent: ['user:default/alex', 'group:default/blitzy'],
        email: 'alex@blitzy.com',
      });
      const credentials = makeCredentials({
        userEntityRef: 'user:default/alex',
        token,
      });

      const service = new BlitzyUserInfoService({ discovery });
      const info = await service.getUserInfo(credentials);

      expect(info).toEqual({
        userEntityRef: 'user:default/alex',
        ownershipEntityRefs: ['user:default/alex', 'group:default/blitzy'],
        email: 'alex@blitzy.com',
      });
    });

    it('writes the email through to the in-process cache', async () => {
      const token = await createToken({
        sub: 'user:default/alex',
        ent: ['user:default/alex'],
        email: 'alex@blitzy.com',
      });
      const credentials = makeCredentials({
        userEntityRef: 'user:default/alex',
        token,
      });

      const service = new BlitzyUserInfoService({ discovery });
      await service.getUserInfo(credentials);

      expect(lookupUserEmail('user:default/alex')).toBe('alex@blitzy.com');
      expect(_testOnlyCacheSize()).toBe(1);
    });

    it('handles non-Blitzy email values without filtering them', async () => {
      // The service is domain-agnostic — domain filtering is the
      // policy's responsibility. The service surfaces whatever email
      // was issued.
      const token = await createToken({
        sub: 'user:default/bob',
        ent: ['user:default/bob'],
        email: 'bob@example.com',
      });
      const credentials = makeCredentials({
        userEntityRef: 'user:default/bob',
        token,
      });

      const service = new BlitzyUserInfoService({ discovery });
      const info = await service.getUserInfo(credentials);

      expect(info).toEqual({
        userEntityRef: 'user:default/bob',
        ownershipEntityRefs: ['user:default/bob'],
        email: 'bob@example.com',
      });
    });
  });

  describe('fallback path: token has no email (on-behalf-of case)', () => {
    it('reads email from the cache when the JWT lacks the claim', async () => {
      // Simulate that a prior sign-in cached the email.
      cacheUserEmail('user:default/alex', 'alex@blitzy.com');

      // Now construct an on-behalf-of token that has `sub` and `ent`
      // but NO `email` claim (the real on-behalf-of behavior).
      const token = await createToken({
        sub: 'user:default/alex',
        ent: ['user:default/alex'],
        // No `email`.
      });
      const credentials = makeCredentials({
        userEntityRef: 'user:default/alex',
        token,
      });

      const service = new BlitzyUserInfoService({ discovery });
      const info = await service.getUserInfo(credentials);

      expect(info).toEqual({
        userEntityRef: 'user:default/alex',
        ownershipEntityRefs: ['user:default/alex'],
        email: 'alex@blitzy.com',
      });
    });

    it('omits the email field entirely when neither token nor cache has it', async () => {
      const token = await createToken({
        sub: 'user:default/never-cached',
        ent: ['user:default/never-cached'],
        // No `email`.
      });
      const credentials = makeCredentials({
        userEntityRef: 'user:default/never-cached',
        token,
      });

      const service = new BlitzyUserInfoService({ discovery });
      const info = await service.getUserInfo(credentials);

      expect(info).toEqual({
        userEntityRef: 'user:default/never-cached',
        ownershipEntityRefs: ['user:default/never-cached'],
      });
      // No email field on the returned object.
      expect((info as { email?: string }).email).toBeUndefined();
    });

    it('does NOT mistake an empty-string email for a present claim', async () => {
      cacheUserEmail('user:default/cara', 'cara@blitzy.com');

      const token = await createToken({
        sub: 'user:default/cara',
        ent: ['user:default/cara'],
        email: '', // empty string — treated as missing
      });
      const credentials = makeCredentials({
        userEntityRef: 'user:default/cara',
        token,
      });

      const service = new BlitzyUserInfoService({ discovery });
      const info = await service.getUserInfo(credentials);

      // Empty-string email is treated as missing; the cache fallback
      // resolves the real email.
      expect((info as { email?: string }).email).toBe('cara@blitzy.com');
    });

    it('does NOT mistake a non-string email for a present claim', async () => {
      cacheUserEmail('user:default/dan', 'dan@blitzy.com');

      const token = await createToken({
        sub: 'user:default/dan',
        ent: ['user:default/dan'],
        email: 12345 as unknown as string, // non-string — treated as missing
      });
      const credentials = makeCredentials({
        userEntityRef: 'user:default/dan',
        token,
      });

      const service = new BlitzyUserInfoService({ discovery });
      const info = await service.getUserInfo(credentials);

      expect((info as { email?: string }).email).toBe('dan@blitzy.com');
    });
  });

  describe('input validation', () => {
    it('throws when principal type is not "user"', async () => {
      const token = await createToken({ sub: 'user:default/alex' });
      const credentials = {
        $$type: '@backstage/BackstageCredentials',
        version: 'v1',
        token,
        principal: { type: 'service', subject: 'plugin:catalog' },
      } as unknown as BackstageCredentials<BackstageUserPrincipal>;

      const service = new BlitzyUserInfoService({ discovery });
      await expect(service.getUserInfo(credentials)).rejects.toThrow(
        'Only user credentials are supported',
      );
    });

    it('throws when credentials have no token', async () => {
      const credentials = {
        $$type: '@backstage/BackstageCredentials',
        version: 'v1',
        // no token property
        principal: {
          type: 'user',
          userEntityRef: 'user:default/alex',
        },
      } as unknown as BackstageCredentials<BackstageUserPrincipal>;

      const service = new BlitzyUserInfoService({ discovery });
      await expect(service.getUserInfo(credentials)).rejects.toThrow(
        'User credentials is unexpectedly missing token',
      );
    });

    it('throws when credentials.token is empty', async () => {
      const credentials = makeCredentials({
        userEntityRef: 'user:default/alex',
        token: '',
      });

      const service = new BlitzyUserInfoService({ discovery });
      await expect(service.getUserInfo(credentials)).rejects.toThrow(
        'User credentials is unexpectedly missing token',
      );
    });

    it('throws a descriptive error on malformed JWT', async () => {
      const credentials = makeCredentials({
        userEntityRef: 'user:default/alex',
        token: 'not-a-valid-jwt',
      });

      const service = new BlitzyUserInfoService({ discovery });
      await expect(service.getUserInfo(credentials)).rejects.toThrow(
        /Failed to decode user credentials token/,
      );
    });

    it('throws when token has no `sub` claim', async () => {
      const token = await createToken({
        // no sub
        ent: ['user:default/alex'],
        email: 'alex@blitzy.com',
      });
      const credentials = makeCredentials({
        userEntityRef: 'user:default/alex',
        token,
      });

      const service = new BlitzyUserInfoService({ discovery });
      await expect(service.getUserInfo(credentials)).rejects.toThrow(
        'User entity ref must be a non-empty string',
      );
    });
  });

  describe('forward compatibility: integration with the BlitzyPermissionPolicy', () => {
    it('produces an info object that the policy can structurally cast', async () => {
      // This test asserts the contract between the user-info service
      // and the BlitzyPermissionPolicy.extractEmail() helper. The
      // policy uses `(user.info as { email?: string }).email` — so the
      // returned object MUST expose `email` as a top-level property.
      const token = await createToken({
        sub: 'user:default/alex',
        ent: ['user:default/alex'],
        email: 'alex@blitzy.com',
      });
      const credentials = makeCredentials({
        userEntityRef: 'user:default/alex',
        token,
      });

      const service = new BlitzyUserInfoService({ discovery });
      const info = await service.getUserInfo(credentials);

      // The policy's structural cast pattern.
      const email = (info as { email?: string }).email;
      expect(email).toBe('alex@blitzy.com');
    });
  });
});
