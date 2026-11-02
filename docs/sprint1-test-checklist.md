# UniTrack — Sprint 1 Testing Checklist

## Purpose

Verify that all Sprint 1 cards satisfy their acceptance
criteria before the Sprint Review.

Each test must be marked Pass, Fail, or Blocked.

## Sprint 1 Tests

### S1-01 — Initial setup
- [ ] Verify the acceptance criteria listed in Jira.

### S1-02 — Tech Stack and Repository
- [ ] Tech stack and reasons are documented in README.
- [ ] All six team members can run the application.
- [ ] Main branch requires a reviewed pull request.

### S1-03 — Database and Demo Data
- [ ] Database and hosting are configured.
- [ ] Demo script loads 20 items, 3 kits, and 6 users.
- [ ] Demo data loads in under one minute.
- [ ] Demo data can be reset.
- [ ] QR test page is accessible over HTTPS on a phone.

### S1-04 — Data Model
- [ ] Required database tables exist.
- [ ] Lab relationships are included.
- [ ] Historical loan and condition records are protected.
- [ ] Future reservations do not change physical item status.
- [ ] Product Owner approved the model.

### S1-05 — Login
- [ ] Registered university user can log in.
- [ ] Unknown users are rejected.
- [ ] Non-university accounts cannot access the application.
- [ ] Protected pages cannot be opened before login.

### S1-06 — Roles and Permissions
- [ ] Four user roles are implemented.
- [ ] Students cannot access lab-manager pages.
- [ ] Lab manager can change user roles.
- [ ] Navigation follows user permissions.

### S1-07 — Equipment Management
- [ ] Lab manager can register equipment.
- [ ] Lab manager can edit equipment.
- [ ] Lab assistant cannot delete equipment.
- [ ] Retired equipment disappears from the catalogue.

### S1-08 — Equipment Categories
- [ ] Lab manager can create a category.
- [ ] Items can use the new category without code changes.

### S1-09 — QR Codes
- [ ] Each item and kit has a unique identifier.
- [ ] QR code contains the correct identifier.
- [ ] A phone can scan the printed label from 20 cm.

### S1-10 — Equipment Status
- [ ] Every item has one current status.
- [ ] Future reservations do not change today's status.
- [ ] Confirmed handover changes status to Borrowed.
- [ ] Status changes record the actor and timestamp.

### S1-11 — Mobile Layout
- [ ] Application works at 360 px width.
- [ ] Navigation matches the signed-in user's role.

### S1-12 — Equipment Catalogue
- [ ] Catalogue displays current equipment statuses.
- [ ] Search by name works.
- [ ] Category filtering works.
- [ ] Expected return dates appear when applicable.
- [ ] Other borrowers' names are hidden.
- [ ] Status updates appear within one minute.

### S1-13 — QR Camera Feasibility
- [ ] QR scanning works on Android over HTTPS.
- [ ] QR scanning works on iPhone over HTTPS.
- [ ] Manual ID entry works when camera access is denied.
- [ ] Devices, results, and library choice are documented.

### S1-14 — Definition of Done
- [ ] All six team members approved the document.
- [ ] Document is linked in Jira.
- [ ] Review, testing, merging, and Sprint Review are covered.

### S1-15 — Backlog Prioritization
- [ ] Product Backlog is ordered by priority.
- [ ] All Sprint 2 cards have acceptance criteria.

### S1-16 — Sprint 1 Testing
- [ ] Every Sprint 1 card has recorded test results.
- [ ] Failed tests have corresponding bug reports.
- [ ] Unresolved bugs are included in the Sprint 2 backlog.

## Test Evidence

For each Jira card, record:

- Test result: Pass / Fail / Blocked
- Device used
- Date tested
- Evidence: screenshot or test output
- Bug reference, if applicable

## Sprint Review

Only report tests as Passed after they have actually
been executed successfully.