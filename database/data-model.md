# UniTrack — Database Design

## 1. Overview

UniTrack is a university equipment borrowing and management system.

The database is implemented using PostgreSQL, hosted on Supabase.

The application uses:
- Next.js and TypeScript
- PostgreSQL
- Supabase Auth
- `pg` for server-side database connections

The database supports equipment management, reservations, borrowing, returns, kits, condition records, and equipment status tracking.

This document describes the complete data model required by Jira S1-04.

**Implementation status:** The initial four tables are already deployed in Supabase. The additional tables and lab associations are part of the expanded design and must be reviewed before migration.

---

## 2. Database Tables

The model contains the eight record types required by Jira:

1. Item
2. Kit
3. Component
4. User
5. Reservation
6. Loan
7. Condition record
8. Status history

Two supporting tables are also included:

- Labs
- Equipment categories

Therefore, the complete model contains 10 tables.

### Table 1: labs

Stores information about university laboratories.

| Column | Data Type | Constraints |
|---|---|---|
| id | INTEGER | Primary Key, Identity |
| code | VARCHAR(40) | UNIQUE, NOT NULL |
| name | VARCHAR(150) | NOT NULL |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

Important rules:

- Each lab has a unique identifier.
- Users and equipment are associated with a lab.
- New labs can be added without changing the database structure.
- Labs can be deactivated without deleting historical information.

This supports NF-11: adding more labs in the future.

Initial laboratory:

- Lab name: Electronics Lab
- Lab code: ELEC

The initial laboratory has been confirmed by the team.

Additional laboratories can be added later without modifying the database structure.

### Table 2: profiles

Stores information about students and university staff.

Supabase Auth manages login through `auth.users`.

| Column | Data Type | Constraints |
|---|---|---|
| id | UUID | Primary Key, FK to auth.users(id) |
| full_name | VARCHAR(100) | NOT NULL |
| university_email | VARCHAR(255) | UNIQUE, NOT NULL |
| role | VARCHAR(30) | CHECK constraint, DEFAULT 'student' |
| lab_id | INTEGER | NOT NULL, FK to labs(id) |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

Supported roles:

- student
- lab_assistant
- professor
- lab_manager

Important rules:

- Every profile belongs to one authenticated user.
- Every user and staff member has a lab ID.
- Students and staff are distinguished through the `role` column.
- Users cannot assign themselves privileged roles.
- User permissions will be implemented with NH.

The expanded model assumes that each profile belongs to one primary lab. This assumption requires Product Owner approval.

### Table 3: equipment_categories

Stores equipment categories.

| Column | Data Type | Constraints |
|---|---|---|
| id | INTEGER | Primary Key, Identity |
| name | VARCHAR(100) | UNIQUE, NOT NULL |
| description | TEXT | Optional |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

Examples:

- Electronics
- Laboratory Equipment
- Audio/Visual Equipment

Important rules:

- Each category has a unique ID.
- Category names cannot be duplicated.
- New categories can be created without changing application code.
- Categories can be deactivated.
- A category cannot be deleted while equipment references it.

Categories are shared supporting records and are not assigned to one specific lab.

### Table 4: equipment_items

Stores physical equipment items.

| Column | Data Type | Constraints |
|---|---|---|
| id | UUID | Primary Key, DEFAULT gen_random_uuid() |
| asset_code | VARCHAR(50) | UNIQUE, NOT NULL |
| name | VARCHAR(150) | NOT NULL |
| description | TEXT | Optional |
| serial_number | VARCHAR(100) | UNIQUE when not NULL |
| condition | VARCHAR(30) | NOT NULL, DEFAULT 'unknown', CHECK constraint |
| is_restricted | BOOLEAN | NOT NULL, DEFAULT FALSE |
| category_id | INTEGER | NOT NULL, FK to equipment_categories |
| lab_id | INTEGER | NOT NULL, FK to labs |
| status | VARCHAR(30) | NOT NULL, DEFAULT 'available', CHECK |
| created_by | UUID | Optional FK to profiles |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |

