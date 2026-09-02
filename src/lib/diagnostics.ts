import { supabase } from '@/lib/supabase';
import { redis } from '@/lib/redis';
import { generateAIResponse } from '@/lib/ai';
import ccxt from 'ccxt';

export async function runSystemDiagnostics(): Promise<string> {
  const report: string[] = ["⚙️ **System Diagnostics Report** ⚙️\n"];
  let overallHealthy = true;

  // 1. Check Bybit
  try {
    const start = Date.now();
    const bybit = new ccxt.bybit({ enableRateLimit: false });
    await bybit.fetchTime();
    const duration = Date.now() - start;
    report.push(`✅ **Bybit API**: OK (${duration}ms)`);
  } catch (e: any) {
    overallHealthy = false;
    report.push(`❌ **Bybit API**: FAILED - ${e.message}`);
  }

  // 2. Check Supabase
  try {
    const start = Date.now();
    // A lightweight ping query
    const { error } = await supabase.from('users').select('id').limit(1);
    const duration = Date.now() - start;
    if (error) {
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        report.push(`✅ **Supabase DB**: OK (Table missing, but connected)`);
      } else {
        throw error;
      }
    } else {
      report.push(`✅ **Supabase DB**: OK (${duration}ms)`);
    }
  } catch (e: any) {
    overallHealthy = false;
    report.push(`❌ **Supabase DB**: FAILED - ${e.message || JSON.stringify(e)}`);
  }

  // 3. Check Upstash Redis
  try {
    const start = Date.now();
    await redis.ping();
    const duration = Date.now() - start;
    report.push(`✅ **Upstash Redis**: OK (${duration}ms)`);
  } catch (e: any) {
    overallHealthy = false;
    report.push(`❌ **Upstash Redis**: FAILED - ${e.message}`);
  }

  // 4. Check Gemini AI
  try {
    const start = Date.now();
    // A very fast prompt to check API responsiveness
    await generateAIResponse([{ role: 'user', content: 'Ping! Reply with Pong.' }], false, false);
    const duration = Date.now() - start;
    report.push(`✅ **Gemini AI**: OK (${duration}ms)`);
  } catch (e: any) {
    overallHealthy = false;
    report.push(`❌ **Gemini AI**: FAILED - ${e.message}`);
  }

  report.push(`\n**Overall Status**: ${overallHealthy ? '🟢 ALL SYSTEMS OPERATIONAL' : '🔴 ACTION REQUIRED'}`);
  return report.join('\n');
}
