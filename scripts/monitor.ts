import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';
import ccxt from 'ccxt';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

const exchange = new ccxt.hyperliquid();

async function main() {
  console.log('\n=========================================================');
  console.log(' 🛰️  ULTRON V5 - LIVE MONITORING DASHBOARD');
  console.log('=========================================================\n');

  // 1. Fetch CTO Status from Redis
  console.log('📊 Fetching CTO Status...');
  const ctoConfig: any = await redis.get('ultron_cto_config');
  if (ctoConfig) {
    console.log(`\x1b[36mCTO Risk Limit:\x1b[0m $${ctoConfig.maxRiskExposureUsd}`);
    console.log(`\x1b[36mGlobal Cooldown:\x1b[0m ${new Date(ctoConfig.globalCooldownUntil).toLocaleString()}`);
  } else {
    console.log('\x1b[33mCTO Config not found in Redis (System might be idle or waiting for first tick).\x1b[0m');
  }

  // 2. Fetch Open Paper Trades
  console.log('\n📈 Fetching Open Paper Trades...');
  const { data: openTrades, error } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching trades:', error.message);
    return;
  }

  if (!openTrades || openTrades.length === 0) {
    console.log('\x1b[32m\n✅ No open trades right now. Database is completely clean.\x1b[0m');
    console.log('Waiting for V5 Engine to find the next setup...\n');
    return;
  }

  // 3. Fetch live prices to calculate PNL
  console.log('\nFetching live prices for open positions from Hyperliquid...\n');
  const fetchSymbols = openTrades.map(t => `${t.symbol.split('/')[0]}/USDC:USDC`);
  const tickers = await exchange.fetchTickers(fetchSymbols);

  let totalUnrealizedPnl = 0;
  let totalMargin = 0;

  console.log(
    `\x1b[1m${'SYMBOL'.padEnd(12)} ${'STRATEGY'.padEnd(12)} ${'SIDE'.padEnd(6)} ${'ENTRY'.padEnd(10)} ${'CURRENT'.padEnd(10)} ${'SIZE($)'.padEnd(10)} ${'PNL($)'.padEnd(10)}\x1b[0m`
  );
  console.log('-'.repeat(80));

  for (const trade of openTrades) {
    const hyperSymbol = `${trade.symbol.split('/')[0]}/USDC:USDC`;
    const livePrice = tickers[hyperSymbol]?.last || trade.entry_price;
    const isLong = trade.position_type === 'LONG';
    
    // Simple PNL calculation
    const priceDiff = isLong ? (livePrice - trade.entry_price) : (trade.entry_price - livePrice);
    const pnlPct = priceDiff / trade.entry_price;
    const pnlUsd = trade.position_size_usd * pnlPct;

    totalUnrealizedPnl += pnlUsd;
    totalMargin += trade.position_size_usd;

    const pnlColor = pnlUsd >= 0 ? '\x1b[32m' : '\x1b[31m'; // Green or Red
    const sideColor = isLong ? '\x1b[32m' : '\x1b[31m';

    console.log(
      `${(trade.symbol || 'N/A').padEnd(12)} ` +
      `${(trade.strategy || 'N/A').padEnd(12)} ` +
      `${sideColor}${(trade.position_type || 'N/A').padEnd(6)}\x1b[0m ` +
      `${trade.entry_price.toFixed(4).padEnd(10)} ` +
      `${livePrice.toFixed(4).padEnd(10)} ` +
      `$${trade.position_size_usd.toFixed(2).padEnd(9)} ` +
      `${pnlColor}${pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)}\x1b[0m`
    );
  }

  console.log('-'.repeat(80));
  console.log(`\x1b[1mTOTAL MARGIN IN USE:\x1b[0m $${totalMargin.toFixed(2)}`);
  
  const totalPnlColor = totalUnrealizedPnl >= 0 ? '\x1b[32m' : '\x1b[31m';
  console.log(`\x1b[1mTOTAL UNREALIZED PNL:\x1b[0m ${totalPnlColor}${totalUnrealizedPnl >= 0 ? '+' : ''}$${totalUnrealizedPnl.toFixed(2)}\x1b[0m\n`);
}

main().catch(console.error);
