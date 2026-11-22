# UniTrack AUB frontend review

## Revisions

| Reference | SHA |
| --- | --- |
| Starting baseline, fetched `origin/main`, local `main`, and `backup/main-before-aub-theme` | `0061916ae7505a2e0b1c171d3b6d4757bc98fdee` |
| Initial AUB implementation | `d7b7cc1a10d2a1fdd71d29f5c340fa89a6174507` |
| Initial review evidence, direct child of the implementation | `f488fc86adb452edb812f3329bbe357efed5025e` |
| Focused Web implementation | `5039d63a02e17f465963502e8fa508ca8a95e015` |
| Review and screenshot update before the header menu | `082a53bbf4af0e22f6a080cfcb031ceaf4de2644` |

## Review findings

- The AUB workspace covers login, access denial, missing pages, dashboard, catalogue, lookup, scan, custody forms, and manager equipment, kits, categories, and roles. The catalogue retains its URL and uses Equipment’s name and asset-code search. On scan, asset-code lookup now comes before the scanner’s manual UUID fallback. Catalogue icons use known category names or the kit flag, with a generic icon for unknown categories.
- At 375 pixels on handover and return, the skip link is visually clipped until focused. Keyboard focus puts it in a row above the header. Enter moves focus to `main#main-content`, then the link is visually clipped again. The updated screenshots were captured after clearing focus.
- A single three-line Menu button opens the same role-aware navigation on desktop and mobile. The menu starts closed, and the layout uses the space formerly occupied by the sidebar. Forms retain readable maximum widths. Escape restores focus to Menu. Clicking outside or selecting a destination closes the overlay. Active links and dashboard shortcuts remain available.
- The original screenshot fixture saved the Loans result as `checked_out` but kept returning a static `reserved` Equipment snapshot. The handover UI used the snapshot for both labels. The fixture now advances its Equipment snapshot on successful checkout. The UI uses the validated confirmation or recovery response for “Equipment status at handover” and the Equipment read for “Current equipment status.” A focused regression passes through the Web gateway and service handlers with a deliberately different Equipment read. A reopened record shows its current status using the live Equipment read. The existing Loans service checks the checkout receipt and status before recording completion. The inconsistent screenshot established no backend defect.
- The header uses a smaller, proportional logo without a wrapper divider. The pale rectangle comes from opaque pixels in the supplied PNG, whose Git blob is identical to the initial implementation. Removing the rectangle requires a transparent original from the source.
- Run the real services with `npm run dev:all` and open `http://localhost:3000`. Next.js accepted the HMR upgrade with HTTP 101 on `localhost` and logged a development-origin denial for `127.0.0.1`. The real student dashboard hydrated on the documented hostname, and the synthetic signed-in browser suite also passed there in dev mode. Origin checks, authentication, and TLS settings are unchanged.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Final workspace scripts | PASS | `npm run typegen`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` exited 0. The default suite passed 915 tests and skipped 50 PostgreSQL cases. |
| Disposable PostgreSQL | PASS | Reused the prior standard harness result for unchanged services and schema. It ran the 50 cases, including all 10 status-guard and 26 handover tests. |
| Real services and existing browser session | PASS | After the header update, all four health endpoints returned HTTP 200, anonymous protected pages redirected, and the catalogue API returned 401. A 61.9-second development browser probe retained both login fields with zero reloads after a brief startup refresh burst. Earlier live student verification reached the dashboard and the Web and Loans return-problems endpoints returned HTTP 200. |
| Authenticated Chromium with synthetic upstreams | PASS | Desktop and mobile catalogue, clipped and focused skip link, correct skip target, asset-code lookup placement, role denial, manager screens, reservation submission, handover confirmation and recovery, normal and fresh damaged returns, history and student issue visibility. |
| Shared header menu in Chromium with synthetic upstreams | PASS | Student, Professor, Lab Assistant, and Lab Manager at 1440 and 375 pixels. Checked default closure, exact role links, active link, Enter and Tab, Escape and restored focus, outside click, closing on navigation, and manager form width. |
| Synthetic QR camera | PASS | Chromium decoded a prerecorded QR stream and stopped the scanner. |
| Real Professor acceptance | PASS | Confirmed Professor session in the controlled Edge InPrivate window. Role navigation, catalogue filtering, successful and no-match lookup (HTTP 200 and 404), and manual UUID input passed. Assistant scan controls and manager navigation were absent. The direct manager route displayed Access denied, and the student return-problems API returned HTTP 403. |
| Live custody and manager acceptance | BLOCKED | A test-labelled item was available in the catalogue. Its designation and pickup windows still need confirmation, and the remaining workflows require separate designated role access. No shared records were mutated. |
| Physical-device camera and deployed acceptance | NOT RUN | Desktop Chromium emulated mobile viewports and camera input. |

The initial baseline build stopped at a Next.js version notice. Restoring the lockfile pin with `npm ci` resolved that. Earlier disposable harness runs hit a sub-millisecond status-guard case and a transient container socket startup error. Its final standard run passed.

## Screenshots

- Login [desktop](aub-theme-screenshots/login-desktop.png) and [mobile](aub-theme-screenshots/login-mobile.png)
- Updated catalogue [desktop](aub-theme-screenshots/catalogue-desktop-fixture.png) and [mobile](aub-theme-screenshots/catalogue-mobile-fixture.png)
- Open menu [desktop](aub-theme-screenshots/menu-desktop-fixture.png) and [mobile](aub-theme-screenshots/menu-mobile-fixture.png)
- Updated [manager equipment](aub-theme-screenshots/manager-equipment-desktop-fixture.png) and [scan](aub-theme-screenshots/scan-mobile-fixture.png)
- Previous custody verification [handover](aub-theme-screenshots/handover-mobile-fixture.png), [normal return history](aub-theme-screenshots/return-history-mobile-fixture.png), and [problematic return history](aub-theme-screenshots/problem-return-mobile-fixture.png)

The authenticated screenshots contain synthetic profiles and equipment.

## Recommendation and remaining acceptance

**NOT READY for live acceptance.** Provide the following for the remaining checks.

- Provide a designated student and lab assistant in the same lab for custody checks, and a designated lab manager for live manager checks.
- Confirm an eligible test asset and two pickup windows in that lab, or a second test asset with its own window, for fresh normal and problematic return scenarios.
- Provide a physical phone and QR label for device acceptance, and an accessible deployed URL if deployed acceptance is required.
