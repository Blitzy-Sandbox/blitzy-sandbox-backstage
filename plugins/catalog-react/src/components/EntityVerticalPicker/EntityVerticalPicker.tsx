/*
 * Copyright 2026 The Backstage Authors
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

import { cn } from '@backstage/core-components';
import { EntityVerticalFilter } from '../../filters';
import { EntityAutocompletePicker } from '../EntityAutocompletePicker';

/**
 * Multi-select filter picker that surfaces the distinct
 * `blitzy.com/vertical` label values across the currently-listed entities
 * and lets the user narrow the catalog to one or more industry verticals.
 *
 * @public
 */
export const EntityVerticalPicker = (props: {
  initialFilter?: string[];
  inline?: boolean;
}) => {
  const { initialFilter = [], inline } = props;
  return (
    <EntityAutocompletePicker
      label="Vertical"
      name="vertical"
      path="metadata.labels.blitzy.com/vertical"
      Filter={EntityVerticalFilter}
      InputProps={{ className: cn() }}
      initialSelectedOptions={initialFilter}
      inline={inline}
    />
  );
};
