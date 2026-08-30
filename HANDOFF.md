# Ultron - Project Handoff Document

Welcome to the **Ultron System** (v3.5 - Interface & Voice Expansion). This document is a technical handoff for developers picking up the project. It outlines the architecture, technology stack, core modules, and current status.

---

## 🏗️ Technology Stack & Architecture

Ultron is a full-stack, AI-driven Tactical Command Center built for Telegram and Voice interactions, alongside a rich data dashboard.

### Frontend / Core Framework
- **Framework:** Next.js 14 (App Router) + React 18
- **Language:** TypeScript
- **Styling:** Tailwind CSS (with Framer Motion animations)
- **State Management:** Zustand (e.g., `chatStore`, `tradingStore`)
- **UI Components:** `lucide-react` for icons, `react-textarea-autosize`, and `lightweight-charts` for live market data.

### Backend & Infrastructure
- **Hosting / CI-CD:** Vercel (Edge & Node.js runtimes) with Vercel Cron Jobs, using Upstash QStash.
- **Database:** Supabase (PostgreSQL + `pgvector` for RAG/vector memory)
- **Cache / Short-Term Memory:** Upstash Redis (rolling 14-message chat history per user)
- **Background Jobs:** Upstash QStash (async AI task offloading to prevent Telegram webhook timeouts)
- **Version Control:** GitHub (`farzinkamrany/ultron`)

### AI & Integrations
- **Primary AI:** Google Gemini Pro/Flash via direct API (key rotation across 3 keys)
- **Voice:** Vapi.ai webhook at `/api/vapi/webhook`
- **Telegram:** Custom webhook at `/api/telegram/webhook` (Bot: `@Ultron_viperbot`)
- **Market Data:** CoinEx + Bybit WebSocket order books
- **Scraper:** Divar.ir arbitrage scanner with proxy rotation

---

## 📁 Key File Map

```
src/
├── app/
│   ├── page.tsx                          # Main chat UI
│   ├── trading/page.tsx                  # Live order book / trading UI
│   ├── dashboard/trading/page.tsx        # PnL Visualizer (NEW v3.5)
│   └── api/
│       ├── telegram/
│       │   ├── webhook/route.ts          # Telegram webhook (instant reply + QStash offload)
│       │   └── ai-worker/route.ts        # QStash worker: AI processing (NEW v3.5)
│       ├── vapi/webhook/route.ts         # Vapi voice webhook (Persian, no markdown)
│       ├── chat/route.ts                 # Web chat endpoint
│       └── cron/
│           ├── trading/route.ts          # Trading engine cron
│           ├── trading-checker/route.ts  # Paper trade evaluator
│           ├── memory-prune/route.ts     # Memory cleanup cron
│           ├── reflect/route.ts          # Nightly self-reflection
│           └── arbitrage/route.ts        # Divar arbitrage scanner
├── components/
│   └── TelegramProvider.tsx              # TWA theme sync (NEW v3.5)
├── store/
│   └── tradingStore.ts                   # Zustand: order books + PnL trades
├── lib/
│   ├── ai.ts                             # Gemini tool-execution loop
│   ├── ai-tools.ts                       # Tool definitions (read_source_code, etc.)
│   ├── prompt.ts                         # Ultron system prompt
│   ├── memory.ts                         # Vector memory search (Supabase pgvector)
│   ├── telegram.ts                       # Telegram send helpers
│   ├── redis.ts                          # Upstash Redis client
│   ├── supabase.ts                       # Supabase client
│   ├── qstash.ts                         # QStash receiver + signature verification
│   ├── divar.ts                          # Divar scraper + Z-score arbitrage detection
│   └── trading/                          # Gann trading engine
└── hooks/
    └── useOrderBook.ts                   # WebSocket order book hook
supabase/
└── migrations/
    ├── 001_*.sql                         # Initial schema (memories, finances, etc.)
    └── 002_paper_trades.sql              # Paper trading table
```

---

## 🔄 Telegram Bot Architecture (v3.5)

To prevent Telegram's 10-second webhook timeout from silencing the bot on long AI queries:

```
User Message → Telegram → /api/telegram/webhook (returns 200 OK instantly)
                                    ↓ publishes to QStash
                            QStash → /api/telegram/ai-worker (60s budget)
                                            ↓ Gemini AI + Tool calls
                                       Telegram API → User Phone
```

**Instant commands** (handled directly in webhook, no AI): `/dashboard`, `/model`, `/spend`

---

## 📊 Supabase Tables

| Table | Purpose |
|---|---|
| `memories` | Long-term vector memory (pgvector embeddings) |
| `finances` | Expense tracking |
| `system_logs` | Error/event logging |
| `paper_trades` | Paper trading engine records |

---

## 🌍 Environment Variables Required

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram bot auth |
| `TELEGRAM_CHAT_ID` | Allowed chat IDs (comma separated) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API (primary) |
| `GEMINI_API_KEY_PRIMARY/SECONDARY/FALLBACK` | Key rotation pool |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `UPSTASH_REDIS_REST_URL` | Redis connection |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth |
| `QSTASH_TOKEN` | QStash publishing key |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash signature verification |
| `QSTASH_NEXT_SIGNING_KEY` | QStash signature verification |
| `NEXT_PUBLIC_APP_URL` | Full deployment URL (e.g. `https://ultron-assistant-iota.vercel.app`) |
| `GITHUB_PAT` | GitHub personal access token |
| `GITHUB_OWNER` / `GITHUB_REPO` | Repo for `read_source_code` / `write_and_propose_code` tools |
| `CRON_SECRET` | Auth header for cron endpoints |
| `DIVAR_PROXIES` | Comma-separated proxy list for Divar scraper |

---

## ✅ Current System Status (v3.5 - 2026-08-31)

| Feature | Status |
|---|---|
| Telegram bot (AI responses) | ✅ Live — QStash async pattern |
| `/dashboard` inline button | ✅ Live |
| PnL Visualizer at `/dashboard/trading` | ✅ Live |
| Vapi Persian voice (no markdown) | ✅ Live |
| Telegram Web App theme sync | ✅ Live |
| Paper trading engine | ✅ Live |
| Divar arbitrage scanner (proxy rotation) | ✅ Live |
| Live order book (CoinEx/Bybit WebSocket) | ✅ Live |
| Nightly self-reflection cron | ✅ Scheduled |
| RAG vector memory | ✅ Live |

---

## 🔧 Useful Debug Scripts (`/scratch`)

| Script | Purpose |
|---|---|
| `scratch/fix-webhook.js` | Clear stuck pending updates + re-register webhook |
| `scratch/check-webhook.js` | Inspect webhook status and pending update count |
| `scratch/test-telegram.js` | Send a test message to verify bot connectivity |
| `scratch/test-bybit.js` | Test Bybit API connection |
| `scratch/test-coinex.js` | Test CoinEx API connection |
