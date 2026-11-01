# UniTrack — Database Design

## 1. Overview

UniTrack is a university equipment borrowing and management system.

The database stores information about:
- University users and their roles
- Equipment categories
- Equipment items
- Equipment status changes

The database uses PostgreSQL, hosted on Supabase.

The initial database structure supports Sprint 1 and is designed
to be extended in later sprints for reservations, borrowing,
returns, kits, and equipment inspections.

## 2. Database Tables

### Table 1: profiles

Stores information about users registered in UniTrack.

Supabase Auth manages authentication through the auth.users table.
The profiles table stores additional information needed by UniTrack.

| Column | Data Type | Constraint |
|---|---|---|
| id | UUID | Primary Key, Foreign Key to auth.users(id), ON DELETE CASCADE |
| full_name | VARCHAR(100) | NOT NULL |
| university_email | VARCHAR(255) | UNIQUE, NOT NULL |
| role | VARCHAR(30) | NOT NULL, DEFAULT 'student', CHECK constraint |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

Supported roles:
- student
- lab_manager
- lab_assistant
- administrator

Important rules:
- Each profile belongs to one authenticated Supabase user.
- The profile ID must match the corresponding auth.users ID.
- University emails must be unique.
- Every user must have one of the four supported roles.
- New profiles receive the student role by default unless another
  role is assigned through an authorized process.
- If an authenticated user is deleted, their profile is also deleted.

Authentication and profile creation will be coordinated with the
team member responsible for login and permissions (NH).

The database table does not automatically create profiles when
users register. That functionality must be implemented separately.

Security note:
Students must not be allowed to assign themselves administrator
or other privileged roles. This restriction will be enforced
through application authorization and database access policies.

### Table 2: equipment_categories

Stores the different categories of university equipment.

| Column | Data Type | Constraint |
|---|---|---|
| id | INTEGER | Primary Key, GENERATED ALWAYS AS IDENTITY |
| name | VARCHAR(100) | UNIQUE, NOT NULL |
| description | TEXT | Optional |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

Example categories:
- Electronics
- Laboratory Equipment
- Audio/Visual Equipment

Important rules:
- Each category has a unique, automatically generated ID.
- Category names cannot be duplicated using the exact same value.
- New categories can be added directly to the database.
- Categories can be marked inactive using is_active.
- Creating a new category does not require modifying application code.

This table supports the Sprint 1 requirement to manage equipment
categories dynamically.

### Table 3: equipment_items

Stores information about each physical equipment item registered
in UniTrack.

| Column | Data Type | Constraint |
|---|---|---|
| id | UUID | Primary Key, DEFAULT gen_random_uuid() |
| asset_code | VARCHAR(50) | UNIQUE, NOT NULL |
| name | VARCHAR(150) | NOT NULL |
| description | TEXT | Optional |
| serial_number | VARCHAR(100) | Optional |
| category_id | INTEGER | NOT NULL, Foreign Key to equipment_categories(id), ON DELETE RESTRICT |
| status | VARCHAR(30) | NOT NULL, DEFAULT 'available', CHECK constraint |
| created_by | UUID | Optional Foreign Key to profiles(id), ON DELETE SET NULL |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

Proposed equipment statuses:
- available
- reserved
- checked_out
- inspection_required
- under_maintenance
- retired

Important rules:
- Every physical item has a unique UUID.
- Every physical item must have a unique asset code.
- Every equipment item must belong to an existing category.
- Equipment cannot reference a nonexistent category.
- A category cannot be deleted while equipment references it.
- Equipment must have one of the supported statuses.
- New equipment receives the status 'available' by default.
- The created_by column identifies the user who registered the item.
- created_by can temporarily be NULL while authentication is being developed.
- If a creator's profile is deleted, the equipment record is preserved
  and created_by becomes NULL.

QR code handling:
- Each item has a unique asset_code.
- A QR code can be generated using the asset code or an item URL.
- It is not necessary to store a QR code image in the database.
- The QR scanning and label functionality will be implemented separately.

Timestamp handling:
- created_at records when the equipment was created.
- updated_at initially receives the creation timestamp.
- Automatically updating updated_at when equipment is edited
  requires additional application logic or a database trigger.

Example equipment item:

Asset code: UT-LAP-001
Name: Dell Latitude Laptop
Description: Demo laptop available for student borrowing
Serial number: DEMO-LAP-SN-001
Category: Electronics
Status: available

### Table 4: equipment_status_history

Stores the history of status changes for equipment items.

| Column | Data Type | Constraint |
|---|---|---|
| id | INTEGER | Primary Key, GENERATED ALWAYS AS IDENTITY |
| item_id | UUID | NOT NULL, Foreign Key to equipment_items(id), ON DELETE RESTRICT |
| old_status | VARCHAR(30) | Optional |
| new_status | VARCHAR(30) | NOT NULL |
| changed_by | UUID | Optional Foreign Key to profiles(id), ON DELETE SET NULL |
| reason | TEXT | Optional |
| changed_at | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

Important rules:
- Every history record belongs to an existing equipment item.
- Each status change should create a separate history record.
- A history record stores the previous and new statuses.
- The changed_by column identifies the user responsible for the change.
- The reason column can explain why the status changed.
- The changed_at column records when the change occurred.
- Equipment cannot be deleted while history records reference it.
- If a user's profile is deleted, existing history records are preserved
  and changed_by becomes NULL.

Example:

An equipment item changes from:

available → checked_out

A history record should contain:
- old_status: available
- new_status: checked_out
- reason: Equipment handed over to student

When the equipment is returned:

checked_out → available

Another history record should be created.

Important implementation note:

The equipment_status_history table has been created in PostgreSQL.

