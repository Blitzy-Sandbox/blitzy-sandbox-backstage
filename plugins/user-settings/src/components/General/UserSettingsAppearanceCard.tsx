/*
 * Copyright 2021 The Backstage Authors
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

import { InfoCard } from '@backstage/core-components';
import { UserSettingsThemeToggle } from './UserSettingsThemeToggle';
import { UserSettingsLanguageToggle } from './UserSettingsLanguageToggle';
import { useTranslationRef } from '@backstage/frontend-plugin-api';
import { userSettingsTranslationRef } from '../../translation';

/** @public */
export const UserSettingsAppearanceCard = () => {
  const { t } = useTranslationRef(userSettingsTranslationRef);

  // QA finding F3 (CP7) — the `<UserSettingsPinToggle />` (and its
  // surrounding `!isMobile` guard from `useSidebarPinState`) has been
  // removed from this card. The toggle controlled whether the sidebar
  // remained pinned open, but the sidebar itself has been fully removed
  // per AAP §0.5.1.1 ("Sidebar removed; replaced with a top-bar
  // layout"). Continuing to surface a setting that has no observable
  // effect creates confusion and noise for users — particularly for
  // screen-reader users who would hear the option announced. The
  // `UserSettingsPinToggle` component still exists in this folder for
  // any downstream fork that re-introduces a sidebar; it is simply no
  // longer composed into the canonical Appearance card.
  return (
    <InfoCard title={t('appearanceCard.title')} variant="gridItem">
      <div className="space-y-1">
        <UserSettingsThemeToggle />
        <UserSettingsLanguageToggle />
      </div>
    </InfoCard>
  );
};
