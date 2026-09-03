import { ULTRON_SYSTEM_PROMPT } from "./prompt";
import { searchMemories } from "./memory";
import { ULTRON_TOOLS } from "./ai-tools";
import { getFileContent, writeAndProposeCode } from "@/services/github";
import { TradeSchema, TradeDecision } from "./validators";

export const DEV_MODE_PROMPT = `تو یک مهندس ارشد نرم‌افزار و همکار من هستی. تخصصت معماری‌های فرانت‌اند، Next.js، TypeScript، و مدیریت State (مانند Zustand و Redux) است. تمام قوانین ترید، Gann و SMC در این حالت غیرفعال هستند. لحن تو باید کاملاً همکارانه، کوتاه و مختص به حل مسئله مهندسی باشد.

[Telegram Code Formatter]
ارسال کدهای طولانی در تلگرام ممنوع است. فقط نقطه‌ی دقیقِ باگ (Diff) و نهایتاً ۱۵ خط کد بهینه‌شده را ارسال کن. توضیحات باید مستقیم و بدون حاشیه باشند.`;

export async function generateAIResponse(messages: { role: string, content: string, audio?: Buffer, image?: Buffer }[], stream = false, tryPro = true, persona: 'dev' | 'quant' = 'quant'): Promise<any> {
  const contents: any[] = messages
    .filter(m => (m.content && m.content.trim()) || m.audio || m.image)
    .map(msg => {
      const parts: any[] = [];
      if (msg.content && msg.content.trim()) parts.push({ text: msg.content });
      if (msg.audio) {
        parts.push({
          inlineData: {
            data: msg.audio.toString("base64"),
            mimeType: "audio/ogg"
          }
        });
      }
      if (msg.image) {
        parts.push({
          inlineData: {
            data: msg.image.toString("base64"),
            mimeType: "image/jpeg"
          }
        });
      }
      return {
        role: msg.role === "user" ? "user" : "model",
        parts,
      };
    });

  while (contents.length > 0 && contents[0].role === "model") {
    contents.shift();
  }

  if (contents.length === 0) throw new Error("No user messages provided");

  // RAG: Skip embedding for very short messages to save time, run it concurrently otherwise
  const latestUserMsg = contents.slice().reverse().find(m => m.role === "user")?.parts[0]?.text;
  let memoryContext = "";
  let memoryPromise: Promise<string> = Promise.resolve("");

  if (latestUserMsg && latestUserMsg.length > 10) {
    memoryPromise = searchMemories(latestUserMsg)
      .then((memories: any[]) => {
        if (memories && memories.length > 0) {
          return "\n\n[SYSTEM DIRECTIVE: RECALL PAST MEMORIES]\nBased on the user's query, here are relevant past events/decisions from your long-term vector memory. Use them to answer if applicable:\n"
            + memories.map((m: any) => `- ${m.content} (Match: ${(m.similarity * 100).toFixed(1)}%)`).join("\n");
        }
        return "";
      })
      .catch((e: any) => {
        console.error("Memory retrieval error:", e);
        return "";
      });
  }

  // Resolve memory context (with a 6s max wait so we don't blow the budget)
  try {
    memoryContext = await Promise.race([
      memoryPromise,
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 6000))
    ]);
  } catch (_) {}

  const { fetchWithRotation } = await import("@/utils/ai-fetcher");

  // Tool Execution Loop (max 15 iterations to allow deep research)
  const MAX_ITERATIONS = 15;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const currentTime = new Date().toISOString();
    const telegramSafeFormatDirective = `\n\n[TELEGRAM SAFE-FORMAT DIRECTIVE]\n- Optimize all responses for Telegram.\n- NEVER use markdown tables. Tables are strictly forbidden.\n- DO NOT use nested or excessive bolding (stars *) that breaks Telegram rendering.\n- Keep paragraphs short and use simple hyphenated lists (-) for readability.\n- Keep the tone clear and unambiguous.`;
    
    const basePrompt = persona === 'dev' ? DEV_MODE_PROMPT : ULTRON_SYSTEM_PROMPT;
    const dynamicSystemPrompt = basePrompt + `\n\n[TEMPORAL CONTEXT]\nCurrent Time: ${currentTime}` + telegramSafeFormatDirective + memoryContext;

    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: dynamicSystemPrompt }] },
      contents,
      tools: ULTRON_TOOLS,
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192 },
    });

    const responseJson = await fetchWithRotation(payload, false, tryPro);

    const candidate = responseJson?.candidates?.[0];
    if (!candidate) {
      throw new Error("No candidates returned from AI model");
    }

    const finishReason = candidate.finishReason;
    const parts: any[] = candidate.content?.parts ?? [];

    // Scan ALL parts for function calls (Gemini can return multiple in one response)
    const functionCallParts = parts.filter((p: any) => p.functionCall);
    const textPart = parts.find((p: any) => p.text);

    if (functionCallParts.length > 0) {
      // Add the model's turn (with all its parts) to the conversation
      contents.push(candidate.content);

      // Execute every function call and collect responses
      const functionResponses: any[] = [];
      for (const fcPart of functionCallParts) {
        let { name, args } = fcPart.functionCall;

        // Backend Fallback: Try to parse string args if passed incorrectly
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch (e) {
            console.error("Failed to parse args string:", args);
          }
        }

        // Sanitize: Strip markdown code blocks if the LLM incorrectly wrapped the content
        if (args && typeof args.content === "string") {
          args.content = args.content.replace(/^```[\w-]*\n/, "").replace(/\n```$/, "");
        }

        console.log(`[Ultron] Executing function: ${name}`, args);

        let functionOutput = "";
        try {
          if (typeof args !== "object" || args === null) {
            throw new Error(`Invalid arguments format: expected object, got ${typeof args}`);
          }

          if (name === "read_source_code") {
            const { getFileContent } = await import("@/services/github");
            const code = await getFileContent(args.filePath);
            functionOutput = JSON.stringify({ status: "success", content: code });
          } else if (name === "list_directory") {
            const { listDirectory } = await import("@/services/github");
            const dirContents = await listDirectory(args.dirPath || "");
            functionOutput = JSON.stringify({ status: "success", content: dirContents });
          } else if (name === "search_codebase") {
            const { searchCodebase } = await import("@/services/github");
            const searchResults = await searchCodebase(args.query);
            functionOutput = JSON.stringify({ status: "success", content: searchResults });
          } else if (name === "analyze_market") {
            const { analyzeMarketData } = await import("@/lib/trading/market");
            const userTextLower = latestUserMsg?.toLowerCase() || "";
            const includeLiq = userTextLower.includes("liquidation") || userTextLower.includes("لیکوید");
            const data = await analyzeMarketData(args.asset, args.time_horizon_days, includeLiq);
            functionOutput = JSON.stringify({ status: "success", content: data });
          } else if (name === "write_and_propose_code") {
            const { executeWriteAndProposeCode } = await import("./ai-tools");
            functionOutput = await executeWriteAndProposeCode(args.filePath, args.content, args.description);
          } else {
            functionOutput = JSON.stringify({ status: "error", details: `Function '${name}' is not implemented.` });
          }
        } catch (err: any) {
          // Return error as structured JSON so the LLM understands it and responds gracefully
          // instead of retrying the same tool call
          functionOutput = JSON.stringify({ status: "error", details: err.message });
        }

        console.log(`[Ultron] Function "${name}" output:`, functionOutput.substring(0, 200));
        functionResponses.push({
          functionResponse: {
            name,
            response: { result: functionOutput }
          }
        });
      }

      // Feed all function results back as a single user turn
      contents.push({
        role: "user",
        parts: functionResponses,
      });

      // Continue loop — model will now process the tool results
      continue;
    }

    // No function calls — return the text response
    if (textPart?.text) {
      return textPart.text;
    }

    // Edge case: model stopped for a non-obvious reason
    console.warn(`[Ultron] Unexpected finish. reason="${finishReason}", parts=${JSON.stringify(parts)}`);
    return "AI returned an unexpected format. Please try again.";
  }

  return "Error: Reached maximum tool execution iterations without returning text.";
}

