import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { detectContext } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Phase 13: Webhook Security for OwnTracks
    const authHeader = req.headers.get('authorization') || '';
    const secret = process.env.OWNTRACKS_SECRET;

    if (secret) {
      const expectedBearer = `Bearer ${secret}`;
      const expectedBasic = `Basic ${Buffer.from(`ultron:${secret}`).toString('base64')}`;

      if (authHeader !== expectedBearer && authHeader !== expectedBasic) {
        console.warn("Unauthorized location track attempt");
        return new NextResponse('Unauthorized', { status: 401 });
      }
    }

    const data = await req.json();
    const payloads = Array.isArray(data) ? data : [data];
    let inserted = 0;

    for (const payload of payloads) {
      if (payload._type === "location") {
        const { lat, lon, acc, batt, tst } = payload;
        const context = detectContext({ lat, lon });
        const timestamp = new Date(tst * 1000).toISOString();

        const { error } = await supabase.from("locations").insert([
          { lat, lon, accuracy: acc, battery: batt, context, recorded_at: timestamp }
        ]);

        if (error) {
          console.error("[Location Track Error DB]:", error);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        inserted++;
      } else {
        // Debug: Log unknown payloads to memories so we can see what OwnTracks is sending
        await supabase.from("memories").insert([
          { content: `DEBUG OwnTracks payload: ${JSON.stringify(payload)}`, category: "system" }
        ]);
      }
    }

    return NextResponse.json({ ok: true, inserted });
  } catch (error: any) {
    console.error("[Location Track Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
