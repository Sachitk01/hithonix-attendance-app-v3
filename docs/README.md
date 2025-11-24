📘 Hithonix Attendance App v3
Slack-Native Attendance System with AI Governance, Queue-First Architecture & Keka Integration
🚀 Overview

Hithonix Attendance App v3 is a Slack-based attendance platform designed for modern teams.
It provides a reliable, intelligent, user-friendly way for employees to Clock In / Clock Out / Break In / Break Out directly from Slack while maintaining Keka attendance compliance.

This system is built on:

Queue-first architecture (Slack → Queue → Worker → Keka)

AI-driven validation (“Gatekeeper”)

Self-healing state machine

Postgres ledger + whiteboard model

Role-based dashboards (Employee / Manager / Admin)

🔧 Key Features
✅ Slack Attendance

Clock In / Out from Slack Home Tab buttons

Break Start / End

Real-time Traffic Light UI (🟡 Pending, 🟢 Synced, 🔴 Failed)

🤖 AI Gatekeeper

Validates work plan before shift start

Rejects gibberish inputs

Learns user patterns (personalized responses)

🛠 Self-Healing Engine

Automatically fixes:

Double-click mistakes

Missing clock-outs

Broken break sequences

Ambiguous events (safe-only auto-fix)

🔗 Keka Integration

Uses POST /hris/employees/search for employee lookup

Uses Biometric Ingestion API for attendance logs

Uses X-API-Key header (case-sensitive)

📊 Role-Based Insights

Employees → view own insights

Managers → view team insights

Admins → org-wide anonymized analytics

🏛 Architecture
Slack → Backend API → AttendanceService → Queue → Worker → Keka
                      |                                   |
                      └── DB (Ledger + Whiteboard) ←──────┘

Core Components:
Component	Responsibility
Slack App	UI + interactions
AI Service	Gatekeeper + insights
Attendance Service	State machine, governance, self-healing
Database	employees, attendance_events, daily_status
Queue (BullMQ)	Reliable async processing
Worker	Pushes to Keka, handles retries
Analytics Service	Employee, manager, admin dashboards
📁 Project Structure
hithonix-v2/
  backend/
    src/
      api/
      services/
        keka/
        ai/
        attendance/
        analytics/
        slack/
      db/
      queues/
      utils/
    config/
    scripts/
  migrations/
  docs/

🗂 Database Overview
1. employees

Directory entry for each employee.
Includes:

slack_user_id

keka_id

email

department / designation

manager relationship

role (EMPLOYEE / MANAGER / ORG_ADMIN)

ai_profile (JSONB)

raw_keka_profile (JSONB)

2. attendance_events

Append-only ledger of all attendance actions:

CLOCK_IN

CLOCK_OUT

BREAK_START

BREAK_END

AUTO_ADJUST

SYSTEM_NOTE

With sync status to Keka:

PENDING

SYNCED

FAILED

SKIPPED

3. daily_status

Fast-read snapshot to render Slack Home:

current_status

last_event

business_date_ist

break_minutes_used

has_sync_errors

🛠 Tech Stack

Node.js + TypeScript

PostgreSQL 16+

BullMQ (Redis) for job queue

Slack Bolt API

OpenAI API for Gatekeeper logic

Keka API for attendance logs

Docker (optional) for containerized deployments

⚙️ Setup Instructions
1. Install Dependencies
npm install

2. Configure Environment

Create .env file (see .env.example):

SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
SLACK_SIGNING_SECRET=
OPENAI_API_KEY=

DATABASE_URL=
REDIS_URL=

KEKA_CLIENT_ID=
KEKA_CLIENT_SECRET=
KEKA_CORE_API_KEY=
KEKA_ATTENDANCE_API_KEY=
KEKA_DEVICE_ID=SLACK_BOT_V2

3. Run Migrations
npm run migrate

4. Start Backend
npm run dev

5. Start Worker
npm run worker

🔄 Workflow Summary
User Flow

User clicks Clock In in Slack

AI validates plan

AttendanceService logs PENDING event

Queue processes event

Worker pushes to Keka

DB updates event to SYNCED or FAILED

Slack UI refreshes automatically

🧩 Future Extensions

Multi-shift support

Geo-based attendance

HR anomaly detection

Advanced manager dashboards

Payroll-ready exports

🧑‍💼 Maintainers

Hithonix Engineering Team

For escalations, contact Sachit.