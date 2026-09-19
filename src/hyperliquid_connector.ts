/**
 * ULTRON HYPERLIQUID API CONNECTOR
 * Handles all Hyperliquid REST/WebSocket operations
 * v5.12_bear → Hyperliquid Bridge
 */

import * as https from 'https';
import * as crypto from 'crypto';

interface HyperliquidConfig {
    apiKey: string;
    apiSecret: string;
    wallet: string;
    testnet: boolean;
}

interface PlaceOrderParams {
    symbol: string;
    side: 'A' | 'B';  // A=Ask(sell), B=Bid(buy)
    size: number;
    price?: number;
    orderType: 'Limit' | 'Market';
}

interface OrderResponse {
    status: 'ok' | 'error';
    response: {
        type: 'order';
        data: {
            orderId: string;
            status: string;
        };
    };
}

class HyperliquidConnector {
    private config: HyperliquidConfig;
    private baseUrl: string;
    private nonce: number = 0;

    constructor(config: HyperliquidConfig) {
        this.config = config;
        this.baseUrl = config.testnet
            ? 'https://testnet.hyperliquid.xyz'
            : 'https://api.hyperliquid.xyz';
    }

    /**
     * Generate authentication signature
     */
    private generateSignature(payload: string): string {
        return crypto
            .createHmac('sha256', this.config.apiSecret)
            .update(payload)
            .digest('hex');
    }

