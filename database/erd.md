# UniTrack — Entity Relationship Diagram

## Jira S1-04: Design the Data Model

This ERD represents the eight required record types and the supporting laboratory and equipment category tables.

The database uses PostgreSQL hosted on Supabase.

## Complete ERD

```mermaid
erDiagram

    LABS ||--o{ PROFILES : has
    LABS ||--o{ EQUIPMENT_ITEMS : contains
    LABS ||--o{ KITS : owns
    LABS ||--o{ KIT_COMPONENTS : owns
    LABS ||--o{ RESERVATIONS : has
    LABS ||--o{ LOANS : has
    LABS ||--o{ CONDITION_RECORDS : has
    LABS ||--o{ EQUIPMENT_STATUS_HISTORY : has

    EQUIPMENT_CATEGORIES ||--o{ EQUIPMENT_ITEMS : categorizes

    PROFILES o|--o{ EQUIPMENT_ITEMS : creates

    EQUIPMENT_ITEMS ||--o| KITS : may_be

    KITS ||--o{ KIT_COMPONENTS : contains

    EQUIPMENT_ITEMS o|--o{ KIT_COMPONENTS : tracked_as

    PROFILES ||--o{ RESERVATIONS : makes
    EQUIPMENT_ITEMS ||--o{ RESERVATIONS : receives

    PROFILES ||--o{ LOANS : borrows
    EQUIPMENT_ITEMS ||--o{ LOANS : borrowed_in

    RESERVATIONS o|--o| LOANS : may_create

    LOANS ||--o{ CONDITION_RECORDS : has
    EQUIPMENT_ITEMS ||--o{ CONDITION_RECORDS : inspected_in
    KIT_COMPONENTS o|--o{ CONDITION_RECORDS : checked_in

    EQUIPMENT_ITEMS ||--o{ EQUIPMENT_STATUS_HISTORY : has
    PROFILES o|--o{ EQUIPMENT_STATUS_HISTORY : records

    LABS {
        int id PK
        varchar code UK
        varchar name
        boolean is_active
        timestamptz created_at
    }

    PROFILES {
        uuid id PK
        varchar full_name
        varchar university_email UK
        varchar role
        int lab_id FK
        boolean is_active
        timestamptz created_at
    }

    EQUIPMENT_CATEGORIES {
        int id PK
        varchar name UK
        text description
        boolean is_active
        timestamptz created_at
    }

    EQUIPMENT_ITEMS {
        uuid id PK
        varchar asset_code UK
        varchar name
        text description
        varchar serial_number
        int category_id FK
        int lab_id FK
        varchar status
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    KITS {
        uuid item_id PK
        int lab_id FK
        timestamptz created_at
    }

    KIT_COMPONENTS {
        uuid id PK
        uuid kit_item_id FK
        int lab_id FK
        varchar component_name
        int quantity_required
        uuid tracked_item_id FK
        boolean is_required
        boolean is_active
        timestamptz created_at
    }

    RESERVATIONS {
        uuid id PK
        uuid item_id FK
        uuid borrower_id FK
        int lab_id FK
        timestamptz start_at
        timestamptz end_at
        varchar status
        timestamptz created_at
    }

    LOANS {
        uuid id PK
        uuid item_id FK
        uuid borrower_id FK
        uuid reservation_id FK
        int lab_id FK
        timestamptz borrowed_at
        timestamptz due_date
        timestamptz returned_at
        timestamptz created_at
    }

    CONDITION_RECORDS {
        uuid id PK
        uuid loan_id FK
        uuid item_id FK
        uuid kit_component_id FK
        int lab_id FK
        varchar phase
        varchar condition_status
        text notes
        uuid recorded_by FK
        timestamptz recorded_at
    }

    EQUIPMENT_STATUS_HISTORY {
        int id PK
        uuid item_id FK
        int lab_id FK
        varchar old_status
        varchar new_status
        uuid changed_by FK
        text reason
        timestamptz changed_at
    }
```

## Relationship Explanation

### 1. Labs

One lab can have many users, equipment items, kits, reservations, loans, and historical records.

Each lab-owned record contains a lab ID.

### 2. Equipment Categories

One equipment category can contain many equipment items.

Each equipment item belongs to one category.

### 3. Users

Students and staff are stored in the profiles table.

The role column distinguishes students, lab managers, lab assistants, and administrators.

A user can make multiple reservations and have multiple historical loans.

### 4. Equipment Items

One equipment item can have many reservations, loans, condition records, and status history records.

An equipment item may also represent a kit.

### 5. Kits and Components

A kit is an equipment item with its own asset code and status.

One kit can contain multiple components.

Each component records its name and required quantity.

### 6. Reservations

One item can have multiple reservations for different periods.

A reservation does not automatically change the equipment item's physical status.

A reservation may result in a loan.

### 7. Loans

A loan represents an actual equipment handover.

Each loan belongs to an equipment item and borrower.

The due_date field stores the expected return date.

The returned_at field indicates whether the item has been returned.

An item cannot have two active loans simultaneously.

### 8. Condition Records

A loan can have multiple condition records.

Condition records describe equipment condition during pickup, return, or inspection.

Historical condition records cannot be deleted.

### 9. Equipment Status History

An item can have multiple status history records.

Each record contains the previous status, new status, responsible user, reason, and timestamp.

## Jira S1-04 Requirements

- All eight required record types are represented.
- Item, user, staff, and other lab-owned records contain a lab ID.
- Historical loan and condition records are protected against deletion.
- Future reservations do not automatically change equipment physical status.
