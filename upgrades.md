# Ultron Life OS - Upgrade & Enhancement Plan

This document outlines the missing architectural and functional concepts required to bridge the gap between the initial PRD and the Ultron Persona expectations.

## Phase 9: Short-Term Memory & Session State
- **Objective:** Maintain low-latency conversation history for Voice (Vapi) and Telegram to ensure smooth, continuous dialogue without relying on slow vector queries.
- **Tasks:**
  - Setup a fast Key-Value store (like Vercel KV / Upstash Redis).
  - Implement a rolling window (e.g., last 15 messages) for immediate context during active chat sessions.

## Phase 10: Concrete Goal & Habit Tracking
- **Objective:** Track strict boolean logic, daily streaks, and the 20-month Berlin timeline OKRs.
- **Tasks:**
  - Create relational tables in Supabase: `habits`, `daily_logs`, and `goals`.
  - Build endpoints/functions to accurately increment and query habit streaks (e.g., German A1->B2 progress, Gym attendance).

## Phase 11: Expense Tracking & Financial Visibility
- **Objective:** Monitor personal cash flow in real-time to allow Ultron to effectively prevent impulsive purchases.
- **Tasks:**
  - Create a `finances` table in Supabase.
  - Implement an Expense Parser (e.g., using a specific Telegram command like `/spend 500k coffee` or SMS forwarding) so Ultron can track daily spending.
  - Integrate this finance data into the Nightly Self-Reflection engine.

## Phase 12: Real-Time Habit Auditing (Proactive Triggers)
- **Objective:** Cross-reference time and location data in real-time to enforce Farzin's work-life balance and routines.
- **Tasks:**
  - Implement a "Schedule Auditor" Cron job (e.g., running at 19:00 daily).
  - Query the latest OwnTracks GPS location; if the location is still `OFFICE`, trigger a severe Telegram alert warning against overworking.

## Phase 13: Webhook Security & Encryption
- **Objective:** Secure all exposed internet endpoints and protect sensitive credentials (like CCXT trading keys).
- **Tasks:**
  - Implement Authentication checks (e.g., HMAC signatures or shared secrets) for `/api/location/track` and `/api/vapi/webhook` to prevent spoofing.
  - Enforce Row Level Security (RLS) on all Supabase tables to protect personal data.
