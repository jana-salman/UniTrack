# Sprint 1 Acceptance Test Results

Tested by: LJ
Date: 2026-11-04
Deployed URL: https://uni-track-psi.vercel.app
Devices: Phone (model and browser): iPhone 16, Safari | Desktop (browser): Windows PC, Google Chrome

## Automated checks (latest main)

| Check | Result |
|---|---|
| TypeScript (`npx tsc --noEmit`) | Pass |
| Lint (`npm run lint`) | Pass |
| Unit and API tests (`npx vitest run`) | Pass: 15 test files, 107 tests |
| Production build (`npm run build`) | Pass: 15 routes built |

## Manual acceptance tests

Result values: Pass / Fail / Not tested

| Card | Owner | Phone | Desktop | Bug link | Notes |
|---|---|---|---|---|---|
| S1-01 Jira board and sprints | JS | Pass | Pass | None | |
| S1-02 Repository and stack | LJ | Pass | Pass | None | README, structure, branch naming and deployment checked |
| S1-03 Hosting, database, demo data | JS | Pass | Pass | None | Deployed app connects to the database |
| S1-04 Data model | JS | Pass | Pass | None | |
| S1-05 University email login | NH | Pass | Pass | None | |
| S1-06 Four roles and permissions | NH | Pass | Pass | None | Navigation and page access checked per role |
| S1-07 Add, edit, retire item | SN | Pass | Pass | None | |
| S1-08 Dynamic categories | SN | Pass | Pass | None | |
| S1-09 Unique ID and QR code | SC | Pass | Pass | None | |
| S1-10 Status model with history | SC | Pass | Pass | None | |
| S1-11 Mobile-first layout | LJ | Pass | Pass | None | Checked at 360 px and desktop width |
| S1-12 Student catalogue | ZZ | Pass | Pass | None | |
| S1-13 QR scan on phone | SC | Pass | n/a | None | Over HTTPS on the deployed URL |
| S1-14 Definition of Done and checklist | JS | Pass | Pass | None | |
| S1-15 Backlog and acceptance | ZZ | Pass | Pass | None | |
| S1-16 This test run | LJ | Pass | Pass | None | |

## Open issues and next-sprint decision

| Bug | Severity | Owner | Decision |
|---|---|---|---|
| No defects found in this run | n/a | n/a | n/a |

## Summary

- Manual tests passed: 16 / 16
- Blocking defects fixed and retested: n/a (none found)