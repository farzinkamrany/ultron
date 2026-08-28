import { Receiver } from "@upstash/qstash";

export const qstashReceiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || "",
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || "",
});

/**
 * Verifies the incoming request signature from Upstash QStash.
 * Uses request.clone() to allow the body to be read again downstream.
 */
export async function verifyQStashSignature(request: Request): Promise<boolean> {
  // Bypass verification in local development if QSTASH tokens are not set
  if (
    process.env.NODE_ENV === "development" && 
    (!process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY)
  ) {
    console.warn("⚠️ Bypassing QStash verification in development mode (Missing tokens)");
    return true;
  }

  const signature = request.headers.get("upstash-signature");
  
  if (!signature) {
    console.error("[QStash] Missing upstash-signature header");
    return false;
  }

  try {
    const bodyText = await request.clone().text();
    const isValid = await qstashReceiver.verify({
      signature,
      body: bodyText,
    });
    return isValid;
  } catch (error) {
    console.error("[QStash] Signature verification failed:", error);
    return false;
  }
}
