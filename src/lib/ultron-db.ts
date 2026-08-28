import { supabase } from './supabase';

export async function logSystemEvent(
  level: 'info' | 'warn' | 'error',
  message: string,
  details: Record<string, any> = {}
) {
  const { error } = await supabase
    .from('system_logs')
    .insert([{ level, message, details }]);
  if (error) console.error('Ultron DB Log Error:', error);
}

export async function saveMemory(
  content: string,
  category: string,
  embedding: number[] | null = null
) {
  const { error } = await supabase
    .from('memories')
    .insert([{ content, category, embedding }]);
  if (error) console.error('Ultron DB Memory Error:', error);
}
