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
| Real development services and signed-out access | PASS | All four health endpoints returned HTTP 200. In Edge, Dashboard, Catalogue, Find equipment, Scan and Manage roles redirected to login, and the catalogue and return-problems APIs returned HTTP 401. A prior 61.9-second development probe retained both login fields with zero reloads after a brief startup refresh burst. |
| Desktop and mobile visual and accessibility review | PASS | Live-development login verified in Edge at 1440, 375 and 320 pixels for page width, logo proportions and keyboard movement from email to password. Reviewed the current desktop catalogue and mobile drawer screenshots. Rechecked the 375-pixel synthetic handover and return forms with the current header and captured both after clearing focus. |
| Authenticated Chromium with synthetic upstreams | PASS | Desktop and mobile catalogue, clipped and focused skip link, correct skip target, asset-code lookup placement, role denial, manager screens, reservation submission, handover confirmation and recovery, normal and fresh damaged returns, history and student issue visibility. |
| Shared header menu in Chromium with synthetic upstreams | PASS | Student, Professor, Lab Assistant, and Lab Manager at 1440 and 375 pixels. Checked default closure, exact role links, active link, Enter and Tab, Escape and restored focus, outside click, closing on navigation, and manager form width. |
| Left drawer and logo refinement | PASS | Focused navigation tests, Web lint and typecheck, plus Edge fixture checks at 1440, 375, and 320 pixels. Verified button and brand order, no overlap, the left-edge rectangle, active styling, Escape and focus restoration, outside click, and closing on selection. |
| Synthetic QR camera | PASS | Chromium decoded a prerecorded QR stream and stopped the scanner. |
| Real Professor acceptance | PASS | Confirmed Professor session in the controlled Edge InPrivate window. Role navigation, catalogue filtering, successful and no-match lookup (HTTP 200 and 404), and manual UUID input passed. Assistant scan controls and manager navigation were absent. The direct manager route displayed Access denied, and the student return-problems API returned HTTP 403. |
| Real Student navigation, read-only access and role checks | PASS | Confirmed the designated Student in Laboratory 1 in controlled Edge InPrivate. The menu offered only Dashboard and Catalogue. Direct visits to Find equipment, Scan and Manage roles displayed Access denied. Asset-code search returned HTTP 200 and showed `TEST-DRONE-001`. The Dashboard return-problems request returned HTTP 200 and displayed existing missing-item and damage entries. |
| Historical live reservation submissions | FAIL | On 22 November 2026, two submissions for the approved asset returned HTTP 503 from Web and Loans. The attempted starts were 20:50 and 20:51 Beirut time, with an exclusive end at 00:00 on 23 November. Neither attempt persisted a reservation or confirmed a pickup window. No submissions were made during the deferral review. |
| Reservation failure diagnosis | PASS | The response message maps to Loans’ `reservation_unavailable` error. A read-only probe through the configured Loans role reproduced SQLSTATE `42P01` on the overlap query because `public.reservation_resources` is absent. Zero rows matched either attempted reservation. The role had unrestricted SELECT for the table and lacked the reservation INSERT column grants and an applicable INSERT policy. |
| Real Lab Assistant and Lab Manager read-only and role checks | BLOCKED | The available authorized session is Student. Independent staff navigation and access checks require a designated same-lab Lab Assistant and a designated Lab Manager to sign in separately in the controlled browser. Synthetic coverage exists for both roles. |
| Live normal reservation → handover → return | BLOCKED / DEFERRED TO SPRINT 3 | Requires the shared database prerequisite, a fresh confirmed reservation and an eligible pickup window. |
| Live problematic return and visibility for the new loan | BLOCKED / DEFERRED TO SPRINT 3 | Requires the normal scenario to pass first and a second valid, non-overlapping reservation and pickup window. Existing dashboard records establish read-only visibility only. |
| Physical-device camera | BLOCKED | Requires a physical phone and test QR label. Desktop Chromium emulated the viewport and used prerecorded camera input. |
| Deployed acceptance | BLOCKED | Requires an authorized deployed environment and URL. Current live checks used local development services. |

The initial baseline build stopped at a Next.js version notice. Restoring the lockfile pin with `npm ci` resolved that. Earlier disposable harness runs hit a sub-millisecond status-guard case and a transient container socket startup error. Its final standard run passed.

The shared database migration is deferred to Sprint 3. The configured login inherits the Loans service role, and Equipment reads succeeded before and after the database lock. Four Web gateway tests and 25 Loans reservation tests passed. The owner must verify 003–006, then review the missing S2-02, S2-09, 007, S2-05, S2-01 permissions and S2-01 status protection steps in the [documented order](../database/local-test/README.md#migration-sequence). S2-05 supplies the resource table and RLS policies. S2-01 supplies the six column-level INSERT grants and the confirmed-only INSERT policy. Leave reservation submissions paused until the owner verifies those prerequisites on the shared target.

## Screenshots

- Previous login [desktop](aub-theme-screenshots/login-desktop.png) and [mobile](aub-theme-screenshots/login-mobile.png)
- Updated catalogue [desktop](aub-theme-screenshots/catalogue-desktop-fixture.png) and [mobile](aub-theme-screenshots/catalogue-mobile-fixture.png)
- Open left drawer [desktop](aub-theme-screenshots/menu-desktop-fixture.png) and [mobile](aub-theme-screenshots/menu-mobile-fixture.png)
- Current mobile custody forms [handover](aub-theme-screenshots/handover-form-mobile-fixture.png) and [return](aub-theme-screenshots/return-form-mobile-fixture.png)
- Previous [manager equipment](aub-theme-screenshots/manager-equipment-desktop-fixture.png) and [scan](aub-theme-screenshots/scan-mobile-fixture.png)
- Previous custody verification [handover](aub-theme-screenshots/handover-mobile-fixture.png), [normal return history](aub-theme-screenshots/return-history-mobile-fixture.png), and [problematic return history](aub-theme-screenshots/problem-return-mobile-fixture.png)

The authenticated screenshots contain synthetic profiles and equipment.

## Recommendation and remaining acceptance

**Ready for frontend review. Platform acceptance remains open.** This update adds review evidence and screenshots. It carries forward the passing workspace, synthetic browser and disposable PostgreSQL checks for the unchanged code.

- Independent live staff checks can proceed when a designated same-lab Lab Assistant and a designated Lab Manager sign in one at a time. Verify Assistant scan and asset lookup access and manager-route denial. Verify the Manager can read the equipment, kit, category and user-role pages. No record changes are needed for these checks.
- In Sprint 3, have the database owner preflight and verify the authorized migration deployment. Recheck the two failed windows for persisted records, then submit one fresh reservation for `TEST-DRONE-001` as the designated Student. Record the confirmed Beirut pickup window. At eligibility, switch to the same-lab Lab Assistant and complete handover and normal return. Verify the completed records and resulting equipment status.
- After the normal return, proceed only if a second valid, non-overlapping window exists. Use a fresh reservation and loan, record the return problem, verify Inspection Required and completed return history, then sign back in as the designated Student and verify the new problem appears on the dashboard.
- Run physical QR camera acceptance with a phone and a test label. Run deployed acceptance separately once an authorized URL is available.
