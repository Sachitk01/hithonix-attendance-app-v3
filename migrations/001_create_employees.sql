-- 001_create_employees.sql
-- Core extensions + enums + employees table

-- Extensions
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- Enums
CREATE TYPE employee_role_enum AS ENUM (
    'EMPLOYEE',
    'MANAGER',
    'ORG_ADMIN'
);

CREATE TYPE event_type_enum AS ENUM (
    'CLOCK_IN',
    'CLOCK_OUT',
    'BREAK_START',
    'BREAK_END',
    'AUTO_ADJUST'
);

CREATE TYPE sync_status_enum AS ENUM (
    'PENDING',
    'SYNCED',
    'FAILED',
    'SKIPPED'
);

CREATE TYPE daily_status_enum AS ENUM (
    'OFF_DUTY',
    'ON_SHIFT',
    'ON_BREAK',
    'ERROR'
);

-- employees table: authoritative directory
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    slack_user_id TEXT UNIQUE,          -- will be populated later
    keka_id TEXT UNIQUE,
    email CITEXT NOT NULL,

    department TEXT,
    designation TEXT,
    location TEXT,
    manager_employee_id UUID REFERENCES employees(id),

    employment_status TEXT NOT NULL DEFAULT 'ACTIVE',
    date_of_joining DATE,

    role employee_role_enum NOT NULL DEFAULT 'EMPLOYEE',

    ai_profile JSONB,
    raw_keka_profile JSONB NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_employees_manager
    ON employees(manager_employee_id);

CREATE INDEX idx_employees_department_status
    ON employees(department, employment_status);
