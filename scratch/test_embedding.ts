import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function test() {
  try {
    console.log("Key:", process.env.GOOGLE_GENERATIVE_AI_API_KEY?.substring(0, 10) + "...");
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent("Hello world");
    console.log("Success with text-embedding-004! Length:", result.embedding.values.length);
  } catch (err: any) {
    console.error("Error with text-embedding-004:", err.message);
    try {
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
      const fallbackModel = genAI.getGenerativeModel({ model: "embedding-001" });
      const fallbackResult = await fallbackModel.embedContent("Hello world");
      console.log("Success with embedding-001! Length:", fallbackResult.embedding.values.length);
    } catch (err2: any) {
      console.error("Error with embedding-001:", err2.message);
    }
  }
}

test();