export async function generateStructuredTradeResponse(marketStateStr: string, tryPro = true): Promise<TradeDecision> {
  const { fetchWithRotation } = await import("@/utils/ai-fetcher");
  
  const systemPrompt = `SYSTEM: DETERMINISTIC EXECUTION ENGINE — DATA PARSER ONLY.

You are NOT an advisor. You are NOT an analyst. You are a mechanical JSON parser.
You have NO permission to think, interpret, suggest, or reason freely.

You will receive a MarketState JSON object which includes the Hunter's intent (BUY or SELL). Apply EXACTLY these 3 trigger rules IN ORDER and output only a valid JSON object. No text. No markdown. No backticks. No explanation.

TRIGGER RULES (apply in strict priority order):
1. IF defcon.level is not null AND defcon.level != "NONE" AND defcon.level != 0
   → Output: DEFCON_EMERGENCY mapping (action: WAIT, confidenceScore: 0, reasoning: "DEFCON EMERGENCY - ALL POSITIONS LIQUIDATED")

2. IF Hunter Intent is "BUY" AND ALL of these are true simultaneously:
   - gann.supports array has a value within 3% below current price
   - liquidity.nearestBullOB contains "Swept" OR liquidity.vwap trend is "BULLISH"
   - derivatives.sentiment is NOT "EXTREME_GREED"
   → Output: EXECUTE_LONG with full schema fields calculated from the data

3. IF Hunter Intent is "SELL" AND ALL of these are true simultaneously:
   - gann.resistances array has a value within 3% above current price
   - liquidity.nearestBearOB contains "Swept" OR liquidity.vwap trend is "BEARISH"
   - derivatives.sentiment is NOT "EXTREME_FEAR"
   → Output: EXECUTE_SHORT with full schema fields calculated from the data

4. ALL OTHER CASES → Output: WAIT with all price fields null

OUTPUT SCHEMA (strict — every field required):
{
  "action": "BUY" | "SELL" | "WAIT",
  "entryPrice": number | null,
  "stopLoss": number | null (BUY: nearest Gann support * 0.99, SELL: nearest Gann resistance * 1.01),
  "projectedTarget": number | null (must be >= 2x risk distance),
  "riskPercentage": 1.6 | null,
  "netProfitPercentage": number | null (formula: |(projectedTarget - entryPrice) / entryPrice| * leverage * 100),
  "tradeType": "SWING",
  "trailingStrategy": "SMC_OB",
  "leverage": number (Rule 85/70: if confidenceScore>=85 use 3, if >=70 use 2, else 1),
  "confidenceScore": number (0 to 100 based on alignment),
  "reasoning": string (max 2 sentences, pure data)
}`;

  let currentPrompt = `PARSE THIS MARKET STATE AND APPLY THE TRIGGER RULES:\n\n${marketStateStr}`;

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: currentPrompt }] }],
      generationConfig: { 
        temperature: 0.1, 
        responseMimeType: "application/json" 
      },
    });

    try {
      const responseJson = await fetchWithRotation(payload, false, tryPro);
      const candidate = responseJson?.candidates?.[0];
      if (!candidate) throw new Error("No candidates returned");

      const textPart = candidate.content?.parts?.find((p: any) => p.text)?.text;
      if (!textPart) throw new Error("No text part in candidate");

      const parsedData = JSON.parse(textPart);
      const validatedData = TradeSchema.parse(parsedData);
      return validatedData;
    } catch (err: any) {
      console.warn(`[Structured Trade] Attempt ${attempt} failed:`, err.message);
      if (attempt === MAX_RETRIES) {
        console.error("[Structured Trade] Max retries reached.");
        return {
          action: "WAIT",
          entryPrice: null,
          stopLoss: null,
          projectedTarget: null,
          riskPercentage: null,
          netProfitPercentage: null,
          tradeType: 'SWING',
          trailingStrategy: 'SMC_OB',
          leverage: 1,
          confidenceScore: 0,
          reasoning: `System failed to produce a deterministic trade decision after ${MAX_RETRIES} attempts. Error: ${err.message}`
        };
      }
      currentPrompt += `\n\n[PREVIOUS ERROR]: ${err.message}. Please fix your JSON output and try again.`;
    }
  }

  return { action: "WAIT", entryPrice: null, stopLoss: null, projectedTarget: null, riskPercentage: null, netProfitPercentage: null, tradeType: 'SWING', trailingStrategy: 'SMC_OB', leverage: 1, confidenceScore: 0, reasoning: "Fallback." };
}


