import ccxt from 'ccxt';

async function fetchPrice() {
  const exchange = new ccxt.binance();
  try {
    const ticker = await exchange.fetchTicker('FET/USDT');
    console.log(`Current FET/USDT price: ${ticker.last}`);
    return ticker.last;
  } catch (error) {
    console.error('Error fetching price:', error);
  }
}

fetchPrice();
