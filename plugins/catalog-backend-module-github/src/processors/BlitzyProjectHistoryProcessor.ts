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
 * GitHub repo has any Blitzy-authored pull requests. Filtered against in the
 * catalog UI to hide entities with no Blitzy run history.
 *
 * A PR counts as a Blitzy run if EITHER:
 *   - its head branch ref starts with `blitzy-` (the bot's UUID-suffixed
 *     branch convention, e.g. `blitzy-<uuid>`), OR
 *   - its author login is `blitzy[bot]` (the GitHub App account, used as
 *     a fallback so a rename of the branch convention doesn't break us).
 *
 * Values:
 *  - `'true'`  — at least one Blitzy-authored PR exists (any state)
 *  - `'false'` — the entity has no `github.com/project-slug` annotation, OR
 *                the linked repo has zero Blitzy-authored PRs in the most
 *                recent page (see PR_PAGE_SIZE)
 *  - missing   — the processor has not yet run for this entity (filter
 *                shows the entity through during this transient state)
 */
export const HAS_PROJECT_HISTORY_ANNOTATION = 'blitzy.io/has-project-history';

const SLUG_ANNOTATION = 'github.com/project-slug';
const BLITZY_BRANCH_PREFIX = 'blitzy-';
const BLITZY_BOT_LOGIN = 'blitzy[bot]';

// Only the most recent N PRs are scanned. If a repo has more than N
// non-Blitzy PRs in front of its first Blitzy PR, that PR will be missed
// and the entity will be hidden. Today's most active repo has ~20 PRs, so
// 100 has plenty of headroom; revisit if that changes.
const PR_PAGE_SIZE = 100;

/** Cache entry shape persisted between processor runs. */
type CacheEntry = {
  /** ISO timestamp of when this value was observed. */
  checkedAt: string;
  /** The slug at the time of the check — invalidates cache when slug changes. */
  slug: string;
  /** Stamped annotation value. */
  value: 'true' | 'false';
};

// Bumped from `blitzy-project-history` when the stamping logic narrowed
// from "any PR" to "Blitzy-authored PRs only" — old entries would have
// served stale `'true'` stamps until the 6h TTL elapsed.
const CACHE_KEY = 'blitzy-project-history-v2';
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

    // No slug → there is no GitHub repository to consult. In the common
    // case (production entities, manually-registered components without
    // a slug), the entity has no project history and we stamp `'false'`.
    //
    // However, an entity may declare its project-history status
    // explicitly in source — for example, the deterministic catalog
    // seed used by the E2E suite at
    // `packages/app/e2e-tests/fixtures/e2e-seed-catalog.yaml` requires
    // its `blitzy-e2e-component-*` fixtures to be visible in the catalog
    // UI in order to exercise tag-AND filtering, View-button removal,
    // and library-chip-border assertions. Without honoring the explicit
    // declaration, those fixtures would be filtered out by the default
    // `EntityHasProjectHistoryFilter(true)` mounted in
    // `DefaultCatalogPage.tsx`, silently breaking every refactor.test.ts
    // assertion that depends on seed entities being rendered. When the
    // entity comes pre-stamped, that explicit value is the source of
    // truth and we return the entity unchanged.
    if (!slug) {
      const preStamped =
        entity.metadata.annotations?.[HAS_PROJECT_HISTORY_ANNOTATION];
      if (preStamped === 'true' || preStamped === 'false') {
        return entity;
      }
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
        per_page: PR_PAGE_SIZE,
      });
      value = response.data.some(isBlitzyPr) ? 'true' : 'false';
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

type PrSummary = {
  head?: { ref?: string | null } | null;
  user?: { login?: string | null } | null;
};

function isBlitzyPr(pr: PrSummary): boolean {
  return (
    pr.head?.ref?.startsWith(BLITZY_BRANCH_PREFIX) === true ||
    pr.user?.login === BLITZY_BOT_LOGIN
  );
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
