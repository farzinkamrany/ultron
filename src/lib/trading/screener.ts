import ccxt from "ccxt";

/**
 * Dynamically screens the market to find the top 10 best coins to trade.
 * Filters by highest liquidity (Quote Volume) and then sorts by highest volatility (24h Price Change %).
 */
export async function getTopVolatileSymbols(): Promise<string[]> {
    try {
        const exchange = new ccxt.kucoin({ enableRateLimit: true });
        
        // Fetch all tickers in 1 API call
        const tickers = await exchange.fetchTickers();
        
        // 1. Filter valid USDT pairs (exclude stablecoins & leveraged tokens)
        const validTickers = Object.values(tickers).filter(t => {
            if (!t || !t.symbol) return false;
            if (!t.symbol.endsWith('/USDT')) return false;
            const base = t.symbol.split('/')[0];
            const excludedBase = ['USDC', 'DAI', 'TUSD', 'BUSD', 'FDUSD', 'EUR', 'GBP'];
            if (excludedBase.includes(base)) return false;
            if (base.includes('DOWN') || base.includes('UP') || base.includes('BULL') || base.includes('BEAR')) return false;
            return true;
        });

        // 2. Sort by Quote Volume to get the top 50 most liquid coins
        const liquidTickers = validTickers
            .sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0))
            .slice(0, 50);

        // 3. Sort those top 50 by absolute 24h percentage change (most volatile)
        const volatileTickers = liquidTickers
            .sort((a, b) => Math.abs(b.percentage || 0) - Math.abs(a.percentage || 0))
            .slice(0, 10);

        const symbols = volatileTickers.map(t => t.symbol as string);
        
        // Always ensure BTC and ETH are included for stability
        if (!symbols.includes('BTC/USDT')) symbols[9] = 'BTC/USDT';
        if (!symbols.includes('ETH/USDT')) symbols[8] = 'ETH/USDT';

        return symbols;
    } catch (error: any) {
        console.error(`[Screener] Failed to fetch dynamic symbols: ${error.message}`);
        // Fallback to defaults
        return ["BTC/USDT", "ETH/USDT", "SOL/USDT", "LINK/USDT", "ADA/USDT", "BNB/USDT", "XRP/USDT", "DOGE/USDT", "AVAX/USDT", "DOT/USDT"];
    }
}
