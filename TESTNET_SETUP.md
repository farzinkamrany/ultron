# HYPERLIQUID TESTNET SETUP (5 MINUTES)

## Step 1️⃣: Get API Keys from Hyperliquid

```
Go to: https://app.hyperliquid-testnet.xyz
Settings → API
Create New Key
Copy:
  - API Key
  - API Secret
  - Your Wallet Address
```

## Step 2️⃣: Create .env File

```bash
# Copy the template
cp .env.example .env

# Edit .env with your credentials
# Your text editor or:
nano .env
```

**Fill in:**
```
HYPERLIQUID_API_KEY=your_api_key_here
HYPERLIQUID_API_SECRET=your_api_secret_here
HYPERLIQUID_WALLET=your_wallet_address_here
HYPERLIQUID_TESTNET=true
```

✅ Save file (Ctrl+S or Cmd+S)

## Step 3️⃣: Run Trading Bot

```bash
node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs scripts/orchestrator_live_bridge.ts
```

## Expected Output:

```
✅ .env loaded successfully

✅ Credentials loaded from .env
   Network: TESTNET

🔧 ULTRON LIVE ORCHESTRATOR - Initialization
✅ Hyperliquid API connected
✅ Starting Balance: $1000.00

🚀 Starting Trading Loop...
🎯 Activating Grid for BTC @ $45000
✅ BUY BTC: $50 | Order ID: abc123
...
```

## 🔒 Security Notes

- ✅ `.env` is in `.gitignore` (never committed)
- ✅ API key stays on your machine
- ✅ Only testnet (safe to test)
- ✅ Can add IP whitelist in Hyperliquid settings

## ❓ If errors occur:

Check credentials are correct in .env:
```bash
cat .env
```

Verify format (no extra spaces):
```
KEY=value
# NOT: KEY = value
# NOT: KEY=value  (with trailing spaces)
```

---

**Ready? Run Step 3 now! ⚡**
