# UniTrack AUB frontend review

## Revisions

| Reference | SHA |
| --- | --- |
| Starting HEAD and fetched `origin/main` | `0061916ae7505a2e0b1c171d3b6d4757bc98fdee` |
| Local `main` at start and finish | `0061916ae7505a2e0b1c171d3b6d4757bc98fdee` |
| Existing `backup/main-before-aub-theme` at start and finish | `0061916ae7505a2e0b1c171d3b6d4757bc98fdee` |
| Implementation on `feature/aub-frontend-theme` | `d7b7cc1a10d2a1fdd71d29f5c340fa89a6174507` |

## Screens and workflows

- Applied the supplied AUB logo, burgundy and ivory styling, a shared workspace shell, role-aware navigation, mobile keyboard controls, and consistent headings and feedback. Covered login, access denial, missing pages, dashboard, catalogue, lookup, scan, custody forms, and manager equipment, kits, categories, and roles.
- Kept `/catalogue` at its existing URL in the protected route group. Search follows the Equipment service’s name and asset-code filters. Cards use actual status, due date, and reservation eligibility. The student dashboard retains its own-return problem view.
- Lab assistants can select an item through lookup and continue to scan matching. Results link to eligible pickups, active loans, and unfinished handovers for the selected item using existing server-authorized records. Return history is accessible after a confirmed return. The service has no browse view for arbitrary completed loans, so revisiting earlier history still requires a known loan record.

## Verification

| Check | Baseline | Final | Evidence |
| --- | --- | --- | --- |
| `npm run typegen`, `npm run lint`, `npm run typecheck` | PASS | PASS | All root workspace commands exited 0. |
| `npm test` | PASS | PASS | 911 baseline and 914 final tests passed. The 50 PostgreSQL tests skipped under the default script ran in the disposable harness. |
| `npm run build` | FAIL | PASS | The installed Next.js 16.4.4 initially stopped at its security notice. `npm ci` restored the existing 16.4.5 pin and all four apps built. |
| Disposable PostgreSQL `database/local-test/run.ps1` | FAIL | PASS | Initial harness runs hit a status-guard case involving sub-millisecond reservation end times and a transient container socket startup error. The final unmodified runner exited 0, including all 10 status-guard and 26 handover tests. |
| Documented `dev:all` and public Chromium checks | NOT RUN | PASS | Four HTTP 200 health responses. Public redirects, university-domain error, keyboard focus, access denial and missing-page views checked at 375 and 1440 pixels. |
| Authenticated Chromium with synthetic upstreams | NOT RUN | PASS | Local production build exercised sign-in/out, role denial, all manager screens, name and asset-code/category filters, mobile menu and focus, reservation form and submit, scan and lookup links, confirmed and recovered handover, normal and damaged returns, history, and student problem visibility. |
| Synthetic QR camera | NOT RUN | PASS | Chromium read a prerecorded QR frame stream and stopped scanning after the match. |
| Live authenticated acceptance and shared writes | NOT RUN | BLOCKED | Designated shared accounts and equipment were unavailable. No shared records were mutated. |
| Physical mobile camera and deployed Vercel acceptance | NOT RUN | NOT RUN | Requires a physical device and the deployed application. |

The authenticated development-browser run stalled before hydration while the HMR WebSocket handshake was failing. The authenticated browser results above come from the local production build. The existing POST origin check rejected the IP alias in that build. Testing used `localhost` as documented.

## Screenshots

- Login [desktop](aub-theme-screenshots/login-desktop.png) and [mobile](aub-theme-screenshots/login-mobile.png)
- Catalogue [desktop](aub-theme-screenshots/catalogue-desktop-fixture.png) and [mobile](aub-theme-screenshots/catalogue-mobile-fixture.png)
- [Manager equipment](aub-theme-screenshots/manager-equipment-desktop-fixture.png), [scan](aub-theme-screenshots/scan-mobile-fixture.png), and [handover](aub-theme-screenshots/handover-mobile-fixture.png)
- [Normal return history](aub-theme-screenshots/return-history-mobile-fixture.png) and [problematic return history](aub-theme-screenshots/problem-return-mobile-fixture.png)

Authenticated screenshots use synthetic profiles and equipment. The implementation diff is confined to Web UI and Web tests. Review found no private configuration, browser session state, service changes, or migration changes.

## Recommendation

**NOT READY for live acceptance.** The workspace, disposable PostgreSQL, and synthetic browser results support code review. Shared sign-in and custody acceptance still need designated accounts and equipment. Physical camera and deployed checks remain outstanding.
