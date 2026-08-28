# Ultron Resilient API Architecture: Key Rotation & Model Fallback
**Project Context:** A Next.js App Router project deployed on Vercel. 
**Goal:** Implement an autonomous API Key rotation and Model Fallback system. If the primary API key hits a rate limit (429) or quota error, the system must automatically retry with a backup key. If a heavy Pro model fails, it should gracefully fall back to a faster/lighter Flash model.

## Phase 1: Environment Setup (API Pool)
- [ ] **Define Key Array:** Update the `.env` file to include multiple API keys.
  - `GEMINI_API_KEY_PRIMARY`
  - `GEMINI_API_KEY_SECONDARY`
  - `GEMINI_API_KEY_FALLBACK`
- [ ] **Create Config File:** Create `src/config/ai-models.ts` to store available models and keys.

## Phase 2: Model Hierarchy Definition
- [ ] **Define the Model Arrays:** Create arrays for Pro and Flash models, ordered by preference and capability.
  - **Pro Models (Advanced Reasoning):**
    1. `"gemini-3.1-pro"` (Primary choice)
    2. `"gemini-1.5-pro-latest"` (Backup Pro)
  - **Flash Models (Speed & Efficiency):**
    1. `"gemini-3.7-flash"` (Fastest current generation)
    2. `"gemini-3.6-flash"` 
    3. `"gemini-2.5-flash"` (Highly stable fallback)
    4. `"gemini-2-flash"`
    5. `"gemini-1.5-flash-latest"`

## Phase 3: The Rotation Logic (`src/utils/ai-fetcher.ts`)
- [ ] **Implement `fetchWithRotation` Function:**
  - *Input:* User prompt, context.
  - *Logic:* Loop through the API keys array. Try the request with the Primary Key and the top Pro model.
  - *Error Handling:* If the response status is `429` (Too Many Requests), `403` (Quota Exceeded), or `503`, catch the error.
  - *Rotation Action:* Immediately retry the request using the Next API Key in the array.
  - *Fallback Action:* If all Pro models/keys fail, switch the requested model to the top Flash model and try again.

## Phase 4: Integration into Telegram Webhook
- [ ] **Update `route.ts`:** Refactor the main API route to use `fetchWithRotation` instead of a direct hardcoded fetch call.
- [ ] **Logging (Crucial):** Ensure that every time a key rotates or a model falls back, a `console.warn` is logged so it can be monitored in the Vercel Logs dashboard without interrupting the user experience in Telegram.