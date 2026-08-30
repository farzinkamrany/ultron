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

    // OwnTracks location payload
    if (data._type === "location") {
      const { lat, lon, acc, batt, tst } = data;
      
      const context = detectContext({ lat, lon });
      const timestamp = new Date(tst * 1000).toISOString();

      // Log to database
      const { error } = await supabase.from("locations").insert([
        {
          lat,
          lon,
          accuracy: acc,
          battery: batt,
          context,
          recorded_at: timestamp,
        }
      ]);

      if (error) {
        console.error("[Location Track Error DB]:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      console.log(`[Ultron Eye] Target located: ${context} (Batt: ${batt}%)`);
      return NextResponse.json({ ok: true, context });
    }

    return NextResponse.json({ ok: true, ignored: true });
  } catch (error: any) {
    console.error("[Location Track Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
