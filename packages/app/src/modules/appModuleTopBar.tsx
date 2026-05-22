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

import type { CSSProperties } from 'react';
import appPlugin from '@backstage/plugin-app';
import { Link, SupportButton } from '@backstage/core-components';
import {
  coreExtensionData,
  createFrontendModule,
} from '@backstage/frontend-plugin-api';
import { NavContentBlueprint } from '@backstage/plugin-app-react';
import { UserSettingsSignInAvatar } from '@backstage/plugin-user-settings';
import { Settings as SettingsIcon } from 'lucide-react';

/**
 * `BlitzyLogo` renders the Blitzy brand mark as a non-interactive inline SVG.
 *
 * Per the Agent Action Plan (AAP) Section 0.5.4, the logo MUST be image-only:
 * no link wrapper, no click handler, no hover affordance, no `tabIndex`. It is
 * intentionally rendered as a plain `<div>` containing the SVG so that screen
 * readers announce it as a graphic (`role="img"` + `aria-label="Blitzy"`)
 * rather than as a focusable navigation control.
 *
 * The SVG markup (viewBox "0 0 151 57") is the OPEN/full variant extracted
 * verbatim from the legacy `appModuleNav.tsx` `SidebarLogo` to guarantee
 * pixel-identical brand presentation.
 */