Confirmed equipment status values:
| Database Value | Frontend Display |
|---|---|
| available | Available |
| reserved | Reserved |
| checked_out | Borrowed |
| inspection_required | Inspection Required |
| under_maintenance | Under Repair |
| retired | Retired |
| lost | Lost |
| overdue | Overdue |

Additional equipment rules:

- Equipment serial numbers must be unique when provided.
- Multiple equipment items may have a NULL serial number.
- The condition column stores the item's current physical condition.
- Supported condition values are good, damaged, missing, and unknown.
- New equipment receives the condition 'unknown' by default.
- The is_restricted column identifies equipment with borrowing restrictions.
- New equipment has is_restricted = FALSE by default.
- Restricted equipment will require additional authorization during the borrowing workflow.
- The lost status identifies equipment reported as lost.
- The overdue status identifies equipment whose borrowing period has expired.
- Overdue handling will be coordinated with the loans table and implemented in Sprint 2.

### Table 5: kits

Identifies equipment items that are borrowed as kits.

| Column | Data Type | Constraints |
|---|---|---|
| item_id | UUID | Primary Key, FK to equipment_items(id) |
| lab_id | INTEGER | NOT NULL, FK to labs(id) |
| created_at | TIMESTAMPTZ | NOT NULL |

Important rules:

- A kit is also an equipment item.
- The kit uses the same UUID as its corresponding equipment item.
- Its name, asset code, category, and status are stored in `equipment_items`.
- A kit can contain several components.
- A kit can be reserved or borrowed as one unit.

This design allows reservations and loans to use `item_id` for both individual items and kits.

### Table 6: kit_components

Stores the components included in equipment kits.

| Column | Data Type | Constraints |
|---|---|---|
| id | UUID | Primary Key |
| kit_item_id | UUID | NOT NULL, FK to kits(item_id) |
| lab_id | INTEGER | NOT NULL, FK to labs(id) |
| component_name | VARCHAR(150) | NOT NULL |
| quantity_required | INTEGER | NOT NULL, greater than 0 |
| tracked_item_id | UUID | Optional FK to equipment_items |
| is_required | BOOLEAN | NOT NULL, DEFAULT TRUE |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE |
| created_at | TIMESTAMPTZ | NOT NULL |

Example:

An electronics kit contains:

- 1 Arduino board
- 2 USB cables
- 1 Breadboard
- 10 Jumper wires

Important rules:

- Every component belongs to a kit.
- Each component specifies the expected quantity.
- A component can optionally reference an individually tracked equipment item.
- Components can be marked inactive.
- The application must ensure that a kit and its components belong to the correct lab.

### Table 7: reservations

Stores future equipment bookings.

| Column | Data Type | Constraints |
|---|---|---|
| id | UUID | Primary Key |
| item_id | UUID | NOT NULL, FK to equipment_items |
| borrower_id | UUID | NOT NULL, FK to profiles |
| lab_id | INTEGER | NOT NULL, FK to labs |
| start_at | TIMESTAMPTZ | NOT NULL |
| end_at | TIMESTAMPTZ | NOT NULL |
| status | VARCHAR(20) | CHECK constraint |
| created_at | TIMESTAMPTZ | NOT NULL |

Reservation status values:

- pending
- confirmed
- cancelled
- fulfilled
- expired

Important rules:

- A reservation belongs to a user and an equipment item.
- A reservation defines a start and end time.
- The end time must be later than the start time.
- Kits can be reserved using their equipment item ID.
- Preventing overlapping confirmed reservations will be implemented in Sprint 2.

**Critical requirement:**

A future reservation must not automatically change the item's current physical status.

Example:

A laptop is currently Available.

A student reserves it for next week.

The laptop remains Available until an actual physical status change occurs.

Reservations and equipment statuses are separate records.

This satisfies the S1-04 acceptance criteria.

### Table 8: loans

Stores information about equipment physically borrowed by students.

| Column | Data Type | Constraints |
|---|---|---|
| id | UUID | Primary Key |
| item_id | UUID | NOT NULL, FK to equipment_items |
| borrower_id | UUID | NOT NULL, FK to profiles |
| reservation_id | UUID | Optional unique FK to reservations |
| lab_id | INTEGER | NOT NULL, FK to labs |
| borrowed_at | TIMESTAMPTZ | NOT NULL |
| due_date | TIMESTAMPTZ | NOT NULL |
| returned_at | TIMESTAMPTZ | Optional |
| created_at | TIMESTAMPTZ | NOT NULL |

