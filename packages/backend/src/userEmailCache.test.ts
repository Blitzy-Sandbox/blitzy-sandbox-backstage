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
  _testOnlyCacheSize,
  _testOnlyClearUserEmailCache,
  _testOnlyMaxCacheEntries,
  cacheUserEmail,
  lookupUserEmail,
} from './userEmailCache';

describe('userEmailCache', () => {
  beforeEach(() => {
    _testOnlyClearUserEmailCache();
  });

  describe('cacheUserEmail / lookupUserEmail (happy path)', () => {
    it('returns undefined for a never-cached user', () => {
      expect(lookupUserEmail('user:default/alex')).toBeUndefined();
    });

    it('returns the cached email after a single write', () => {
      cacheUserEmail('user:default/alex', 'alex@blitzy.com');
      expect(lookupUserEmail('user:default/alex')).toBe('alex@blitzy.com');
    });

    it('overwrites the previous entry when called twice with the same ref', () => {
      cacheUserEmail('user:default/alex', 'alex@example.com');
      cacheUserEmail('user:default/alex', 'alex@blitzy.com');
      expect(lookupUserEmail('user:default/alex')).toBe('alex@blitzy.com');
      // Cache size stays at 1 — the duplicate ref does not create a
      // second entry.
      expect(_testOnlyCacheSize()).toBe(1);
    });

    it('stores entries for multiple distinct users independently', () => {
      cacheUserEmail('user:default/alex', 'alex@blitzy.com');
      cacheUserEmail('user:default/bob', 'bob@example.com');
      cacheUserEmail('user:default/cara', 'cara@blitzy.com');
      expect(lookupUserEmail('user:default/alex')).toBe('alex@blitzy.com');
      expect(lookupUserEmail('user:default/bob')).toBe('bob@example.com');
      expect(lookupUserEmail('user:default/cara')).toBe('cara@blitzy.com');
      expect(_testOnlyCacheSize()).toBe(3);
    });
  });

  describe('input validation', () => {
    it('no-ops on empty userEntityRef', () => {
      cacheUserEmail('', 'alex@blitzy.com');
      expect(_testOnlyCacheSize()).toBe(0);
    });

    it('no-ops on empty email', () => {
      cacheUserEmail('user:default/alex', '');
      expect(_testOnlyCacheSize()).toBe(0);
    });

    it('returns undefined for empty lookup ref', () => {
      cacheUserEmail('user:default/alex', 'alex@blitzy.com');
      expect(lookupUserEmail('')).toBeUndefined();
    });

    it('returns undefined for undefined lookup ref', () => {
      expect(lookupUserEmail(undefined)).toBeUndefined();
    });

    it('no-ops when userEntityRef is not a string (defensive)', () => {
      cacheUserEmail(undefined as unknown as string, 'alex@blitzy.com');
      cacheUserEmail(123 as unknown as string, 'alex@blitzy.com');
      cacheUserEmail(null as unknown as string, 'alex@blitzy.com');
      expect(_testOnlyCacheSize()).toBe(0);
    });

    it('no-ops when email is not a string (defensive)', () => {
      cacheUserEmail('user:default/alex', undefined as unknown as string);
      cacheUserEmail('user:default/alex', 123 as unknown as string);
      cacheUserEmail('user:default/alex', null as unknown as string);
      expect(_testOnlyCacheSize()).toBe(0);
    });
  });

  describe('FIFO eviction', () => {
    it('does not evict until capacity is reached', () => {
      // Insert (MAX - 1) entries — cache has spare capacity.
      const max = _testOnlyMaxCacheEntries;
      for (let i = 0; i < max - 1; i++) {
        cacheUserEmail(`user:default/u${i}`, `u${i}@blitzy.com`);
      }
      expect(_testOnlyCacheSize()).toBe(max - 1);
      // The first entry is still present.
      expect(lookupUserEmail('user:default/u0')).toBe('u0@blitzy.com');
    });

    it('evicts the OLDEST entry when at capacity', () => {
      // Use a smaller working set than MAX so the test is fast, but
      // still exercise the boundary by mocking the cap. Since the cap
      // is a module-scoped const, we exercise the boundary directly
      // by writing MAX + 1 entries.
      const max = _testOnlyMaxCacheEntries;
      for (let i = 0; i < max; i++) {
        cacheUserEmail(`user:default/u${i}`, `u${i}@blitzy.com`);
      }
      expect(_testOnlyCacheSize()).toBe(max);
      // The first entry is still present.
      expect(lookupUserEmail('user:default/u0')).toBe('u0@blitzy.com');

      // Insert one MORE entry — this should evict the oldest (u0).
      cacheUserEmail('user:default/newest', 'newest@blitzy.com');
      expect(_testOnlyCacheSize()).toBe(max);
      expect(lookupUserEmail('user:default/u0')).toBeUndefined();
      expect(lookupUserEmail('user:default/newest')).toBe('newest@blitzy.com');
    });

    it('re-inserting the same user updates the FIFO position (does not get evicted)', () => {
      const max = _testOnlyMaxCacheEntries;
      // Insert MAX entries.
      for (let i = 0; i < max; i++) {
        cacheUserEmail(`user:default/u${i}`, `u${i}@blitzy.com`);
      }
      // Re-insert user u0 — this should move it to the newest position.
      cacheUserEmail('user:default/u0', 'u0-updated@blitzy.com');
      expect(_testOnlyCacheSize()).toBe(max);

      // Insert one MORE entry — this should now evict u1 (the new
      // oldest), NOT u0 (which was just refreshed).
      cacheUserEmail('user:default/newest', 'newest@blitzy.com');
      expect(_testOnlyCacheSize()).toBe(max);
      expect(lookupUserEmail('user:default/u0')).toBe('u0-updated@blitzy.com');
      expect(lookupUserEmail('user:default/u1')).toBeUndefined();
      expect(lookupUserEmail('user:default/newest')).toBe('newest@blitzy.com');
    });
  });

  describe('_testOnlyClearUserEmailCache', () => {
    it('removes all entries', () => {
      cacheUserEmail('user:default/alex', 'alex@blitzy.com');
      cacheUserEmail('user:default/bob', 'bob@example.com');
      _testOnlyClearUserEmailCache();
      expect(_testOnlyCacheSize()).toBe(0);
      expect(lookupUserEmail('user:default/alex')).toBeUndefined();
    });
  });
});
