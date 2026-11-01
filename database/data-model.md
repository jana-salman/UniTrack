# UniTrack — Database Design

## 1. Overview

UniTrack is a university equipment borrowing and management system.

The database stores information about users, equipment categories,
equipment items, and changes to equipment status.

The initial database supports Sprint 1 and will be extended in
later sprints to support reservations, borrowing, and returns.

## 2. Database Tables

### Table 1: profiles

Stores information about users registered in UniTrack.

| Column | Data Type | Constraint |
|---|---|---|
| id | UUID | Primary Key |
| full_name | VARCHAR(100) | NOT NULL |
| university_email | VARCHAR(255) | UNIQUE, NOT NULL |
| role | VARCHAR(30) | NOT NULL |
| is_active | BOOLEAN | DEFAULT TRUE |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP |

Supported roles:
- Student
- Lab Manager
- Lab Assistant
- Administrator

Authentication will be coordinated with the team member
responsible for login and permissions.

### Table 2: equipment_categories

Stores the different categories of university equipment.

| Column | Data Type | Constraint |
|---|---|---|
| id | INTEGER | Primary Key |
| name | VARCHAR(100) | UNIQUE, NOT NULL |
| description | TEXT | Optional |
| is_active | BOOLEAN | DEFAULT TRUE |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP |

Example categories:
- Electronics
- Laboratory Equipment
- Audio/Visual Equipment

Categories are stored in the database so new categories can
be added without changing the application's code.

### Table 3: equipment_items

Stores information about each physical equipment item.

| Column | Data Type | Constraint |
|---|---|---|
| id | UUID | Primary Key |
| asset_code | VARCHAR(50) | UNIQUE, NOT NULL |
| name | VARCHAR(150) | NOT NULL |
| description | TEXT | Optional |
| serial_number | VARCHAR(100) | Optional |
| category_id | INTEGER | Foreign Key |
| status | VARCHAR(30) | NOT NULL |
| created_by | UUID | Foreign Key |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP |

Proposed equipment statuses:
- Available
- Reserved
- Checked Out
- Inspection Required
- Under Maintenance
- Retired

Each physical item has a unique asset code.

A QR code can be generated from the item's unique identifier
or an item URL. The QR code does not need to be stored as an image
in the database.

### Table 4: equipment_status_history

Stores the history of status changes for equipment items.

| Column | Data Type | Constraint |
|---|---|---|
| id | INTEGER | Primary Key |
| item_id | UUID | Foreign Key, NOT NULL |
| old_status | VARCHAR(30) | Optional |
| new_status | VARCHAR(30) | NOT NULL |
| changed_by | UUID | Foreign Key |
| reason | TEXT | Optional |
| changed_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP |

Every time an item's status changes, a new record is created.

Example:

A laptop changes from Available to Reserved.

The equipment_items table stores its current status.

The equipment_status_history table records the change,
including who made it and when.

## 3. Relationships

1. One equipment category can contain many equipment items.
2. Each equipment item belongs to one equipment category.
3. One equipment item can have many status history records.
4. Each status history record belongs to one equipment item.
5. One user can create many equipment items.
6. One user can perform many equipment status changes.

## 4. Important Constraints

- Every equipment item must have a unique asset code.
- Every equipment item must belong to an existing category.
- University emails must be unique.
- Users must have a valid role.
- Equipment items must have a valid status.
- Status changes must be recorded in the history table.

## 5. Future Extensions

Later sprints will extend the database to support:

- Equipment reservations
- Equipment kits and kit components
- Borrowing and return records
- Custody history
- Equipment inspections

These features are not implemented in the initial Sprint 1 schema.

## 6. Jira Cards:

- S1-04: Design the data model
- S1-05: Log in with a university email
- S1-06: Roles, permissions, and user management
- S1-07: Lab manager adds, edits, and retires an item
- S1-08: New equipment categories without code changes
- S1-09: Unique ID and QR code for each item
- S1-10: Item status model with history