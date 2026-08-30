import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { storeMemory } from "@/lib/memory";
import { fetchWithRotation } from "@/utils/ai-fetcher";
import { logError } from "@/lib/logger";
import { verifyQStashSignature } from "@/lib/qstash";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Summarizing large texts might take time

export async function POST(req: NextRequest) {
  const isValid = await verifyQStashSignature(req);
  if (!isValid) {
    return new NextResponse('Unauthorized: Invalid QStash Signature', { status: 401 });
  }

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString();

    // 1. Fetch old memories
    const { data: oldMemories, error: fetchError } = await supabase
      .from('memory_embeddings')
      .select('id, content, metadata')
      .lt('created_at', dateStr);

    if (fetchError) throw fetchError;

    if (!oldMemories || oldMemories.length === 0) {
      return NextResponse.json({ ok: true, message: "No old memories to prune" });
    }

    // 2. Aggregate content
    const combinedContent = oldMemories.map(m => m.content).join("\n\n---\n\n");
    
    // 3. Summarize using Gemini Flash (tryPro = false for faster/cheaper processing)
    const prompt = `You are a memory archiver. Summarize the following past logs and memories into a cohesive, highly dense paragraph that retains all important factual information, entities, and context. Omit filler words.\n\nMemories:\n${combinedContent}`;
    
    const payload = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });
    
    console.log(`[Memory Pruner] Summarizing ${oldMemories.length} old memories...`);
    const summaryResponseJson = await fetchWithRotation(payload, false, false);
    const summaryResponse = summaryResponseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    // Fallback if summarization fails
    if (!summaryResponse || summaryResponse.includes("Error")) {
      throw new Error(`Failed to summarize memories: ${summaryResponse}`);
    }

    // 4. Save summary as a new vector
    const summaryMetadata = { type: 'archived_summary', original_count: oldMemories.length, pruned_at: new Date().toISOString() };
    await storeMemory(`ARCHIVED SUMMARY: ${summaryResponse}`, summaryMetadata);

    // 5. Delete old memories
    const idsToDelete = oldMemories.map(m => m.id);
    const { error: deleteError } = await supabase
      .from('memory_embeddings')
      .delete()
      .in('id', idsToDelete);

    if (deleteError) throw deleteError;

    console.log(`[Memory Pruner] Successfully pruned ${idsToDelete.length} memories.`);

    return NextResponse.json({ 
      ok: true, 
      pruned: idsToDelete.length,
      summary_length: summaryResponse.length
    });
  } catch (error: any) {
    await logError("API_MEMORY_PRUNE", error, {}, true);
    return NextResponse.json({ error: "Memory pruning failed" }, { status: 500 });
  }
}
