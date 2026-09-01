import { HttpsProxyAgent } from 'https-proxy-agent';
import axios from 'axios';

export async function fetchMarketData(asset: string) {
  const proxy = process.env.HTTP_PROXY;
  const config = proxy ? { httpsAgent: new HttpsProxyAgent(proxy) } : {};

  try {
    const response = await axios.get(`https://api.exchange.com/v1/ticker?symbol=${asset}`, config);
    return response.data;
  } catch (error) {
    console.error('Market Data Fetch Error:', error);
    throw new Error('Failed to fetch market data');
  }
}
