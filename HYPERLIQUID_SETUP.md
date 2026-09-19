# ULTRON HYPERLIQUID INTEGRATION GUIDE

## Quick Start

### Step 1: Get Hyperliquid API Keys (Testnet)

**Hyperliquid Testnet:**
1. Go to: https://app.hyperliquid-testnet.xyz
2. Create account (or use existing)
3. Settings → API → Create Key
4. Save:
   - API Key
   - API Secret
   - Wallet Address

### Step 2: Set Environment Variables

Create `.env` file in project root:

```bash
# .env
HYPERLIQUID_API_KEY=your_api_key_here
HYPERLIQUID_API_SECRET=your_api_secret_here
HYPERLIQUID_WALLET=your_wallet_address_here
HYPERLIQUID_TESTNET=true
```

### Step 3: Install Dependencies (if needed)

```bash
npm install dotenv
```

### Step 4: Load Environment

Update your orchestrator:

```typescript
import * as dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.HYPERLIQUID_API_KEY!;
const apiSecret = process.env.HYPERLIQUID_API_SECRET!;
const wallet = process.env.HYPERLIQUID_WALLET!;
```

---

## API Connector Usage

### Basic Setup

```typescript
import HyperliquidConnector from './src/hyperliquid_connector';

const connector = new HyperliquidConnector({
    apiKey: 'your_key',
    apiSecret: 'your_secret',
    wallet: 'your_wallet',
    testnet: true  // Use testnet
});
```

### Common Operations

**Check Balance:**
```typescript
const balance = await connector.getBalance();
console.log(`Balance: $${balance}`);
```

**Get Positions:**
```typescript
const positions = await connector.getPositions();
for (const coin in positions) {
    console.log(`${coin}: $${positions[coin].positionValue}`);
}
```

**Place Market Buy:**
```typescript
const orderId = await connector.buyMarket('BTC', 100);  // $100 BTC
if (orderId) console.log('Order placed:', orderId);
```

**Place Market Sell:**
```typescript
const orderId = await connector.sellMarket('ETH', 50);  // $50 ETH
if (orderId) console.log('Order placed:', orderId);
```

**Place Limit Order:**
```typescript
const orderId = await connector.placeLimit(
    'SOL',
    'buy',
    50,     // $50
    150.00  // @ $150 per SOL
);
```

**Cancel Order:**
```typescript
const success = await connector.cancelOrder(orderId);
```

**Get Order Status:**
```typescript
const status = await connector.getOrderStatus(orderId);
console.log(status);
```

**Get Market Data:**
```typescript
const data = await connector.getMarketData('BTC');
console.log(`BTC Bid: $${data.bid}, Ask: $${data.ask}`);
```

**Batch Market Data:**
```typescript
const symbols = ['BTC', 'ETH', 'SOL'];
const data = await connector.getMultipleMarketData(symbols);
```

---

## Live Orchestrator Bridge

### Start Trading (Demo Mode)

```bash
node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs scripts/orchestrator_live_bridge.ts
```

**What it does:**
1. ✅ Connect to Hyperliquid
2. ✅ Check balance
3. ✅ Demo: Activate BTC grid ($100)
4. ✅ Place buy/sell orders
5. ✅ Monitor for 10 iterations (30s each)
6. ✅ Save trade log

### Output Example

```
🔧 ULTRON LIVE ORCHESTRATOR - Initialization
=====================================================

✅ Hyperliquid API connected
✅ Starting Balance: $1000.00
✅ Current Positions: 2 symbols
   BTC: $500.00
   ETH: $300.00

✅ Orchestrator ready for trading!

🚀 Starting Trading Loop...

🎯 Activating Grid for BTC @ $45000
🤖 BTC - Placing BUY orders (15 levels)...
✅ BUY BTC: $50 | Order ID: abc123
✅ BUY BTC: $49 | Order ID: def456
...
📊 LIVE STATS
=====================================================
Starting Balance: $1000.00
Current Balance:  $1010.50
Net Profit:       $10.50 (1.05%)
Open Orders:      28
Active Grids:     1
=====================================================
```

---

## Integration with v5.12_bear

### Full Automation (Next Phase)

Once tested, create full bridge:

```typescript
// orchestrator_v5_12_bear_live.ts
// Combines:
// 1. v5.12_bear logic (signal generation)
// 2. Hyperliquid connector (order execution)
// 3. Real-time monitoring

// Reads historical data for regime detection
// Generates grid signals
// Executes on Hyperliquid in real-time
// 24/7 automated trading
```

---

## Safety Features

### Emergency Stop

```typescript
// Cancel all orders immediately
await orchestrator.emergencyStop();
```

### Order Validation

All orders are:
- ✅ Size-validated
- ✅ Price-checked
- ✅ Nonce-signed
- ✅ Logged

### Position Monitoring

```typescript
// Check position at any time
const positions = await connector.getPositions();
if (positions['BTC'].unrealizedPnl < -500) {
    console.error('⚠️ BTC losses > $500!');
    await orchestrator.emergencyStop();
}
```

---

## Monitoring & Logs

### Trade Logs

Located in: `trade_logs/ultron_TIMESTAMP.json`

Contains:
- All orders placed
- Fills and cancellations
- Timestamps
- Order IDs

### P&L Tracking

Real-time P&L printed every 5 trading iterations:
- Starting balance
- Current balance
- Net profit $
- Net profit %
- Active orders
- Active grids

---

## FAQ

**Q: Is this testnet only?**
A: Yes! Start with testnet (`HYPERLIQUID_TESTNET=true`). Move to mainnet only after 1-2 weeks of successful paper trading.

**Q: How much capital needed?**
A: Start with $1K testnet. Move to $1K real only if bactest results match paper results.

**Q: What if orders fail?**
A: All failures are logged. Orders retry automatically or manual intervention via `emergencyStop()`.

**Q: Can I modify grid parameters?**
A: Yes! All parameters in `getYearConfig()` of v5.12_bear can be adjusted before activation.

---

## Next Steps

1. ✅ Set up environment variables
2. ✅ Run demo mode: `orchestrator_live_bridge.ts`
3. ✅ Verify balance updates
4. ✅ Test grid activation
5. ✅ Monitor for 1 hour
6. ✅ Check trade log
7. ⏭️ If all good: Integrate v5.12_bear logic
8. ⏭️ 24/7 automated trading

---

## Support

- Hyperliquid Docs: https://hyperliquid.gitbook.io/hyperliquid-api-documentation
- Testnet: https://app.hyperliquid-testnet.xyz
- API Status: https://status.hyperliquid.xyz