Important rules:

- A loan records an actual equipment handover.
- Every loan belongs to an item and a borrower.
- A loan may be linked to a reservation.
- An active loan has `returned_at IS NULL`.
- The due date must be later than the borrowing time.
- An item cannot have two active loans simultaneously.
- Historical loans cannot be deleted.

The database includes a partial unique index to prevent multiple active loans for the same item.

**Catalogue integration:**

When an item is Borrowed, the catalogue can retrieve its expected return date from the active loan.

The `due_date` field supports the Sprint 1 catalogue acceptance criteria.

The full borrowing and return workflow will be implemented in Sprint 2.

### Table 9: condition_records

Stores equipment condition information during pickup, return, and inspection.

| Column | Data Type | Constraints |
|---|---|---|
| id | UUID | Primary Key |
| loan_id | UUID | NOT NULL, FK to loans |
| item_id | UUID | NOT NULL, FK to equipment_items |
| kit_component_id | UUID | Optional FK to kit_components |
| lab_id | INTEGER | NOT NULL, FK to labs |
| phase | VARCHAR(20) | CHECK constraint |
| condition_status | VARCHAR(20) | CHECK constraint |
| notes | TEXT | Optional |
| recorded_by | UUID | Optional FK to profiles |
| recorded_at | TIMESTAMPTZ | NOT NULL |

Supported phases:

- pickup
- return
- inspection

Condition values:

- good
- damaged
- missing
- unknown

Important rules:

- Condition records are associated with loans.
- Staff can record the condition of an item at pickup or return.
- Kit components can have individual condition records.
- Historical condition records cannot be deleted.
- Additional records preserve the history of condition changes.

This supports NF-7.

### Table 10: equipment_status_history

Stores the history of equipment physical status changes.

| Column | Data Type | Constraints |
|---|---|---|
| id | INTEGER | Primary Key, Identity |
| item_id | UUID | NOT NULL, FK to equipment_items |
| lab_id | INTEGER | NOT NULL, FK to labs |
| old_status | VARCHAR(30) | Optional |
| new_status | VARCHAR(30) | NOT NULL |
| changed_by | UUID | Optional FK to profiles |
| reason | TEXT | Optional |
| changed_at | TIMESTAMPTZ | NOT NULL |

Example:

An item changes from:

`available → checked_out`

A history record stores:

- old_status: available
- new_status: checked_out
- reason: Equipment handed over to student

Important rules:

- Each physical status change should create a history record.
- The record identifies the old and new statuses.
- The user responsible can be recorded.
- Records remain associated with their equipment item.
- The status-history implementation belongs to SC.
- The existing timestamp trigger does not automatically create history records.

Historical record protection:

- Equipment status history is append-only.
- New status history records can be inserted.
- Existing status history records cannot be updated.
- Existing status history records cannot be deleted.
- A PostgreSQL trigger enforces these restrictions.
- This preserves the complete equipment status history.
---

## 3. Database Relationships

### Lab relationships

- One lab can have many users.
- One lab can have many equipment items.
- One lab can have many kits and kit components.
- One lab can have many reservations and loans.
- Historical condition and status records retain their lab IDs.

### Category relationships

One category can contain many equipment items.

`equipment_categories.id → equipment_items.category_id`

### Kit relationships

An equipment item may be a kit.

`equipment_items.id → kits.item_id`

One kit can contain many components.

`kits.item_id → kit_components.kit_item_id`

### User relationships

One user can:

- Register multiple equipment items.
- Make multiple reservations.
- Borrow multiple items.
- Record equipment conditions, if authorized.
- Perform equipment status changes, if authorized.

### Reservation relationships

One item can have multiple reservations at different periods.

A reservation belongs to one user.

A reservation may be associated with one loan.

### Loan relationships

One item can have multiple historical loans.

One user can have multiple loans.

An item can have at most one active loan at a time.

One loan can have multiple condition records.

### Status history relationships

