Hithonix v2.0 — Database Architecture Guide

Author: Sachit
Role: Chief Architect, Attendance & HRIS Platform
Scope: Production-ready attendance, compliance, and state-projection architecture
Audience: Backend, Platform, SRE, and Admin Tools teams

1. Overview

Hithonix v2.0 uses a ledger + state-cache model designed for:

High-integrity attendance tracking

Slack-first interactions

Real-time HRIS synchronization with Keka

Immutable compliance-grade storage

Manager & admin oversight

Predictable performance at scale

The core domain consists of:

attendance_events → Immutable ledger (every punch ever recorded)

daily_status → Derived state cache (one row per user per IST business day)

employees → Directory of truth (Slack → Keka → internal identity)

audit_logs → Governance trail (every admin override recorded)

keka_employee_imports → Staging layer for HRIS sync

employee_hierarchy_v → Manager graph for org-wide filtering

These components form the canonical source of attendance truth.

2. Schema Summary
2.1 employees

Directory of truth for all workers.

Key fields

id (PK, UUID)

slack_user_id (unique)

keka_id (unique)

email, full_name

manager_employee_id → employees(id)

employment_status

raw_keka_profile JSONB

department, designation, location

Purpose

Map Slack → Keka → internal identity

Provide reporting structure

Provide shift & worker metadata

2.2 attendance_events

Hithonix’s immutable audit ledger.

Invariants

Never UPDATE

Never DELETE

Write-only, append-only

Enforced by a BEFORE trigger

Double-punch protection enforced at DB level

IST business date auto-validated

Key fields

id UUID PK

employee_id FK employees(id)

event_type attendance_event_type

event_timestamp_utc

event_timestamp_ist

business_date_ist (CHECK enforces alignment with IST)

sync_status attendance_sync_status

keka_request_body, keka_response_body, retry metadata

Purpose

Record every punch and adjustment with full auditability

Power the entire state machine

Provide guaranteed replayability

2.3 daily_status

A per-employee, per-day cached view of the latest known attendance state.

Key fields

employee_id, business_date_ist (unique)

current_status attendance_daily_status

last_event_id FK attendance_events(id)

last_event_timestamp_utc

break_minutes_used

has_sync_errors

notes JSONB

updated_at

Maintained automatically by the DB trigger:

INSERT event → upsert daily_status

Maintains last known state

Used by Slack Home, dashboards, admin consoles

2.4 audit_logs

Mandatory governance log.

Key fields

actor_slack_id

target_employee_id

action

reason

context JSONB

created_at

Purpose

Every override, unlock, correction, or admin touch is logged

Chronologically indexed

Used for compliance, debugging, and investigations

2.5 keka_employee_imports

Staging table fed by Keka sync workers.

Behaviors

Raw payloads stored

ETL jobs populate/update employees

Immutable records for historical reconciliation

2.6 employee_hierarchy_v

Materialized view expressing reporting lines.

Purpose

Manager dashboards

Approval workflows

Cascading org analytics

3. System Invariants (Do Not Break)

These rules define the system’s safety and compliance posture.

3.1 Ledger Invariants (attendance_events)

No UPDATE allowed

No DELETE allowed

All writes must be INSERT

Double-punch events for same employee & day & type rejected

business_date_ist = event_timestamp_utc AT TIME ZONE 'Asia/Kolkata' enforced

Enum-typed event_type and sync_status

Violations → immediate SQL errors.

3.2 State Cache Invariants (daily_status)

Derived entirely from attendance_events

Never manually updated by application code

Always one row per (employee_id, business_date_ist)

current_status reflects latest ledger event

last_event_id must always reference a real ledger event

3.3 Audit Invariants (audit_logs)

Every admin action must be recorded

Rows are append-only

No business logic should run without inserting audit logs

3.4 Enum Governance

Enums must be extended via:

ALTER TYPE ... ADD VALUE ...


Never dropped or recreated. Keeps forward compatibility intact.

4. Event Flow: How Attendance Works
4.1 Normal Punch (Slack / API)

Backend receives a Slack action (CLOCK_IN / CLOCK_OUT / BREAK_START / BREAK_END).

Backend performs single INSERT into attendance_events.

DB trigger automatically:

Enforces immutability

Rejects duplicates

Projects new state into daily_status

Slack Home Tab reads directly from daily_status.

Backend does NOT:

Update daily_status

Write business_date manually

Touch event rows after insertion

4.2 Admin Adjustments

When an admin fixes a day:

Insert ADMIN_ADJUST event into attendance_events.

Insert a row into audit_logs.

DB recomputes daily_status automatically.

Admin tools do NOT update ledger rows.

4.3 Keka Sync

Workers read from:

attendance_events
WHERE sync_status IN ('PENDING', 'FAILED')


Upon success:

Update sync_status to SUCCESS

Update keka_response_body, last_attempt_at, attempt_count

Reprojection into daily_status not needed — sync metadata does not alter state.

5. Read Models (Backend Reference Queries)
5.1 Slack Home Tab
SELECT e.full_name,
       ds.current_status,
       ds.last_event_timestamp_utc,
       ds.business_date_ist
FROM employees e
JOIN daily_status ds
  ON ds.employee_id = e.id
WHERE e.slack_user_id = $1
  AND ds.business_date_ist = (now() AT TIME ZONE 'Asia/Kolkata')::date;

5.2 Manager Dashboard
SELECT e.full_name,
       e.email,
       ds.current_status,
       ds.business_date_ist
FROM employee_hierarchy_v h
JOIN employees e ON e.id = h.employee_id
LEFT JOIN daily_status ds
  ON ds.employee_id = e.id
 AND ds.business_date_ist = (now() AT TIME ZONE 'Asia/Kolkata')::date
WHERE h.manager_id = $manager_id;

5.3 Employee Timeline
SELECT *
FROM attendance_events
WHERE employee_id = $employee_id
  AND business_date_ist = $date
ORDER BY event_timestamp_utc ASC;

5.4 Admin Action History
SELECT *
FROM audit_logs
WHERE target_employee_id = $employee_id
ORDER BY created_at DESC;

6. DB Roles & Access Guidelines
App Role (hithonix_app)

Allowed:

SELECT on all tables

INSERT into attendance_events

INSERT into audit_logs

INSERT/UPDATE into daily_status only via DB triggers

UPDATE sync_status on attendance_events (Keka sync worker)

Not allowed:

Any UPDATE/DELETE on attendance_events

Any arbitrary writes to daily_status

Admin Role (hithonix_admin)

Allowed:

Full DDL

Full SELECT/INSERT/UPDATE

Not allowed:

DELETE on attendance_events (never allowed)

Read-only Role (hithonix_readonly)

Allowed:

SELECT on all tables

No writes

7. Future Enhancements (Design-Safe)

These enhancements are optional and can be added post-handover:

Break wallet + lunch wallet calculation

Lock/unlock compliance (is_locked, lock_reason)

Full multi-event state transition engine

Sync-status dashboards

Multi-shift / overnight shift handling

Daily anomaly detection

END_OF_DAY auto-adjusts

The current model fully supports these without breaking schema integrity.

8. Migration Workflow

All DB changes must use versioned migration files.

Never edit old migrations once applied anywhere outside local dev.

Enum evolution must use ALTER TYPE ... ADD VALUE.

Test each migration in local before pushing to team environments.

9. Contact & Ownership

Database Architecture Owner: Sachit
Operational Owner (Backend): Assigned by Chief Architect
SRE Owner: Platform/SRE team
Schema Evolution: Via standard migration flow