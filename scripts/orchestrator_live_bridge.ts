/**
 * ULTRON LIVE ORCHESTRATOR BRIDGE
 * Executes v5.12_bear signals on Hyperliquid
 * Real-time grid trading automation
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env file
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value && !key.startsWith('#')) {
            process.env[key.trim()] = value.trim();
        }
    });
    console.log('✅ .env loaded successfully\n');
} else {
    console.warn('⚠️  .env file not found. Using system environment variables.\n');
}

import HyperliquidConnector from '../src/hyperliquid_connector';
import * as readline from 'readline';

interface MultiCandle {
    symbol: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface GridLevel { 
    price: number; 
    type: 'BUY' | 'SELL'; 
    active: boolean; 
    orderId?: string;
}

interface SymbolState {
    symbol: string;
    gridActive: boolean;
    grid: GridLevel[];
    positionCoins: number;
    avgEntryPrice: number;
    orderSizeUSD: number;
    gridStep: number;
    realizedPnl: number;
    openOrderIds: string[];
}

class UltronLiveOrchestrator {
    private connector: HyperliquidConnector;
    private states: Record<string, SymbolState> = {};
    private startBalance: number = 0;
    private currentBalance: number = 0;
    private tradeLog: any[] = [];
    private symbols = ['BTC', 'ETH', 'SOL', 'LINK', 'ADA', 'DOGE', 'BNB', 'XRP', 'DOT', 'AVAX'];

    constructor(apiKey: string, apiSecret: string, wallet: string, testnet: boolean = true) {
        this.connector = new HyperliquidConnector({
            apiKey,
            apiSecret,
            wallet,
            testnet,
        });

        // Initialize state for each symbol
        for (const sym of this.symbols) {
            this.states[sym] = {
                symbol: sym,
                gridActive: false,
                grid: [],
                positionCoins: 0,
                avgEntryPrice: 0,
                orderSizeUSD: 0,
                gridStep: 0,
                realizedPnl: 0,
                openOrderIds: [],
            };
        }
    }

    /**
     * Initialize connection and get starting balance
     */
    async initialize(): Promise<boolean> {
        console.log('🔧 ULTRON LIVE ORCHESTRATOR - Initialization');
        console.log('=====================================================\n');

        try {
            // Health check
            const isHealthy = await this.connector.healthCheck();
            if (!isHealthy) {
                console.error('❌ Hyperliquid connection failed');
                return false;
            }
            console.log('✅ Hyperliquid API connected');

            // Get starting balance
            this.startBalance = await this.connector.getBalance();
            this.currentBalance = this.startBalance;
            console.log(`✅ Starting Balance: $${this.startBalance.toFixed(2)}`);

            // Get current positions
            const positions = await this.connector.getPositions();
            console.log(`✅ Current Positions: ${Object.keys(positions).length} symbols`);
            for (const sym in positions) {
                console.log(`   ${sym}: $${positions[sym].positionValue}`);
            }

            console.log('\n✅ Orchestrator ready for trading!\n');
            return true;
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            return false;
        }
    }

    /**
     * Place buy orders for grid
     */
    async placeGridBuyOrders(symbol: string, gridLevels: GridLevel[]): Promise<void> {
        const state = this.states[symbol];
        const buyLevels = gridLevels.filter(g => g.type === 'BUY' && g.active);

        console.log(`\n🤖 ${symbol} - Placing BUY orders (${buyLevels.length} levels)...`);

        for (const level of buyLevels) {
            const orderId = await this.connector.placeLimit(
                symbol,
                'buy',
                state.orderSizeUSD * 0.5,  // Conservative position sizing
                level.price
            );

            if (orderId) {
                level.orderId = orderId;
                state.openOrderIds.push(orderId);
                this.tradeLog.push({
                    timestamp: Date.now(),
                    type: 'BUY_ORDER',
                    symbol,
                    price: level.price,
                    orderId,
                });
            }
        }
    }

    /**
     * Place sell orders for grid
     */
    async placeGridSellOrders(symbol: string, gridLevels: GridLevel[]): Promise<void> {
        const state = this.states[symbol];
        const sellLevels = gridLevels.filter(g => g.type === 'SELL' && g.active);

        console.log(`\n🤖 ${symbol} - Placing SELL orders (${sellLevels.length} levels)...`);

        for (const level of sellLevels) {
            const orderId = await this.connector.placeLimit(
                symbol,
                'sell',
                state.orderSizeUSD * 0.5,
                level.price
            );

            if (orderId) {
                level.orderId = orderId;
                state.openOrderIds.push(orderId);
                this.tradeLog.push({
                    timestamp: Date.now(),
                    type: 'SELL_ORDER',
                    symbol,
                    price: level.price,
                    orderId,
                });
            }
        }
    }

    /**
     * Monitor open orders and update positions
     */
    async monitorOrders(): Promise<void> {
        for (const sym in this.states) {
            const state = this.states[sym];
            const filledOrders = [];

            for (const orderId of state.openOrderIds) {
                const status = await this.connector.getOrderStatus(orderId);
                
                if (status && status.status === 'filled') {
                    filledOrders.push(orderId);
                    console.log(`✅ ${sym} ORDER FILLED: ${orderId}`);
                }
            }

            // Remove filled orders from tracking
            state.openOrderIds = state.openOrderIds.filter(
                id => !filledOrders.includes(id)
            );
        }
    }

    /**
     * Execute grid activation (from v5.12_bear logic)
     */
    async activateGrid(
        symbol: string,
        currentPrice: number,
        atrRange: number,
        capital: number
    ): Promise<void> {
        const state = this.states[symbol];
        
        if (state.gridActive) return;  // Grid already active

        console.log(`\n🎯 Activating Grid for ${symbol} @ $${currentPrice}`);

        const upperBound = currentPrice * (1 + atrRange);
        const lowerBound = currentPrice * (1 - atrRange);
        const GRID_LEVELS = 30;
        
        state.gridStep = (upperBound - lowerBound) / GRID_LEVELS;
        state.orderSizeUSD = capital / (GRID_LEVELS / 2);
        state.grid = [];

        // Build grid levels
        for (let i = 0; i <= GRID_LEVELS; i++) {
            const price = lowerBound + (i * state.gridStep);
            state.grid.push({
                price,
                type: price < currentPrice ? 'BUY' : 'SELL',
                active: true,
            });
        }

        state.gridActive = true;

        // Place initial orders
        await this.placeGridBuyOrders(symbol, state.grid);
        await this.placeGridSellOrders(symbol, state.grid);
    }

    /**
     * Get live P&L
     */
    async getLiveStats(): Promise<void> {
        this.currentBalance = await this.connector.getBalance();
        const positions = await this.connector.getPositions();

        const netProfit = this.currentBalance - this.startBalance;
        const profitPct = (netProfit / this.startBalance) * 100;

        console.log(`\n📊 LIVE STATS`);
        console.log(`=====================================================`);
        console.log(`Starting Balance: $${this.startBalance.toFixed(2)}`);
        console.log(`Current Balance:  $${this.currentBalance.toFixed(2)}`);
        console.log(`Net Profit:       $${netProfit.toFixed(2)} (${profitPct.toFixed(2)}%)`);
        console.log(`Open Orders:      ${Object.values(this.states).reduce((sum, s) => sum + s.openOrderIds.length, 0)}`);
        console.log(`Active Grids:     ${Object.values(this.states).filter(s => s.gridActive).length}`);
        console.log(`=====================================================\n`);
    }

    /**
     * Save trade log
     */
    saveTradeLog(): void {
        const filename = `trade_logs/ultron_${Date.now()}.json`;
        fs.mkdirSync('trade_logs', { recursive: true });
        fs.writeFileSync(filename, JSON.stringify(this.tradeLog, null, 2));
        console.log(`📝 Trade log saved: ${filename}`);
    }

    /**
     * Main trading loop (simplified for demo)
     */
    async tradingLoop(): Promise<void> {
        console.log('🚀 Starting Trading Loop...\n');

        let loopCount = 0;
        const maxLoops = 10;  // Demo: 10 iterations

        while (loopCount < maxLoops) {
            try {
                // Monitor orders every iteration
                await this.monitorOrders();

                // Get live stats every 5 iterations
                if (loopCount % 5 === 0) {
                    await this.getLiveStats();
                }

                // Wait before next iteration (demo: 30 seconds)
                console.log(`⏳ Waiting 30s before next cycle... (${loopCount + 1}/${maxLoops})`);
                await new Promise(resolve => setTimeout(resolve, 30000));

                loopCount++;
            } catch (error) {
                console.error('❌ Error in trading loop:', error);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Final stats and cleanup
        await this.getLiveStats();
        this.saveTradeLog();
        console.log('✅ Trading loop completed');
    }

    /**
     * Emergency stop - cancel all orders
     */
    async emergencyStop(): Promise<void> {
        console.log('🛑 EMERGENCY STOP - Cancelling all orders...');

        for (const sym in this.states) {
            const state = this.states[sym];
            for (const orderId of state.openOrderIds) {
                await this.connector.cancelOrder(orderId);
            }
            state.openOrderIds = [];
        }

        console.log('✅ All orders cancelled');
        await this.getLiveStats();
    }
}

// ============================================================
// MAIN EXECUTION
// ============================================================

async function main() {
    // Get credentials from environment
    const apiKey = process.env.HYPERLIQUID_API_KEY || '';
    const apiSecret = process.env.HYPERLIQUID_API_SECRET || '';
    const wallet = process.env.HYPERLIQUID_WALLET || '';
    const testnet = process.env.HYPERLIQUID_TESTNET !== 'false';

    // Validate credentials
    if (!apiKey || !apiSecret || !wallet) {
        console.error('\n❌ MISSING CREDENTIALS!\n');
        console.error('Please fill in .env file with your Hyperliquid testnet credentials:\n');
        console.error('   1. Copy .env.example to .env');
        console.error('   2. Fill in your values from: https://testnet.hyperliquid.xyz\n');
        console.error('Required variables:');
        if (!apiKey) console.error('   ❌ HYPERLIQUID_API_KEY');
        if (!apiSecret) console.error('   ❌ HYPERLIQUID_API_SECRET');
        if (!wallet) console.error('   ❌ HYPERLIQUID_WALLET\n');
        console.error('Current .env values:');
        console.error(`   HYPERLIQUID_API_KEY = ${apiKey ? '✅ SET' : '❌ MISSING'}`);
        console.error(`   HYPERLIQUID_API_SECRET = ${apiSecret ? '✅ SET' : '❌ MISSING'}`);
        console.error(`   HYPERLIQUID_WALLET = ${wallet ? '✅ SET' : '❌ MISSING'}`);
        console.error(`   HYPERLIQUID_TESTNET = ${testnet ? 'true (testnet)' : 'false (mainnet)'}\n`);
        process.exit(1);
    }

    console.log('✅ Credentials loaded from .env');
    console.log(`   Network: ${testnet ? 'TESTNET' : 'MAINNET'}\n`);

    const orchestrator = new UltronLiveOrchestrator(apiKey, apiSecret, wallet, testnet);

    // Initialize
    const ready = await orchestrator.initialize();
    if (!ready) process.exit(1);

    // Demo: Activate grid for BTC and start trading loop
    try {
        console.log('⚙️ Demo Mode: Preparing grid activation...\n');
        
        // Simulate grid activation
        await orchestrator.activateGrid('BTC', 45000, 0.08, 100);  // $100 allocated to BTC grid

        // Run trading loop
        await orchestrator.tradingLoop();
    } catch (error) {
        console.error('❌ Error during trading:', error);
        await orchestrator.emergencyStop();
    }
}

main().catch(console.error);
