// Pro Models (for complex reasoning, decision-making, coding)
export const PRO_MODELS = [
  "gemini-3.1-pro-preview",   // Best available
];

// Flash Models (for speed, stability, and everyday conversations)
export const FLASH_MODELS = [
  "gemini-3.7-flash",         // Latest fast model
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",         // Last resort stable
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
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    // Keep the old generic key as a final fallback just in case
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  ].filter(Boolean) as string[];

  // If no specific keys are set, fallback to whatever is available.
  if (keys.length === 0) {
    throw new Error("No Gemini API keys are configured in the environment variables.");
  }

  // Deduplicate keys (in case user pasted the same key twice)
  return Array.from(new Set(keys));
}
