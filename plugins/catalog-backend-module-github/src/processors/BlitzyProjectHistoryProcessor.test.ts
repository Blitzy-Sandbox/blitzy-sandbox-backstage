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

import { Entity } from '@backstage/catalog-model';
import {
  CatalogProcessorCache,
  LocationSpec,
} from '@backstage/plugin-catalog-node';
import { mockServices } from '@backstage/backend-test-utils';
import {
  BlitzyProjectHistoryProcessor,
  HAS_PROJECT_HISTORY_ANNOTATION,
} from './BlitzyProjectHistoryProcessor';
import { OctokitProviderService } from '../util/octokitProviderService';

const LOCATION: LocationSpec = {
  type: 'url',
  target: 'https://github.com/org/repo/blob/main/catalog-info.yaml',
};

function makeCache(
  initial: Record<string, unknown> = {},
): CatalogProcessorCache {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    async get(key: string) {
      return store.get(key) as any;
    },
    async set(key: string, value: unknown) {
      store.set(key, value);
    },
  };
}

function makeOctokitProvider(prsListImpl: jest.Mock): OctokitProviderService {
  return {
    getOctokit: jest.fn().mockResolvedValue({
      rest: {
        pulls: {
          list: prsListImpl,
        },
      },
    }),
  };
}

function component(annotations?: Record<string, string>): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: 'svc',
      ...(annotations ? { annotations } : {}),
    },
  };
}

