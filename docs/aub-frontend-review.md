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
- A rectangular burgundy Menu button sits before the AUB logo on desktop and mobile. It opens one left-edge drawer with the existing role links and active state. The drawer starts closed. Escape restores focus to Menu, and clicking outside or selecting a destination closes it. Forms retain readable maximum widths.
- The original screenshot fixture saved the Loans result as `checked_out` but kept returning a static `reserved` Equipment snapshot. The handover UI used the snapshot for both labels. The fixture now advances its Equipment snapshot on successful checkout. The UI uses the validated confirmation or recovery response for “Equipment status at handover” and the Equipment read for “Current equipment status.” A focused regression passes through the Web gateway and service handlers with a deliberately different Equipment read. A reopened record shows its current status using the live Equipment read. The existing Loans service checks the checkout receipt and status before recording completion. The inconsistent screenshot established no backend defect.
- The pale grey rectangle was baked into the supplied PNG. The header uses a 427 × 165 derivative that changes only the alpha channel of 23,707 connected grey matte pixels. All other pixels and the original file are unchanged. The white artwork field is retained. The lettering and seal were inspected at normal size and at twice the source width.
- Run the real services with `npm run dev:all` and open `http://localhost:3000`. Next.js accepted the HMR upgrade with HTTP 101 on `localhost` and logged a development-origin denial for `127.0.0.1`. The real student dashboard hydrated on the documented hostname, and the synthetic signed-in browser suite also passed there in dev mode. Origin checks, authentication, and TLS settings are unchanged.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Final workspace scripts | PASS | `npm run typegen`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` exited 0. The default suite passed 915 tests and skipped 50 PostgreSQL cases. |
| Disposable PostgreSQL | PASS | Reused the prior standard harness result for unchanged services and schema. It ran the 50 cases, including all 10 status-guard and 26 handover tests. |
| Real services and existing browser session | PASS | After the header update, all four health endpoints returned HTTP 200, anonymous protected pages redirected, and the catalogue API returned 401. A 61.9-second development browser probe retained both login fields with zero reloads after a brief startup refresh burst. Earlier live student verification reached the dashboard and the Web and Loans return-problems endpoints returned HTTP 200. |
| Authenticated Chromium with synthetic upstreams | PASS | Desktop and mobile catalogue, clipped and focused skip link, correct skip target, asset-code lookup placement, role denial, manager screens, reservation submission, handover confirmation and recovery, normal and fresh damaged returns, history and student issue visibility. |
| Shared header menu in Chromium with synthetic upstreams | PASS | Student, Professor, Lab Assistant, and Lab Manager at 1440 and 375 pixels. Checked default closure, exact role links, active link, Enter and Tab, Escape and restored focus, outside click, closing on navigation, and manager form width. |
| Left drawer and logo refinement | PASS | Focused navigation tests, Web lint and typecheck, plus Edge fixture checks at 1440, 375, and 320 pixels. Verified button and brand order, no overlap, the left-edge rectangle, active styling, Escape and focus restoration, outside click, and closing on selection. |
| Synthetic QR camera | PASS | Chromium decoded a prerecorded QR stream and stopped the scanner. |
| Real Professor acceptance | PASS | Confirmed Professor session in the controlled Edge InPrivate window. Role navigation, catalogue filtering, successful and no-match lookup (HTTP 200 and 404), and manual UUID input passed. Assistant scan controls and manager navigation were absent. The direct manager route displayed Access denied, and the student return-problems API returned HTTP 403. |
| Live normal custody scenario | BLOCKED | The test asset is approved. The controlled Edge InPrivate window is awaiting the designated Student sign-in. No reservation, handover, or return was submitted. |
| Live problematic return and manager acceptance | BLOCKED | The problematic return follows a successful normal scenario and requires a separate valid, non-overlapping pickup window. Manager acceptance requires a designated manager. |
| Physical-device camera and deployed acceptance | NOT RUN | Desktop Chromium emulated mobile viewports and camera input. |

The initial baseline build stopped at a Next.js version notice. Restoring the lockfile pin with `npm ci` resolved that. Earlier disposable harness runs hit a sub-millisecond status-guard case and a transient container socket startup error. Its final standard run passed.

## Screenshots

- Previous login [desktop](aub-theme-screenshots/login-desktop.png) and [mobile](aub-theme-screenshots/login-mobile.png)
- Updated catalogue [desktop](aub-theme-screenshots/catalogue-desktop-fixture.png) and [mobile](aub-theme-screenshots/catalogue-mobile-fixture.png)
- Open left drawer [desktop](aub-theme-screenshots/menu-desktop-fixture.png) and [mobile](aub-theme-screenshots/menu-mobile-fixture.png)
- Previous [manager equipment](aub-theme-screenshots/manager-equipment-desktop-fixture.png) and [scan](aub-theme-screenshots/scan-mobile-fixture.png)
- Previous custody verification [handover](aub-theme-screenshots/handover-mobile-fixture.png), [normal return history](aub-theme-screenshots/return-history-mobile-fixture.png), and [problematic return history](aub-theme-screenshots/problem-return-mobile-fixture.png)

The authenticated screenshots contain synthetic profiles and equipment.

## Recommendation and remaining acceptance

**NOT READY for live acceptance.** Provide the following for the remaining checks.

- Sign in as the designated Student in the controlled Edge InPrivate window. Use the approved asset for a fresh normal reservation, then switch to the same-lab Lab Assistant at the eligible pickup time.
- Check for a second valid, non-overlapping window only after the normal return is complete. A designated Lab Manager is needed for live manager checks.
- Provide a physical phone and QR label for device acceptance, and an accessible deployed URL if deployed acceptance is required.