const BlitzyLogo = () => (
  <div className="inline-flex items-center" data-testid="app-top-bar-logo">
    <svg
      style={{ width: 'auto', height: 30 } as CSSProperties}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 151 57"
      fill="none"
      role="img"
      aria-label="Blitzy"
      focusable="false"
    >
      <path
        d="M56.7604 13.175H68.4708C70.3297 13.175 71.9395 13.4744 73.2973 14.0703C74.6551 14.6691 75.6898 15.5141 76.4043 16.6051C77.1158 17.699 77.4745 18.9709 77.4745 20.4235C77.4745 21.8762 77.1691 23.0621 76.5584 24.1412C75.9477 25.2204 75.0939 26.0594 74.0029 26.6553C72.9089 27.2541 71.6638 27.5595 70.2674 27.5713L70.3089 26.7768C71.9246 26.8035 73.3477 27.1415 74.5751 27.7848C75.8024 28.4281 76.757 29.3146 77.4359 30.4411C78.1149 31.5677 78.4528 32.8455 78.4528 34.2685C78.4528 35.8991 78.0882 37.3221 77.3648 38.5436C76.6385 39.765 75.5979 40.7078 74.24 41.3748C72.8822 42.0389 71.2724 42.3739 69.4136 42.3739H56.7693V13.175H56.7604ZM60.8339 37.9981H68.0825C69.6834 37.9981 70.9048 37.6304 71.7468 36.8982C72.5887 36.1659 73.0097 35.0986 73.0097 33.7023C73.0097 32.386 72.6065 31.375 71.7972 30.6694C70.9878 29.9638 69.8316 29.611 68.3255 29.611H61.3201V25.2737H67.7356C69.1052 25.2737 70.1755 24.9209 70.9433 24.2154C71.7112 23.5098 72.0936 22.5047 72.0936 21.2003C72.0936 20.047 71.6993 19.1517 70.9137 18.5113C70.1251 17.8739 69.0815 17.5538 67.7771 17.5538H60.7716L62.076 16.7177V39.0564L60.8339 37.9981Z"
        fill="#FFFFFF"
      />
      <path
        d="M80.3621 13.175H85.5354V42.3769H80.3621V13.175Z"
        fill="#FFFFFF"
      />
      <path
        d="M88.2659 12.9911H93.8246V17.9599H88.2659V12.9911ZM88.4497 20.9957H93.623V42.3769H88.4497V20.9957Z"
        fill="#FFFFFF"
      />
      <path
        d="M102.054 42.1426C101.091 41.7276 100.344 41.0665 99.8132 40.1563C99.2825 39.2462 99.0187 38.0514 99.0187 36.5721V24.9862H95.3544V20.9957H95.802C96.7122 20.9957 97.4533 20.8564 98.0314 20.5777C98.6096 20.299 99.0424 19.8484 99.3359 19.2229C99.6264 18.5973 99.8014 17.7702 99.8547 16.7385L99.9555 14.6395H104.171V21.4197L103.519 20.9928H108.835V24.9832H104.171V36.0206C104.171 36.9456 104.403 37.6008 104.865 37.9951C105.327 38.3894 105.986 38.5851 106.839 38.5851C107.424 38.5851 107.966 38.5228 108.47 38.4012V42.3709C108.034 42.4925 107.575 42.5874 107.086 42.6555C106.596 42.7237 106.08 42.7563 105.538 42.7563C104.18 42.7563 103.021 42.5488 102.054 42.1367V42.1426Z"
        fill="#FFFFFF"
      />
      <path
        d="M110.954 38.3242L123.661 23.071V25.0455H110.934V20.9928H128.283V25.1047L115.312 40.4587V38.3005H128.65V42.3739H110.954V38.3212V38.3242Z"
        fill="#FFFFFF"
      />
      <path
        d="M132.774 50.3785C132.264 50.3103 131.793 50.2095 131.36 50.0731V45.635C131.713 45.7714 132.081 45.8692 132.46 45.9315C132.84 45.9937 133.219 46.0234 133.601 46.0234C134.322 46.0234 134.941 45.887 135.463 45.6172C135.985 45.3445 136.45 44.9087 136.86 44.3039C137.266 43.6991 137.666 42.869 138.06 41.8106L138.487 44.295L129.875 20.9987H135.454L141.582 39.5901H139.504L145.104 20.9987H150.5L142.804 43.2959C142.235 44.9531 141.556 46.305 140.767 47.3575C139.978 48.4099 139.062 49.1926 138.019 49.7085C136.972 50.2243 135.766 50.4822 134.393 50.4822C133.824 50.4822 133.284 50.4467 134.393 50.4822C133.824 50.4822 133.284 50.4467 132.774 50.3814V50.3785Z"
        fill="#FFFFFF"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.7786 13.1196C13.0094 11.8889 15.0047 11.8889 16.2354 13.1196L29.1347 26.0189C29.7257 26.6099 30.0577 27.4115 30.0577 28.2473C30.0577 29.0831 29.7257 29.8847 29.1347 30.4757L16.2354 43.3749C15.0047 44.6056 13.0094 44.6056 11.7786 43.3749C10.5479 42.1442 10.5479 40.1488 11.7786 38.9181L22.4495 28.2473L11.7786 17.5765C10.5479 16.3457 10.5479 14.3504 11.7786 13.1196Z"
        fill="#FFFFFF"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0.5 11.574C0.5 5.18199 5.68199 0 12.074 0H26.0257C38.2344 0 44.3511 14.7641 35.7162 23.399L34.0945 25.0207C32.8638 26.2514 30.8684 26.2514 29.6377 25.0207C28.407 23.79 28.407 21.7946 29.6377 20.5639L31.2594 18.9422C35.9239 14.2777 32.6189 6.30287 26.0257 6.30287H12.074C9.16297 6.30287 6.80287 8.66297 6.80287 11.574V44.9176C6.80287 47.8286 9.16297 50.1887 12.074 50.1887H26.0257C32.621 50.1887 35.9246 42.2146 31.2594 37.5494L29.6377 35.9277C28.407 34.697 28.407 32.7016 29.6377 31.4709C30.8684 30.2402 32.8638 30.2402 34.0945 31.4709L35.7162 33.0926C44.3505 41.7269 38.2383 56.4916 26.0257 56.4916H12.074C5.68199 56.4916 0.5 51.3096 0.5 44.9176V11.574Z"
        fill="#FFFFFF"
      />
    </svg>
  </div>
);

/**
 * `TopBarSignInAvatar` renders the signed-in user's profile chip.
 *
 * Restores the avatar that previously lived inside the deleted sidebar's
 * Settings group. The avatar is wrapped in a non-interactive container so
 * that it remains purely informational; the user reaches the Settings page
 * via the adjacent Settings icon button (`TopBarSettings`).
 */
const TopBarSignInAvatar = () => (
  <div
    className="inline-flex items-center"
    aria-label="Signed-in account"
    data-testid="app-top-bar-avatar"
  >
    <UserSettingsSignInAvatar size={28} />
  </div>
);

