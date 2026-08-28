import https from "https";

export interface DivarAd {
  token: string;
  title: string;
  description: string;
  price: number;
  url: string;
}

/**
 * Fetches recent ads from Divar.
 * IMPORTANT: This uses direct https.request WITHOUT proxy,
 * because Divar is an Iranian domain and blocks foreign proxy IPs.
 */
export async function fetchDivarAds(city: string, category: string): Promise<DivarAd[]> {
  const apiUrl = `https://api.divar.ir/v8/web-search/${city}/${category}`;

  const fetchOptions: RequestInit = {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
    // Explicitly NO agent to bypass the global proxy for this Iranian domain
  };

  try {
    const response = await fetch(apiUrl, fetchOptions);
    if (!response.ok) {
      const errData = await response.text();
      throw new Error(`Divar API Error ${response.status}: ${errData}`);
    }

    const json = await response.json();
    const ads: DivarAd[] = [];
    
    // Divar's payload structure varies, this is a standard parsing approach
    const widgetList = json?.widget_list || [];
    for (const widget of widgetList) {
      const dataObj = widget?.data;
      if (dataObj && dataObj.token && dataObj.title) {
        // Price parsing (Divar sometimes returns price in string with formatting)
        let priceStr = dataObj.middle_description_text || "";
        let price = 0;
        // Very basic extraction, real world requires regex for "تومان"
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
    throw new Error(error.message || "Divar Request failed");
  }
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