    /**
     * Make authenticated REST request
     */
    private async makeRequest(
        method: string,
        path: string,
        body?: any
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            const url = new URL(this.baseUrl + path);
            
            this.nonce++;
            const timestamp = Date.now().toString();
            
            const payload = body 
                ? JSON.stringify(body)
                : '';

            const signature = this.generateSignature(payload);

            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-HL-API-Key': this.config.apiKey,
                    'X-HL-Signature': signature,
                    'X-HL-Timestamp': timestamp,
                },
            };

            const req = https.request(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
            });

            req.on('error', reject);
            if (body) req.write(JSON.stringify(body));
            req.end();
        });
    }

    /**
     * Get account balance
     */
    async getBalance(): Promise<number> {
        try {
            const response = await this.makeRequest('GET', '/info');
            if (response.balances && response.balances.length > 0) {
                return parseFloat(response.balances[0].total);
            }
            return 0;
        } catch (error) {
            console.error('❌ Failed to get balance:', error);
            return 0;
        }
    }

    /**
     * Get current positions for all symbols
     */
    async getPositions(): Promise<Record<string, any>> {
        try {
            const response = await this.makeRequest('GET', '/info');
            const positions: Record<string, any> = {};
            
            if (response.assetPositions) {
                for (const pos of response.assetPositions) {
                    positions[pos.coin] = {
                        coin: pos.coin,
                        positionValue: pos.positionValue,
                        leverage: pos.leverage,
                        unrealizedPnl: pos.unrealizedPnl,
                    };
                }
            }
            return positions;
        } catch (error) {
            console.error('❌ Failed to get positions:', error);
            return {};
        }
    }

    /**
     * Place market buy order
     */
    async buyMarket(symbol: string, sizeUsd: number): Promise<string | null> {
        try {
            const body = {
                action: 'order',
                orders: [
                    {
                        coin: symbol,
                        isPositionTaker: true,
                        limitPx: 0,  // Market order
                        orderType: 'Market',
                        side: 'B',   // Buy
                        sz: sizeUsd / 10000,  // Convert USD to contract size
                    },
                ],
                groupParentOrder: false,
            };

            const response = await this.makeRequest('POST', '/order', body);
            
            if (response.status === 'ok' && response.response.data.orderId) {
                console.log(`✅ BUY ${symbol}: $${sizeUsd} | Order ID: ${response.response.data.orderId}`);
                return response.response.data.orderId;
            } else {
                console.error(`❌ Buy failed for ${symbol}:`, response);
                return null;
            }
        } catch (error) {
            console.error(`❌ Buy order error for ${symbol}:`, error);
            return null;
        }
    }

    /**
     * Place market sell order
     */
    async sellMarket(symbol: string, sizeUsd: number): Promise<string | null> {
        try {
            const body = {
                action: 'order',
                orders: [
                    {
                        coin: symbol,
                        isPositionTaker: true,
                        limitPx: 0,  // Market order
                        orderType: 'Market',
                        side: 'A',   // Sell
                        sz: sizeUsd / 10000,
                    },
                ],
                groupParentOrder: false,
            };

            const response = await this.makeRequest('POST', '/order', body);
            
            if (response.status === 'ok' && response.response.data.orderId) {
                console.log(`✅ SELL ${symbol}: $${sizeUsd} | Order ID: ${response.response.data.orderId}`);
                return response.response.data.orderId;
            } else {
                console.error(`❌ Sell failed for ${symbol}:`, response);
                return null;
            }
        } catch (error) {
            console.error(`❌ Sell order error for ${symbol}:`, error);
            return null;
        }
    }

    /**
     * Place limit order
     */
    async placeLimit(
        symbol: string,
        side: 'buy' | 'sell',
        sizeUsd: number,
        price: number
    ): Promise<string | null> {
        try {
            const body = {
                action: 'order',
                orders: [
                    {
                        coin: symbol,
                        isPositionTaker: false,
                        limitPx: price,
                        orderType: 'Limit',
                        side: side === 'buy' ? 'B' : 'A',
                        sz: sizeUsd / 10000,
                    },
                ],
                groupParentOrder: false,
            };

            const response = await this.makeRequest('POST', '/order', body);
            
            if (response.status === 'ok' && response.response.data.orderId) {
                console.log(`✅ LIMIT ${side.toUpperCase()} ${symbol} @ ${price}: $${sizeUsd}`);
                return response.response.data.orderId;
            } else {
                console.error(`❌ Limit order failed for ${symbol}:`, response);
                return null;
            }
        } catch (error) {
            console.error(`❌ Limit order error for ${symbol}:`, error);
            return null;
        }
    }

    /**
     * Cancel order by ID
     */
    async cancelOrder(orderId: string): Promise<boolean> {
        try {
            const body = {
                action: 'cancel',
                orderId,
            };

            const response = await this.makeRequest('POST', '/order', body);
            
            if (response.status === 'ok') {
                console.log(`✅ Cancelled order: ${orderId}`);
                return true;
            } else {
                console.error(`❌ Cancel failed for ${orderId}:`, response);
                return false;
            }
        } catch (error) {
            console.error(`❌ Cancel error for ${orderId}:`, error);
            return false;
        }
    }

    /**
     * Get order status
     */
    async getOrderStatus(orderId: string): Promise<any> {
        try {
            const response = await this.makeRequest('GET', `/order/${orderId}`);
            return response;
        } catch (error) {
            console.error(`❌ Failed to get order status for ${orderId}:`, error);
            return null;
        }
    }

    /**
     * Get market data (prices)
     */
    async getMarketData(symbol: string): Promise<any> {
        try {
            const response = await this.makeRequest('GET', `/ticker?coin=${symbol}`);
            if (response) {
                return {
                    symbol,
                    bid: parseFloat(response.bid),
                    ask: parseFloat(response.ask),
                    mid: (parseFloat(response.bid) + parseFloat(response.ask)) / 2,
                    timestamp: Date.now(),
                };
            }
            return null;
        } catch (error) {
            console.error(`❌ Failed to get market data for ${symbol}:`, error);
            return null;
        }
    }

    /**
     * Batch get market data for multiple symbols
     */
    async getMultipleMarketData(symbols: string[]): Promise<Record<string, any>> {
        const results: Record<string, any> = {};
        
        for (const sym of symbols) {
            const data = await this.getMarketData(sym);
            if (data) results[sym] = data;
        }
        
        return results;
    }

    /**
     * Health check
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await this.makeRequest('GET', '/info');
            return response && response.balances !== undefined;
        } catch (error) {
            console.error('❌ Health check failed:', error);
            return false;
        }
    }
}

export default HyperliquidConnector;
