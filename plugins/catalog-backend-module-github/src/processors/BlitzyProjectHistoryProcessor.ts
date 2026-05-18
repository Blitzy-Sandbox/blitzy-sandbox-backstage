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
import { LoggerService } from '@backstage/backend-plugin-api';
import {
  CatalogProcessor,
  CatalogProcessorCache,
  CatalogProcessorEmit,
  LocationSpec,
} from '@backstage/plugin-catalog-node';
import { OctokitProviderService } from '../util/octokitProviderService';

/**
 * Annotation stamped onto Component entities to indicate whether the linked
 * GitHub repo has any pull request history. Filtered against in the catalog
 * UI to hide entities with no project history.
 *
 * Values:
 *  - `'true'`  — at least one PR exists (any state)
 *  - `'false'` — the entity has no `github.com/project-slug` annotation, OR
 *                the linked repo returned zero PRs
 *  - missing   — the processor has not yet run for this entity (filter
 *                shows the entity through during this transient state)
 */
export const HAS_PROJECT_HISTORY_ANNOTATION = 'blitzy.io/has-project-history';

const SLUG_ANNOTATION = 'github.com/project-slug';

/** Cache entry shape persisted between processor runs. */
type CacheEntry = {
  /** ISO timestamp of when this value was observed. */
  checkedAt: string;
  /** The slug at the time of the check — invalidates cache when slug changes. */
  slug: string;
  /** Stamped annotation value. */
  value: 'true' | 'false';
};

const CACHE_KEY = 'blitzy-project-history';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Post-processes Component entities to stamp a `blitzy.io/has-project-history`
 * annotation based on whether the entity's linked GitHub repository has any
 * pull requests.
 *
 * Powers the catalog UI filter that hides entities with no project history.
 *
 * @public
 */
export class BlitzyProjectHistoryProcessor implements CatalogProcessor {
  readonly #octokitProvider: OctokitProviderService;
  readonly #logger: LoggerService;

  constructor(options: {
    octokitProvider: OctokitProviderService;
    logger: LoggerService;
  }) {
    this.#octokitProvider = options.octokitProvider;
    this.#logger = options.logger;
  }

  getProcessorName(): string {
    return 'BlitzyProjectHistoryProcessor';
  }

  async postProcessEntity(
    entity: Entity,
    _location: LocationSpec,
    _emit: CatalogProcessorEmit,
    cache: CatalogProcessorCache,
  ): Promise<Entity> {
    if (entity.kind !== 'Component') {
      return entity;
    }

    const slug = entity.metadata.annotations?.[SLUG_ANNOTATION];

    // No slug → definitively no history.
    if (!slug) {
      return stamp(entity, 'false');
    }

    // Cache hit (same slug, fresh) → reuse without hitting GitHub.
    const cached = await cache.get<CacheEntry>(CACHE_KEY);
    if (
      cached &&
      cached.slug === slug &&
      Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS
    ) {
      return stamp(entity, cached.value);
    }

    const [owner, repo] = slug.split('/');
    if (!owner || !repo) {
      // Malformed slug — treat as no history rather than calling GitHub.
      return stamp(entity, 'false');
    }

    let value: 'true' | 'false';
    try {
      const octokit = await this.#octokitProvider.getOctokit(
        `https://github.com/${owner}/${repo}`,
      );
      const response = await octokit.rest.pulls.list({
        owner,
        repo,
        state: 'all',
        per_page: 1,
      });
      value = response.data.length > 0 ? 'true' : 'false';
    } catch (error) {
      // Don't overwrite a previously-stamped annotation on transient
      // GitHub failures (rate limits, 5xx, network). Keep what the entity
      // already had — including `undefined`, in which case the filter
      // will show the entity through.
      this.#logger.warn(
        `BlitzyProjectHistoryProcessor: failed to check PRs for ${slug}`,
        error as Error,
      );
      return entity;
    }

    await cache.set<CacheEntry>(CACHE_KEY, {
      checkedAt: new Date().toISOString(),
      slug,
      value,
    });

    return stamp(entity, value);
  }
}

function stamp(entity: Entity, value: 'true' | 'false'): Entity {
  return {
    ...entity,
    metadata: {
      ...entity.metadata,
      annotations: {
        ...entity.metadata.annotations,
        [HAS_PROJECT_HISTORY_ANNOTATION]: value,
      },
    },
  };
}
