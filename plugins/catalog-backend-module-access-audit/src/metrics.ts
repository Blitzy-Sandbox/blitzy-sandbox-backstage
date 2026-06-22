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

import { Counter, metrics } from '@opentelemetry/api';

const METER_NAME = 'blitzy-catalog-access-audit';

/**
 * Counter recording every catalog single-entity read observed by the
 * access-audit middleware.
 *
 * Label set:
 * - `action` — Fixed to `"read"`. The middleware only audits GET
 *   single-entity reads, so the label is constant by design; declaring
 *   it explicitly keeps the metric forward-compatible if a future
 *   `entity-write` counter is added alongside.
 */
export const entityAccessTotal: Counter = metrics
  .getMeter(METER_NAME)
  .createCounter('entity_access_total', {
    description:
      'Catalog single-entity reads recorded by the access-audit middleware.',
  });