/**
 * Shared className for the icon-button affordances in the right cluster.
 * Centralized so that the visual treatment (padding, hover, focus ring)
 * stays in lockstep across Settings/Support — preventing one icon
 * from drifting visually from the others when the buttons are edited.
 *
 * The `hover:bg-white/10` rule provides a visible hover affordance on
 * the dark purple primary top-bar background (Issue #9). Pairs with
 * `hover:opacity-100` so the rule overrides the inherited `opacity-80`
 * shorthand if present.
 */
const ICON_BUTTON_CLASS =
  'inline-flex items-center justify-center p-2 rounded text-current no-underline transition-colors duration-150 hover:bg-white/10 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current';

const ICON_BUTTON_STYLE: CSSProperties = {
  color: 'inherit',
  // The Tailwind ring token is overridden inline so that the focus ring
  // is visible against the dark purple primary background even when the
  // theme has not pre-loaded the corresponding CSS variable.
  '--tw-ring-color': '#FFFFFF',
} as CSSProperties;

/**
 * `TopBarSettings` is the Settings icon button anchored in the top-bar's
 * right cluster.
 *
 * It links to the `/settings` route registered by `userSettingsPlugin`.
 * `@backstage/core-components` `Link` is preferred over `react-router-dom`
 * `Link` because it integrates with Backstage's analytics pipeline and
 * resolves the configured `app.baseUrl`. The visible content is icon-only,
 * so an `aria-label="Settings"` is required for assistive technology, and
 * the inner SVG is marked `aria-hidden` to avoid double-announcement.
 */
const TopBarSettings = () => (
  <Link
    to="/settings"
    aria-label="Settings"
    title="Settings"
    data-testid="app-top-bar-settings"
    className={ICON_BUTTON_CLASS}
    style={ICON_BUTTON_STYLE}
  >
    <SettingsIcon size={20} aria-hidden="true" focusable="false" />
  </Link>
);

/**
 * `TopBarSupport` renders the Backstage `SupportButton` configured globally
 * via `app.support.items` in `app-config.yaml`.
 *
 * `SupportButton` automatically reads the support items from configuration
 * and opens a popover listing each entry (GitHub Issues link, the
 * `support@blitzy.com` mailto link, etc.). This component performs no
 * configuration work — the `app-config.yaml` change is owned by another
 * file in this refactor.
 *
 * CP8 Issue #9 fix (QA finding F9): The wrapper carries the
 * `data-testid="app-top-bar-support"` attribute that anchors the hover
 * affordance defined in `packages/app/src/globals.css`. Without that
 * scoped rule, the upstream `Button variant="ghost"` defaults to
 * `hover:bg-accent/80` (light gray ~`#F5F5F5`), which is nearly invisible
 * against the dark navy top-bar primary background (`#1F5493`), as the
 * CP8 QA finding documented. The CSS rule provides a visible
 * `rgba(255,255,255,0.1)` overlay on hover with a 150ms transition.
 *
 * Implementation note: a plain CSS rule (rather than a Tailwind arbitrary-
 * descendant utility) is required here because `packages/app/src/tailwind.css`
 * is a pre-built CSS artifact in this repository — new Tailwind utility
 * classes added to source `.tsx` files are NOT re-scanned at app build time.
 */
const TopBarSupport = () => (
  <div className="inline-flex items-center" data-testid="app-top-bar-support">
    <SupportButton />
  </div>
);