However, creating this table does not automatically record status changes.

The functionality that creates history records when equipment status
changes must be implemented separately.

This functionality belongs to Jira S1-10 and will be developed by SC,
in coordination with the database structure created by JS.

## 3. Database Relationships

### Relationship 1: Auth Users — Profiles

- Each profile belongs to one authenticated Supabase user.
- The profiles.id column references auth.users.id.
- Deleting an Auth user also deletes the associated profile.

Relationship:
auth.users (1) → profiles (0 or 1)

### Relationship 2: Equipment Categories — Equipment Items

- One category can contain many equipment items.
- Each equipment item belongs to exactly one category.

Relationship:
equipment_categories (1) → equipment_items (Many)

Foreign Key:
equipment_items.category_id → equipment_categories.id

### Relationship 3: Profiles — Equipment Items

- One user can register multiple equipment items.
- An equipment item may temporarily have no recorded creator.

Relationship:
profiles (1) → equipment_items (Many)

Foreign Key:
equipment_items.created_by → profiles.id

### Relationship 4: Equipment Items — Status History

- One equipment item can have multiple status history records.
- Each history record belongs to exactly one equipment item.

Relationship:
equipment_items (1) → equipment_status_history (Many)

Foreign Key:
equipment_status_history.item_id → equipment_items.id

### Relationship 5: Profiles — Status History

- One user can perform multiple equipment status changes.
- Each history record may identify the user who made the change.

Relationship:
profiles (1) → equipment_status_history (Many)

Foreign Key:
equipment_status_history.changed_by → profiles.id

## 4. Important Database Constraints

### Primary Keys

Each table has a primary key that uniquely identifies its records.

- profiles: id
- equipment_categories: id
- equipment_items: id
- equipment_status_history: id

### Foreign Keys

Foreign keys maintain relationships between tables.

- profiles.id references auth.users.id
- equipment_items.category_id references equipment_categories.id
- equipment_items.created_by references profiles.id
- equipment_status_history.item_id references equipment_items.id
- equipment_status_history.changed_by references profiles.id

### UNIQUE Constraints

The database prevents duplicate values for:

- profiles.university_email
- equipment_categories.name
- equipment_items.asset_code

### CHECK Constraints

The profiles table accepts only the four supported user roles.

The equipment_items table accepts only the defined equipment statuses.

### NOT NULL Constraints

Required fields cannot contain NULL values.

Examples:
- Equipment name
- Equipment asset code
- Equipment category
- Equipment status
- University email

### Default Values

PostgreSQL automatically generates certain values.

Examples:
- Category IDs
- Equipment UUIDs
- Default equipment status: available
- Default user role: student
- Creation timestamps
- Default active status: TRUE

## 5. Database Testing

The initial database structure has been implemented in Supabase.

The following operations were tested successfully:

### Test 1: Equipment Insertion and Retrieval

A sample laptop was inserted into equipment_items.

The equipment was retrieved using a JOIN with equipment_categories.

Result: PASS

### Test 2: Duplicate Equipment Code

An attempt was made to insert another equipment item
with the same asset code.

PostgreSQL rejected the insertion.

Result: PASS

### Test 3: Invalid Category

An attempt was made to insert equipment with a nonexistent category ID.

PostgreSQL rejected the insertion.

Result: PASS

### Test 4: Invalid Equipment Status

An attempt was made to change an equipment status to 'broken',
which is not included in the permitted status values.

PostgreSQL rejected the update.

The original status remained unchanged.

Result: PASS

Detailed test queries and results are documented in TESTING.md.

## 6. Security and Authentication

Supabase Auth will manage user authentication.

The profiles table will store application-specific user information.

Database security will include:
- Authentication through Supabase Auth
- Role-based permissions
- Row Level Security (RLS)
- Controlled access to sensitive operations

RLS was configured to be enabled automatically when the
Supabase project was created.

However, the application-specific access policies and
role-based authorization logic have not yet been implemented.

These must be coordinated with NH, who is responsible for
authentication and permissions.

## 7. Future Database Extensions

Later sprints will require additional database functionality.

Planned extensions include:
- Equipment reservations
- Reservation cancellation
- Equipment kits and kit components
- Borrowing and return records
- Custody history
- Late returns
- Equipment inspection records

These features are not included in the initial Sprint 1 schema.

The current database structure provides a foundation for
implementing them in later sprints.

## 8. Related Jira Cards

### Database Development

S1-03 — Set up hosting, database and demo data

S1-04 — Design the data model

### Features Supported by the Database

S1-05 — Log in with a university email

S1-06 — Four roles, permissions and user management

S1-07 — Lab manager adds, edits and retires an item

S1-08 — New equipment categories without code changes

S1-09 — Unique ID and QR code for each item

S1-10 — Item status model with history

S1-12 — Student catalogue with live status

The database provides the structures needed by these features.
Their complete application functionality is implemented
by the responsible team members.

## 9. Implementation Files

The database work is stored in the following files:

- data-model.md: Database design and relationships
- schema.sql: PostgreSQL table definitions and constraints
- seed.sql: Sample categories and equipment data
- TESTING.md: Database tests and expected results

All files are maintained in the UniTrack GitHub repository
under the database development branch.

## 10. Current Implementation Status

Completed:
- Initial database design
- Supabase project creation
- Equipment categories table
- User profiles table
- Equipment items table
- Equipment status history table
- Primary and foreign key relationships
- Sample equipment categories
- Sample laptop record
- Initial database constraint testing

Remaining:
- Automatic equipment updated_at handling
- Coordination with authentication implementation
- Application-specific database access policies
- Additional sample equipment and testing
- Integration with the Next.js backend
- Future sprint database extensions