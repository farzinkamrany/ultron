import { z } from "zod";

const envSchema = z.object({
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1, "Google API Key is missing"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("Invalid Supabase URL").optional().or(z.literal('')),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "Supabase Anon Key is missing").optional().or(z.literal('')),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.format());
}

export const env = _env.success ? _env.data : process.env;