/**
 * `TopBar` composes the five pieces of the new application chrome into a
 * single horizontal bar.
 *
 * Layout: a `<header>` element rendered in normal flow (NOT fixed-
 * positioned). It is anchored at the top of a flex-column page shell
 * (see `appModuleTopBar` below) so that page content naturally starts
 * below it without requiring `padding-top` on every page or any
 * SidebarPage-style left gutter.
 *
 * Right-cluster ordering (left-to-right): Logo, Avatar, Settings, Support.
 * All cluster children remain on the right via `justify-end`, satisfying
 * the AAP requirement to "Relocate the Blitzy logo to the top right
 * corner".
 *
 * Per AAP §0.5.4 the strict ordering is Logo → Settings → Support; the
 * SignInAvatar is retained as informational user-context for Guest UX
 * but is non-interactive. A Search icon is intentionally NOT mounted in
 * the top-bar (CP8 QA finding #2) — search is still reachable at
 * `/search` for users who navigate there directly, and the search
 * affordance is preserved inside the catalog page toolbar.
 *
 * Styling notes:
 * - The bar participates in normal document flow (no `position: fixed`)
 *   so that no page content is hidden beneath it. Backstage's `Header`
 *   component on individual pages renders below this top-bar in the
 *   flex-column layout.
 * - `z-index: 1100` matches the existing Backstage Sidebar's z-index so
 *   that any sticky/floating page chrome stays correctly stacked.
 * - `bg-primary text-primary-foreground` resolves to the Blitzy purple
 *   primary token (`#5B39F3` in light mode, `#7A6DEC` in dark) with white
 *   foreground — providing sufficient contrast for the white logo SVG and
 *   icons. An explicit `backgroundColor` style fallback guarantees the
 *   dark background even if Tailwind tokens are unavailable in a test
 *   env.
 */
/**
 * `SkipNavLink` is the visually-hidden "Skip to main content" link rendered
 * as the first focusable element of the application chrome.
 *
 * CP9 QA fix — Issue #12 (MAJOR, WCAG 2.1 AA SC 2.4.1 Bypass Blocks):
 *
 * Keyboard-only users can press Tab once on any page to reveal this link,
 * activate it with Enter, and jump past the entire top-bar cluster
 * (Logo/Avatar/Settings/Support) directly to the page's `<main>`
 * landmark. Without a skip link, keyboard users must Tab through every
 * top-bar control on every page navigation.
 *
 * Styling:
 *  - `className="sr-only"` keeps the link visually hidden but accessible
 *    to assistive technology while it does not have focus.
 *  - The companion CSS rule in `packages/app/src/globals.css` (selector
 *    `[data-testid="app-skip-nav"]:focus`) surfaces the link as a
 *    high-contrast pill in the top-left of the viewport when it receives
 *    keyboard focus. Inline `:focus` styling is required because this
 *    repo's Tailwind CSS is pre-built and `focus:not-sr-only` /
 *    `focus:absolute` utility classes are NOT compiled into the shipped
 *    stylesheet.
 *
 * Target: anchors at `href="#main-content"` which matches the `id` on the
 * `<main>` element rendered by the `app/layout` extension override below.
 */
const SkipNavLink = () => (
  <a href="#main-content" className="sr-only" data-testid="app-skip-nav">
    Skip to main content
  </a>
);

const TopBar = () => (
  <header
    className="relative flex w-full items-center justify-end gap-3 px-4 py-2 bg-primary text-primary-foreground shadow-sm z-[1100]"
    style={
      {
        minHeight: 56,
        // Fallback ensures a dark background even when Tailwind primary
        // tokens are not loaded (e.g., during isolated component tests).
        backgroundColor: 'var(--primary, #5B39F3)',
        color: 'var(--primary-foreground, #FFFFFF)',
        // The bar is flex-shrink: 0 so the flex-column shell does not
        // collapse it under tight viewport heights.
        flexShrink: 0,
      } as CSSProperties
    }
    data-testid="app-top-bar"
    role="banner"
  >
    <SkipNavLink />
    <BlitzyLogo />
    {/*
     * CP9 QA fix — Issue #10 (MAJOR, WCAG 2.4.1 Bypass Blocks):
     *
     * Wrap the interactive icon cluster in a `<nav>` landmark so that
     * assistive technology can identify it as a navigation region.
     * Previously the top-bar only carried `role="banner"` with no
     * navigation landmark, leaving the Settings link (the only
     * navigational anchor in the top-bar) ungrouped for screen
     * readers. `aria-label="Main"` distinguishes this navigation
     * region from any per-page `<nav>` (e.g. tabs) that the rendered
     * page content might also surface.
     */}
    <nav
      aria-label="Main"
      className="inline-flex items-center gap-2"
      data-testid="app-top-bar-nav"
    >
      <TopBarSignInAvatar />
      <TopBarSettings />
      <TopBarSupport />
    </nav>
  </header>
);