describe('BlitzyProjectHistoryProcessor', () => {
  const logger = mockServices.logger.mock();
  const noop = jest.fn();

  it('skips entities that are not Components', async () => {
    const provider = makeOctokitProvider(jest.fn());
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const group: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Group',
      metadata: { name: 'team' },
    };
    const out = await processor.postProcessEntity(
      group,
      LOCATION,
      noop,
      makeCache(),
    );
    expect(out).toBe(group);
    expect(provider.getOctokit).not.toHaveBeenCalled();
  });

  it('stamps false when the entity has no project-slug annotation', async () => {
    const provider = makeOctokitProvider(jest.fn());
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const out = await processor.postProcessEntity(
      component(),
      LOCATION,
      noop,
      makeCache(),
    );
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'false',
    );
    expect(provider.getOctokit).not.toHaveBeenCalled();
  });

  it('preserves an explicit pre-stamp of "true" when no slug is present', async () => {
    // Regression: E2E seed catalog fixtures
    // (`packages/app/e2e-tests/fixtures/e2e-seed-catalog.yaml`)
    // declare `blitzy.io/has-project-history: 'true'` without
    // declaring a `github.com/project-slug`. The processor must
    // honor the explicit declaration so the fixtures are visible in
    // the catalog UI under `EntityHasProjectHistoryFilter(true)`,
    // rather than overwriting the pre-stamp with `'false'`.
    const provider = makeOctokitProvider(jest.fn());
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const input = component({
      [HAS_PROJECT_HISTORY_ANNOTATION]: 'true',
    });
    const out = await processor.postProcessEntity(
      input,
      LOCATION,
      noop,
      makeCache(),
    );
    // The entity is returned unchanged (same object identity, same value).
    expect(out).toBe(input);
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'true',
    );
    expect(provider.getOctokit).not.toHaveBeenCalled();
  });

  it('preserves an explicit pre-stamp of "false" when no slug is present', async () => {
    // Symmetric guarantee: an entity explicitly declaring it has no
    // project history must NOT be re-stamped, since the value is
    // already correct. This also documents that the only path that
    // produces the same observable outcome (annotation === 'false')
    // does not unnecessarily mutate the entity.
    const provider = makeOctokitProvider(jest.fn());
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const input = component({
      [HAS_PROJECT_HISTORY_ANNOTATION]: 'false',
    });
    const out = await processor.postProcessEntity(
      input,
      LOCATION,
      noop,
      makeCache(),
    );
    expect(out).toBe(input);
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'false',
    );
    expect(provider.getOctokit).not.toHaveBeenCalled();
  });

  it('stamps false when no slug is present and the pre-stamp is invalid', async () => {
    // Defensive: anything other than the canonical literal strings
    // `'true'` or `'false'` is treated as no pre-stamp and the
    // default `'false'` is applied. This prevents typo'd or
    // accidentally truthy values (e.g. `'TRUE'`, `'yes'`,
    // `'maybe'`) from leaking into the catalog UI.
    const provider = makeOctokitProvider(jest.fn());
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const out = await processor.postProcessEntity(
      component({
        [HAS_PROJECT_HISTORY_ANNOTATION]: 'maybe',
      }),
      LOCATION,
      noop,
      makeCache(),
    );
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'false',
    );
    expect(provider.getOctokit).not.toHaveBeenCalled();
  });

  it('stamps false when the slug is malformed', async () => {
    const provider = makeOctokitProvider(jest.fn());
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const out = await processor.postProcessEntity(
      component({ 'github.com/project-slug': 'no-slash' }),
      LOCATION,
      noop,
      makeCache(),
    );
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'false',
    );
    expect(provider.getOctokit).not.toHaveBeenCalled();
  });

  it('stamps true when the repo has a PR on a blitzy-* head branch', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [
        {
          number: 1,
          head: { ref: 'blitzy-abc-123' },
          user: { login: 'someone-else' },
        },
      ],
    });
    const provider = makeOctokitProvider(list);
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const out = await processor.postProcessEntity(
      component({ 'github.com/project-slug': 'org/repo' }),
      LOCATION,
      noop,
      makeCache(),
    );
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'true',
    );
    expect(list).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      state: 'all',
      per_page: 100,
    });
  });

  it('stamps true when a PR is authored by blitzy[bot] even without the branch prefix', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [
        {
          number: 1,
          head: { ref: 'some-other-branch' },
          user: { login: 'blitzy[bot]' },
        },
      ],
    });
    const provider = makeOctokitProvider(list);
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const out = await processor.postProcessEntity(
      component({ 'github.com/project-slug': 'org/repo' }),
      LOCATION,
      noop,
      makeCache(),
    );
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'true',
    );
  });

  it('stamps false when the repo only has non-Blitzy PRs', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [
        {
          number: 1,
          head: { ref: 'feat/something' },
          user: { login: 'ajay-blitzy' },
        },
        {
          number: 2,
          head: { ref: 'dependabot/npm_and_yarn/foo' },
          user: { login: 'dependabot[bot]' },
        },
      ],
    });
    const provider = makeOctokitProvider(list);
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const out = await processor.postProcessEntity(
      component({ 'github.com/project-slug': 'org/repo' }),
      LOCATION,
      noop,
      makeCache(),
    );
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'false',
    );
  });

  it('stamps false when the repo has zero PRs', async () => {
    const list = jest.fn().mockResolvedValue({ data: [] });
    const provider = makeOctokitProvider(list);
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const out = await processor.postProcessEntity(
      component({ 'github.com/project-slug': 'org/repo' }),
      LOCATION,
      noop,
      makeCache(),
    );
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'false',
    );
  });

  it('preserves the prior annotation on GitHub errors', async () => {
    const list = jest.fn().mockRejectedValue(new Error('rate limited'));
    const provider = makeOctokitProvider(list);
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const input = component({
      'github.com/project-slug': 'org/repo',
      [HAS_PROJECT_HISTORY_ANNOTATION]: 'true',
    });
    const out = await processor.postProcessEntity(
      input,
      LOCATION,
      noop,
      makeCache(),
    );
    expect(out).toBe(input);
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'true',
    );
  });

  it('reuses a fresh cache entry without calling GitHub', async () => {
    const list = jest.fn();
    const provider = makeOctokitProvider(list);
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const cache = makeCache({
      'blitzy-project-history-v2': {
        slug: 'org/repo',
        value: 'true',
        checkedAt: new Date().toISOString(),
      },
    });
    const out = await processor.postProcessEntity(
      component({ 'github.com/project-slug': 'org/repo' }),
      LOCATION,
      noop,
      cache,
    );
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'true',
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('ignores a stale cache entry', async () => {
    const list = jest.fn().mockResolvedValue({ data: [] });
    const provider = makeOctokitProvider(list);
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const stale = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const cache = makeCache({
      'blitzy-project-history-v2': {
        slug: 'org/repo',
        value: 'true',
        checkedAt: stale,
      },
    });
    const out = await processor.postProcessEntity(
      component({ 'github.com/project-slug': 'org/repo' }),
      LOCATION,
      noop,
      cache,
    );
    expect(list).toHaveBeenCalled();
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'false',
    );
  });

  it('invalidates the cache when the slug changes', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [
        {
          number: 1,
          head: { ref: 'blitzy-xyz' },
          user: { login: 'blitzy[bot]' },
        },
      ],
    });
    const provider = makeOctokitProvider(list);
    const processor = new BlitzyProjectHistoryProcessor({
      octokitProvider: provider,
      logger,
    });
    const cache = makeCache({
      'blitzy-project-history-v2': {
        slug: 'old-org/old-repo',
        value: 'false',
        checkedAt: new Date().toISOString(),
      },
    });
    const out = await processor.postProcessEntity(
      component({ 'github.com/project-slug': 'org/repo' }),
      LOCATION,
      noop,
      cache,
    );
    expect(list).toHaveBeenCalled();
    expect(out.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION]).toBe(
      'true',
    );
  });
});
