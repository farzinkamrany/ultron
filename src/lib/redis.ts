import { Redis } from '@upstash/redis';
import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  ...(proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl.replace('localhost', '127.0.0.1')) } : {})
});