/**
 * `appModuleTopBar` is the new application chrome module that replaces the
 * deleted `appModuleNav` (sidebar) frontend module.
 *
 * It performs two coordinated changes:
 *
 *  1. Registers a `NavContentBlueprint` extension whose component is
 *     `TopBar`. The blueprint attaches at `app/nav#content`, which is the
 *     same extension slot the deleted sidebar used. This makes the
 *     module a drop-in chrome replacement for the slot — `appPlugin`'s
 *     `app/nav` extension forwards the rendered `TopBar` to the layout.
 *
 *  2. Overrides the upstream `app/layout` extension to replace its
 *     `<SidebarPage>` wrapper with a custom flex-column layout. This is
 *     the critical fix for the Checkpoint-3 review finding that the
 *     fixed-position top-bar was overlaying the first 56px of every
 *     page and leaving a residual sidebar-width left gutter (because
 *     `SidebarPage` always applies `paddingLeft: drawerWidthClosed` to
 *     the content even when no sidebar is present — see
 *     `packages/core-components/src/layout/Sidebar/Page.tsx` L110-117).
 *
 *     The replacement layout renders nav + content in a vertical flex
 *     column with `min-height: 100vh`. Nav (the rendered `TopBar`) sits
 *     at the top in normal flow; content sits below in a `flex: 1`
 *     region with no left gutter and no top padding. This guarantees
 *     that every page's first heading is fully visible immediately
 *     below the 56px top-bar.
 *
 * The blueprint factory receives `navItems` (a take/rest API over
 * app-wide navigation entries), but we intentionally do NOT consume them
 * in the TopBar component itself: the new chrome surfaces navigation
 * via icons (Logo/Search/Settings/Support) plus the catalog landing
 * page (`/` → `/catalog`) rather than inline link lists.
 *
 * @public
 */
export const appModuleTopBar = createFrontendModule({
  pluginId: 'app',
  extensions: [
    NavContentBlueprint.make({
      params: {
        component: () => <TopBar />,
      },
    }),
    appPlugin.getExtension('app/layout').override({
      // The override factory receives the original factory as its first
      // argument (unused — we replace the layout entirely) and the
      // extension context (including `inputs`) as the second. The
      // upstream `app/layout` declares `nav` and `content` as singleton
      // ReactElement inputs (see `plugins/app/src/extensions/AppLayout.tsx`),
      // and the override preserves those inputs by inheriting them from
      // the parent definition.
      factory: (_originalFactory, { inputs }) => [
        coreExtensionData.reactElement(
          <div
            data-testid="app-layout"
            className="flex flex-col min-h-screen w-full"
            style={
              {
                minHeight: '100vh',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
              } as CSSProperties
            }
          >
            {inputs.nav.get(coreExtensionData.reactElement)}
            {/*
             * CP9 QA fix — Issue #9 (MAJOR, WCAG 1.3.1 Info & Relationships):
             *
             * This wrapper was previously a `<main>` element, which
             * resulted in two NESTED `<main>` landmarks (the outer
             * layout wrapper plus the inner page's own `<main>` from
             * `Backstage`'s `Page` component). ARIA best practices and
             * WCAG specify exactly one `<main>` landmark per document.
             * Switching the outer wrapper to a `<div>` preserves the
             * flex column layout while ensuring the inner page's
             * `<main>` becomes the document's sole main landmark.
             *
             * CP9 QA fix — Issue #12 target:
             *
             * The `id="main-content"` anchor matches the
             * `href="#main-content"` skip-navigation link rendered by
             * `SkipNavLink` above. When the user activates the skip
             * link, focus and scroll move past the top-bar to this
             * element.
             */}
            <div
              id="main-content"
              data-testid="app-layout-content"
              className="flex flex-1 min-h-0"
              style={
                {
                  flex: '1 1 auto',
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                } as CSSProperties
              }
            >
              {inputs.content.get(coreExtensionData.reactElement)}
            </div>
          </div>,
        ),
      ],
    }),
  ],
});
