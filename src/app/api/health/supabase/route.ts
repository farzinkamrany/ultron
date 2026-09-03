import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase.from('trades').select('count', { count: 'exact', head: true });
    
    if (error) throw error;
    
    return NextResponse.json({ status: 'connected', count: data });
  } catch (err: any) {
    return NextResponse.json({ status: 'error', message: err.message }, { status: 500 });
  }
}
