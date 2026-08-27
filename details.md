# Ultron System Architecture & Product Requirements Document (PRD)
### Phase 0: Infrastructure & DevOps (Zero-Day Setup)
- **Objective:** Establish a bulletproof development environment.
- **Tasks:**
  - Initialize Next.js (App Router) with TypeScript, ESLint, and Prettier configurations.
  - Setup absolute imports (e.g., `@/*` mapped to `./*`).
  - Create a `.env.example` file defining all required environment variables (e.g., `DATABASE_URL`, `OPENROUTER_API_KEY`, `VAPI_API_KEY`, `TELEGRAM_BOT_TOKEN`).
  - Configure Supabase client wrapper in `lib/db/supabase.ts` for type-safe database queries.
## 1. Project Overview & Philosophy
Ultron is a self-evolving, multi-agent AI system built to serve as an autonomous life coach, financial advisor, and technical copilot. It operates on a decoupled architecture where memory, reasoning, and tool execution are isolated.

## 2. Tech Stack Ecosystem
- **Core Framework:** Next.js (App Router), React 18, TypeScript.
- **AI Processing:** Vercel AI SDK (Model-agnostic routing via `@openrouter/ai-sdk-provider`).
- **Database & RAG:** Supabase (PostgreSQL with `pgvector` extension for embeddings). ORM: Drizzle or Prisma.
- **Background Jobs:** Vercel Cron Jobs.
- **Integrations:** Vapi.ai (Voice), Telegraf (Telegram Bot), OwnTracks (GPS Webhooks), CCXT (Crypto Paper Trading).

## 3. Implementation Phases (Strict Step-by-Step Execution)

### Phase 1: Core Engine & Decoupled AI Provider
- **Objective:** Establish the foundational AI communication layer.
- **Tasks:**
  - Setup `/api/chat/route.ts` using `streamText`.
  - Implement a fallback mechanism: ensure Node.js runtime is used to prevent Edge network timeouts with complex API calls.
  - Inject `user_story.md` as the immutable system prompt.
  - **Validation:** Successfully send a text prompt and receive a context-aware streamed response.

### Phase 2: Multi-Channel Interface & Voice Cloning
- **Objective:** Allow Farzin to communicate via Telegram (text/audio) and Phone (Voice).
- **Tasks:**
  - **Telegram Adapter:** Create `/api/telegram/webhook/route.ts`. Parse incoming messages, route to the AI engine, and return text or synthesized voice.
  - **Voice Adapter:** Create `/api/vapi/webhook/route.ts`. Configure Vapi.ai for real-time conversational latency < 800ms. Setup function calling so Ultron can trigger backend actions mid-conversation.

### Phase 3: Spatial Awareness (GPS Context Engine)
- **Objective:** Track location in the background to deduce current activities.
- **Tasks:**
  - Create `/api/location/track/route.ts` to receive HTTP POST payloads from OwnTracks.
  - Implement Geofencing logic. Calculate distance between user coordinates and POIs (Point of Interest like Home, Gym, Office) using the Haversine formula:
    $$d = 2r \arcsin\left(\sqrt{\sin^2\left(\frac{\phi_2 - \phi_1}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\lambda_2 - \lambda_1}{2}\right)}\right)$$
  - Store transitions (e.g., `ENTER_GYM`, `LEAVE_OFFICE`) in Supabase to trigger context-aware routines.

### Phase 4: Market Arbitrage Engine (Scraper)
- **Objective:** Find underpriced assets on Divar.
- **Tasks:**
  - Build a background worker (Cron triggered every 15 mins).
  - Target categories: PS5 Consoles/Games, Laptops, Automotive parts.
  - Implement Z-score outlier detection to find items priced significantly below the mean:
    $$Z = \frac{X - \mu}{\sigma}$$
  - Filter out "fake" or "negotiable" prices.
  - Dispatch urgent Telegram alerts (with item URL and computed profit margin) if $Z \le -1.5$.

### Phase 5: W.D. Gann Predictive Trading Engine (Paper Trading)
- **Objective:** Predict market pivots using time-price geometry without lagging indicators.
- **Tasks:**
  - Create `lib/trading/gann.ts`.
  - Fetch historical OHLCV data via CCXT (e.g., Binance Testnet).
  - Implement Gann Angle calculations (1x1, 1x2, 2x1) projecting from major historical highs/lows.
  - Implement Time Squaring cycles (e.g., 90, 144, 360-day intervals).
  - **Execution Guardrails:** Execute trades in Paper Trading mode *only*. Strictly enforce a 2% maximum daily drawdown and mandatory Stop-Loss on every simulated order.

### Phase 6: Deep Memory & Nightly Self-Reflection (RAG)
- **Objective:** Enable Ultron to learn and evolve.
- **Tasks:**
  - Create a `memories` table in Supabase with `embedding` (vector type).
  - Convert daily interactions, rejected suggestions, and completed routines into embeddings.
  - Create `/api/cron/reflect/route.ts` (runs at 03:00 AM). The AI evaluates the previous day's data, identifies behavior patterns, and writes updated directives to the database to improve tomorrow's coaching strategy.

## 4. AI Developer Agent Protocol
**STOP. READ CAREFULLY.**
1. You are tasked to build this system phase by phase.
2. Acknowledge this document and immediately ask the user: "Are you ready to begin Phase 1: Core Engine?"
3. Do not write code for Phase 2 until Phase 1 is explicitly approved by the user. Maintain strict modularity. Write production-grade, highly readable TypeScript code.
### Phase 7: Global Error Handling & Fallbacks
- **Objective:** Ensure Ultron never crashes silently.
- **Tasks:**
  - Implement global API error wrappers for all Next.js API Routes.
  - Fallback Protocol: If OpenRouter times out or throws 500, log the error to a `system_logs` table in Supabase and send a "System Degraded" alert to the Telegram webhook.
  - Ensure all database interactions use try/catch blocks with proper TypeScript error typing.

### Phase 8: CI/CD & Production Deployment (Vercel)
- **Objective:** Go live with 24/7 uptime.
- **Tasks:**
  - Create a `vercel.json` file defining the Cron Job schedules (e.g., `0 3 * * *` for nightly reflection, `*/15 * * * *` for Divar arbitrage).
  - Prepare a testing checklist for the user to verify webhooks locally using Ngrok before pushing to the `main` branch.