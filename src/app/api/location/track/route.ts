import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { detectContext } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
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
