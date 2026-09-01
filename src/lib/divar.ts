import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Utility to convert Persian digits to English digits
const toEnglishDigits = (str: string) => {
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return str.replace(/[۰-۹]/g, (w) => persianDigits.indexOf(w).toString());
};

export interface DivarAd {
  token: string;
  title: string;
  price: number; // in Toman
  url: string;
  timeText: string;
}

export async function fetchDivarAds(city: string, category: string, query: string = ""): Promise<DivarAd[]> {
  let urlStr = `https://api.divar.ir/v8/web-search/${city}/${category}`;
  if (query) {
    urlStr += `?q=${encodeURIComponent(query)}`;
  }

  // Use specific DIVAR_PROXY if configured (useful when deployed on Vercel to route through Iran, separate from HTTPS_PROXY which routes to Europe)
  const proxyUrl = process.env.DIVAR_PROXY;
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

  const options: https.RequestOptions = {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
      'Origin': 'https://divar.ir',
      'Referer': 'https://divar.ir/'
    },
    agent: agent,
    timeout: 15000 // 15 seconds
  };

  return new Promise((resolve, reject) => {
    const req = https.request(urlStr, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Divar API HTTP Error ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
          return;
        }
        
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          const json = JSON.parse(body);
          
          const ads: DivarAd[] = [];
          
          // Divar V8 API structure usually puts ads in json.web_widgets.post_list
          const widgets = json?.web_widgets?.post_list || [];
          
          for (const widget of widgets) {
            if (widget.widget_type === 'POST_ROW') {
              const data = widget.data;
              if (!data) continue;
              
              const title = data.title;
              const token = data.token;
              const url = `https://divar.ir/v/${token}`;
              
              // Price is usually in middle_description_text or bottom_description_text
              const middleText = data.middle_description_text || "";
              const topText = data.top_description_text || "";
              const bottomText = data.bottom_description_text || "";
              
              const allText = `${middleText} ${bottomText} ${topText}`;
              
              // Skip "توافقی" or items without price
              if (allText.includes('توافقی') || allText.includes('معاوضه')) continue;
              
              // Extract price
              const priceMatch = allText.match(/([۰-۹,]+)\s*تومان/);
              if (priceMatch) {
                const priceStr = priceMatch[1];
                const engDigits = toEnglishDigits(priceStr).replace(/,/g, '');
                const price = parseInt(engDigits, 10);
                
                // Extremely low prices are usually fake/accessories (e.g. ps5 skin for 100k)
                if (price > 100000) {
                  ads.push({
                    token,
                    title,
                    price,
                    url,
                    timeText: topText
                  });
                }
              }
            }
          }
          
          resolve(ads);
        } catch (err) {
          reject(new Error(`Failed to parse Divar response: ${(err as Error).message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Divar Request Timeout'));
    });
    req.end();
  });
}

/**
 * Calculates Z-Score and finds severely underpriced items
 */
export function findArbitrageOpportunities(ads: DivarAd[], minZScore: number = -1.5) {
  if (ads.length < 5) return { mean: 0, opportunities: [] }; // Need a reasonable sample size

  // 1. Calculate Mean (Average)
  const prices = ads.map(a => a.price);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;

  // 2. Calculate Standard Deviation
  const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);

  // 3. Find Outliers (Z-Score)
  // Z-Score = (Price - Mean) / StdDev
  // A z-score of -1.5 means the price is 1.5 standard deviations BELOW the average (very cheap)
  
  const opportunities = ads.map(ad => {
    const zScore = (ad.price - mean) / stdDev;
    const profitMargin = mean - ad.price;
    const profitPercentage = (profitMargin / mean) * 100;
    
    return {
      ...ad,
      zScore,
      profitMargin,
      profitPercentage
    };
  }).filter(ad => ad.zScore <= minZScore && ad.profitPercentage > 10); // at least 10% cheaper and high z-score

  // Sort by highest profit margin
  opportunities.sort((a, b) => b.profitMargin - a.profitMargin);

  return {
    mean,
    stdDev,
    opportunities
  };
}
