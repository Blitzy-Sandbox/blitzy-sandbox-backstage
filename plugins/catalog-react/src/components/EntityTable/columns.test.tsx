/*
 * Copyright 2025 The Backstage Authors
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
import { columnFactories } from './columns';

describe('columns (EntityTable column factories)', () => {
  // AAP §0.1.2 / §0.6.1.2 — Owner and System affordances are fully removed
  // from the application. The corresponding column factories MUST NOT be
  // exported from this module, so that any consumer that previously called
  // them now fails fast at type-check / runtime rather than silently
  // resurrecting the removed UI surface.
  it('does not export a createOwnerColumn factory', () => {
    expect(
      (columnFactories as unknown as Record<string, unknown>).createOwnerColumn,
    ).toBeUndefined();
  });

  it('does not export a createSystemColumn factory', () => {
    expect(
      (columnFactories as unknown as Record<string, unknown>)
        .createSystemColumn,
    ).toBeUndefined();
  });

  it('still exports the remaining canonical column factories', () => {
    expect(typeof columnFactories.createEntityRefColumn).toBe('function');
    expect(typeof columnFactories.createEntityRelationColumn).toBe('function');
    expect(typeof columnFactories.createDomainColumn).toBe('function');
    expect(typeof columnFactories.createMetadataDescriptionColumn).toBe(
      'function',
    );
    expect(typeof columnFactories.createSpecLifecycleColumn).toBe('function');
    expect(typeof columnFactories.createSpecTypeColumn).toBe('function');
  });
});
