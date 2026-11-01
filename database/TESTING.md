# UniTrack — Database Testing

## Overview

This document records the database tests performed for Sprint 1.

The tests verify that the PostgreSQL database correctly stores
equipment information and enforces important constraints.

Related Jira cards:
- S1-03: Set up hosting, database and demo data
- S1-04: Design the data model

## Test 1 — Insert and Retrieve Equipment

Objective: Verify that an equipment item can be inserted
and retrieved with its category.

```sql
SELECT
    e.asset_code,
    e.name,
    c.name AS category,
    e.status
FROM public.equipment_items e
JOIN public.equipment_categories c
    ON e.category_id = c.id
WHERE e.asset_code = 'UT-LAP-001';
```

Expected result:
- Asset code: UT-LAP-001
- Equipment: Dell Latitude Laptop
- Category: Electronics
- Status: available

Result: PASS

## Test 2 — Duplicate Equipment Code

Objective: Verify that two items cannot have the same asset code.

```sql
INSERT INTO public.equipment_items (
    asset_code,
    name,
    category_id
)
SELECT
    'UT-LAP-001',
    'Duplicate Laptop',
    id
FROM public.equipment_categories
WHERE name = 'Electronics';
```

Expected result:
PostgreSQL rejects the insertion because the asset code already exists.

Result: PASS

## Test 3 — Invalid Equipment Category

Objective: Verify that equipment cannot reference
a nonexistent category.

```sql
INSERT INTO public.equipment_items (
    asset_code,
    name,
    category_id
)
VALUES (
    'UT-INVALID-001',
    'Invalid Category Item',
    -1
);
```

Expected result:
PostgreSQL rejects the insertion because category -1 does not exist.

Result: PASS

## Test 4 — Invalid Equipment Status

Objective: Verify that equipment cannot have an unsupported status.

```sql
UPDATE public.equipment_items
SET status = 'broken'
WHERE asset_code = 'UT-LAP-001';
```

Expected result:
PostgreSQL rejects the update because "broken" is not
an allowed status.

Verification query:

```sql
SELECT asset_code, status
FROM public.equipment_items
WHERE asset_code = 'UT-LAP-001';
```

The item's status remains "available".

Result: PASS

## Summary

All four tests passed.

The database successfully enforces:
- Unique equipment identifiers
- Valid category references
- Valid equipment statuses
- Correct retrieval of related data

Note: Tests intentionally causing errors must be executed
individually in the Supabase SQL Editor.
They must not be included in seed.sql.


