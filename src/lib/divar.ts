import https from "https";
import { ProxyAgent } from "undici";
import { sendTelegramMessage } from "@/lib/telegram";

export interface DivarAd {
  token: string;
  title: string;
  description: string;
  price: number;
  url: string;
}

/**
 * Fetches recent ads from Divar with Proxy Rotation.
 * Divar is an Iranian domain and often blocks foreign IPs (Vercel) or rate-limits them.
 */
export async function fetchDivarAds(city: string, category: string): Promise<DivarAd[]> {
  const apiUrl = `https://api.divar.ir/v8/web-search/${city}/${category}`;

  const proxiesStr = process.env.DIVAR_PROXIES || "";
  const proxies = proxiesStr.split(",").map(p => p.trim()).filter(Boolean);
  
  // If no proxies defined, at least try a direct connection (null) once
  if (proxies.length === 0) {
    proxies.push("");
  }

  let lastError = null;

  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    
    const fetchOptions: any = {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    };

    if (proxy) {
      fetchOptions.dispatcher = new ProxyAgent(proxy);
    }

    try {
      const response = await fetch(apiUrl, fetchOptions);
      if (!response.ok) {
        const errData = await response.text();
        if (response.status === 403 || response.status === 429) {
          console.warn(`[Divar Scraper] Proxy ${proxy || 'Direct'} blocked by Divar with ${response.status}. Rotating...`);
          lastError = new Error(`Divar API Error ${response.status}: ${errData}`);
          continue; // Try next proxy
        }
        throw new Error(`Divar API Error ${response.status}: ${errData}`);
      }

      const json = await response.json();
      const ads: DivarAd[] = [];
      
      const widgetList = json?.widget_list || [];
      for (const widget of widgetList) {
        const dataObj = widget?.data;
        if (dataObj && dataObj.token && dataObj.title) {
          let priceStr = dataObj.middle_description_text || "";
          let price = 0;
          if (priceStr.includes("تومان")) {
            const numericStr = priceStr.replace(/[^0-9]/g, "");
            if (numericStr) price = parseInt(numericStr, 10);
          }
          
          if (price > 0) {
            ads.push({
              token: dataObj.token,
              title: dataObj.title,
              description: dataObj.description || "",
              price,
              url: `https://divar.ir/v/${dataObj.token}`
            });
          }
        }
      }
      return ads;
    } catch (error: any) {
      lastError = error;
      console.warn(`[Divar Scraper] Proxy ${proxy || 'Direct'} failed with error: ${error.message}. Rotating...`);
      continue;
    }
  }

  // If we exhaust all proxies
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (chatId) {
    await sendTelegramMessage(chatId, `🚨 <b>DIVAR SCRAPER BLOCKED</b> 🚨\n\nAll proxies have been blocked (403/429) or failed. Please update the DIVAR_PROXIES environment variable.\n\nLast Error: ${lastError?.message || "Unknown"}`);
  }

  throw new Error(`All Divar requests failed. Last error: ${lastError?.message || "Unknown"}`);
}

/**
 * Z-Score Calculation for Arbitrage Detection
 * z = (X - μ) / σ
 */
export function detectArbitrageOpportunities(ads: DivarAd[]): DivarAd[] {
  if (ads.length < 5) return [];

  // 1. Calculate Mean (μ)
  const sum = ads.reduce((acc, ad) => acc + ad.price, 0);
  const mean = sum / ads.length;

  // 2. Calculate Standard Deviation (σ)
  const squaredDiffs = ads.map(ad => Math.pow(ad.price - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / ads.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return [];

  const opportunities: DivarAd[] = [];

  // 3. Find Outliers (Z-score < -1.5 indicates significantly underpriced)
  for (const ad of ads) {
    const zScore = (ad.price - mean) / stdDev;
    // -1.5 is a standard threshold. You can adjust it.
    if (zScore < -1.5) {
      opportunities.push(ad);
    }
  }

  return opportunities;
}