One item can have multiple status history records.

Each history record belongs to one item.

---

## 4. Important Database Constraints

### Primary keys

Each table has a primary key that uniquely identifies its records.

### Foreign keys

Foreign keys prevent records from referencing nonexistent related records.

### Unique constraints

The database prevents duplicate values for:

- Lab codes
- University email addresses
- Equipment category names
- Equipment asset codes
- Kit component names within the same kit
- Multiple active loans for the same item

### Check constraints

The database validates:

- User roles
- Equipment statuses
- Reservation statuses
- Reservation periods
- Loan dates
- Component quantities
- Condition record phases
- Condition values

### Historical record protection

Past loans and condition records must not be deleted.

The proposed database schema includes triggers that reject deletion from:

- `loans`
- `condition_records`

### Row Level Security

RLS is enabled on the existing four tables.

The expanded schema also enables RLS on the additional tables.

NH will implement and test the required authentication and authorization policies.

Server-side API routes must still verify user permissions and lab access.

---

## 5. Jira S1-04 Acceptance Criteria

### Criterion 1: Complete data model

The model includes:

- Item
- Kit
- Component
- User
- Reservation
- Loan
- Condition record
- Status history

It also includes supporting tables for labs and equipment categories.

Status: **Designed — awaiting Product Owner review.**

### Criterion 2: Lab identification (NF-11)

Items, users, staff, and other lab-owned records store `lab_id`.

The model supports adding additional labs.

Status: **Included in the design.**

### Criterion 3: Historical records cannot be deleted (NF-7)

The proposed schema protects loan and condition records using deletion-prevention triggers.

Status: **Included in the design; migration and testing pending.**

### Criterion 4: Future reservations do not change physical status

Reservations are stored separately from equipment status.

Creating a future reservation does not automatically update `equipment_items.status`.

Status: **Included in the design.**

---

## 6. Sprint Implementation

### Already implemented in Supabase

- Equipment categories
- User profiles
- Equipment items
- Equipment status history
- Primary and foreign keys for the original four tables
- Equipment status validation
- Five demo equipment records
- Automatic equipment update timestamps
- Initial database testing
- RLS enabled on the original four tables

### Designed but not yet deployed

- Labs
- Lab ID associations
- Kits
- Kit components
- Reservations
- Loans
- Condition records
- Historical record deletion protection

The expanded schema requires a migration before these changes become available in Supabase.

---

## 7. Responsibilities

### JS — Database and Scrum Master

- Maintain the database schema.
- Design tables and relationships.
- Implement approved database migrations.
- Prepare database test data.
- Coordinate database integration.
- Maintain database documentation.

### ZZ — Product Owner and Catalogue

- Review and approve the data model.
- Integrate the catalogue with equipment and category data.
- Display live equipment statuses.
- Retrieve expected return dates from active loans.

### SN — Equipment Management

- Implement equipment creation and updates.
- Connect API operations to the database.
- Validate equipment lab and category references.

### SC — Status History and QR Codes

- Implement QR code functionality.
- Record equipment status changes.
- Integrate equipment status history.

### NH — Authentication and Permissions

- Implement Supabase Auth.
- Manage user profiles and roles.
- Implement authorization and RLS policies.

### LJ — Application Foundation

- Set up the Next.js and TypeScript application.
- Maintain the starter application and frontend foundation.
- Coordinate application integration.

---

## 8. Implementation Files

The database work is maintained in the `database` directory.

- `schema.sql` — Complete database design
- `data-model.md` — Tables, relationships, and constraints
- `seed.sql` — Demo categories and equipment
- `triggers.sql` — Equipment timestamp automation
- `TESTING.md` — Database validation and tests
- `erd.md` — Entity Relationship Diagram
- `migration_002.sql` — Proposed migration for existing tables

---

## 9. Product Owner Review

The following decisions require confirmation:

1. Does each student and staff member belong to one primary lab?
2. Is representing a kit as an equipment item acceptable?
3. Are the proposed kit component fields sufficient?
4. What lab code should be used for the initial demo data?
5. Should the catalogue display the active loan's due date when equipment is Borrowed?

The data model is ready for review.

