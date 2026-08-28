export const PRO_MODELS = [
  "gemini-3.1-pro",         // Primary choice (as requested)
  "gemini-1.5-pro"   // Backup Pro
];

export const FLASH_MODELS = [
  "gemini-3.7-flash",       // Fastest current generation
  "gemini-3.6-flash",
  "gemini-2.5-flash",       // Highly stable fallback
  "gemini-2-flash",
  "gemini-1.5-flash" // Ultimate stable fallback
];

/**
 * Returns the available API keys configured in the environment.
 * The system will iterate through these keys if rate limits (429) or quota errors (403) are hit.
 */
export function getApiKeysPool(): string[] {
  const keys = [
    process.env.GEMINI_API_KEY_PRIMARY,
    process.env.GEMINI_API_KEY_SECONDARY,
    process.env.GEMINI_API_KEY_FALLBACK,
    // Keep the old generic key as a final fallback just in case
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  ].filter(Boolean) as string[];

  // If no specific keys are set, fallback to whatever is available.
  if (keys.length === 0) {
    throw new Error("No Gemini API keys are configured in the environment variables.");
  }
  
  return keys;
}
