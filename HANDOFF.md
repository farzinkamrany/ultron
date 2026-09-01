# Ultron - Project Handoff Document

Welcome to the **Ultron System** (v4.0 - Infrastructure Stability & Autonomous Analyst). This document is a technical handoff for developers picking up the project. It outlines the architecture, technology stack, core modules, and current status.

---

## 🏗️ Technology Stack & Architecture

Ultron is a full-stack, AI-driven Tactical Command Center built for Telegram and Voice interactions, alongside a rich data dashboard.

### Frontend / Core Framework
- **Framework:** Next.js 14 (App Router) + React 18
- **Language:** TypeScript
- **Styling:** Tailwind CSS (with Framer Motion animations)
- **State Management:** Zustand (e.g., `chatStore`, `tradingStore`)
- **UI Components:** `lucide-react` for icons, `react-textarea-autosize`, and `lightweight-charts` (v5+) for live market data.

### Backend & Infrastructure
- **Hosting / CI-CD:** Vercel (Edge & Node.js runtimes) with Vercel Cron Jobs, using Upstash QStash.
- **Database:** Supabase (PostgreSQL + `pgvector` for RAG/vector memory)
- **Cache / Short-Term Memory:** Upstash Redis (rolling 14-message chat history per user)
- **Background Jobs:** Upstash QStash (async AI task offloading to prevent Telegram webhook timeouts)
- **Proxy/Networking:** Local V2Ray/Nekobox proxy (port 2080) for bypassing regional blocks (bypassing Next.js `undici` bugs via native Node `https`).
- **Version Control:** GitHub (`farzinkamrany/ultron` - strictly uses `master` branch)

### AI & Integrations
- **Primary AI:** Google Gemini Pro/Flash via direct API (key rotation across 3 keys)
- **Voice:** Telegram Native Voice Notes (OpenAI TTS `onyx` voice, auto-detecting English/Persian).
- **Telegram:** Custom webhook at `/api/telegram/webhook` (Bot: `@Ultron_viperbot`)
- **Market Data:** CCXT for OHLCV, CoinEx + Bybit WebSocket order books.
- **Scraper:** Divar.ir arbitrage scanner with proxy rotation

---

## 📁 Key File Map

```
src/
├── app/
│   ├── page.tsx                          # Main chat UI
│   ├── trading/page.tsx                  # Live order book / trading UI
│   ├── dashboard/trading/page.tsx        # PnL Visualizer
│   └── api/
│       ├── telegram/
│       │   ├── webhook/route.ts          # Telegram webhook (instant reply + QStash offload)
│       │   └── ai-worker/route.ts        # QStash worker: AI processing + TTS Voice Notes
│       ├── chat/route.ts                 # Web chat endpoint
│       └── cron/
│           ├── route.ts                  # Autonomous Analyst (Gann Math + CCXT)
│           ├── trading/route.ts          # Trading engine cron
│           ├── trading-checker/route.ts  # Paper trade evaluator
│           ├── memory-prune/route.ts     # Memory cleanup cron
│           ├── reflect/route.ts          # Nightly self-reflection
│           └── arbitrage/route.ts        # Divar arbitrage scanner
├── components/
│   ├── charts/EquityCurve.tsx            # Lightweight-charts v5 PnL visualizer
│   └── TelegramProvider.tsx              # TWA theme sync
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
│   ├── audio.ts                          # TTS logic (native https + Proxy)
│   └── trading/                          # Gann trading engine
└── hooks/
    └── useOrderBook.ts                   # WebSocket order book hook
```

---

## 🔄 Telegram Bot Architecture (v4.0)

To prevent Telegram's 10-second webhook timeout from silencing the bot on long AI queries:

```
User Message → Telegram → /api/telegram/webhook (returns 200 OK instantly)
                                    ↓ publishes to QStash
                            QStash → /api/telegram/ai-worker (60s budget)
                                            ↓ Gemini AI + Tool calls
                                            ↓ TTS Generation via native HTTPS
                                       Telegram API → User Phone
```

**Instant commands** (handled directly in webhook, no AI): `/dashboard`, `/model`, `/spend`

---

## 🌍 Environment Variables Required

| Variable | Purpose |
|---|---|
| `HTTP_PROXY` / `HTTPS_PROXY` | Local V2Ray Proxy URL (e.g. `http://127.0.0.1:2080`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot auth |
| `TELEGRAM_CHAT_ID` | Allowed chat IDs (comma separated) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API (primary) |
| `OPENAI_API_KEY` | OpenAI API (For high-quality TTS voice notes) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `UPSTASH_REDIS_REST_URL` | Redis connection |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth |
| `QSTASH_TOKEN` | QStash publishing key |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash signature verification |
| `GITHUB_PAT` | GitHub personal access token |
| `GITHUB_OWNER` / `GITHUB_REPO` | Repo for `read_source_code` / `write_and_propose_code` |
| `CRON_SECRET` | Auth header for cron endpoints |

---

## ✅ Current System Status (v4.0 - 2026-09-01)

| Feature | Status |
|---|---|
| Telegram bot (AI responses) | ✅ Live — QStash async pattern |
| Telegram Voice Notes | ✅ Live — OpenAI TTS `onyx` (Auto-detects EN/FA) |
| PnL Visualizer (`/dashboard/trading`) | ✅ Live — Upgraded to lightweight-charts v5 |
| Autonomous Crypto Analyst | ✅ Live — W.D. Gann Math on real-time price |
| Local Proxy Networking | ✅ Stabilized — Native `https` circumvents Next.js `undici` bugs |
| GitHub Autonomous PRs | ✅ Live — Configured to exclusively target `master` branch |
| OwnTracks GPS tracking | ✅ Live |
| Divar arbitrage scanner | ✅ Live |
| Nightly self-reflection cron | ✅ Scheduled |
| Live Trading (Bybit Micro) | ⏳ Planned (Berlin Objective) |

---

## 🔧 Useful Debug Scripts (`/scratch`)

| Script | Purpose |
|---|---|
| `scratch/fix-webhook.js` | Clear stuck pending updates + re-register webhook |
| `scratch/check-webhook.js` | Inspect webhook status and pending update count |
| `scratch/test-telegram.js` | Send a test message to verify bot connectivity |
| `scratch/test-bybit.js` | Test Bybit API connection |
| `scratch/test-coinex.js` | Test CoinEx API connection |
