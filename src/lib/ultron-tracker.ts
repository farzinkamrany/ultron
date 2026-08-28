import { supabase } from './supabase';

export async function logExpense(amount: string | number, category: string, description: string = '') {
  const { data, error } = await supabase
    .from('finances')
    .insert([{ amount, category, description }])
    .select()
    .single();

  if (error) {
    console.error('Error logging expense:', error);
    throw error;
  }
  return data;
}

export async function logHabitCompletion(habitName: string, notes: string = '') {
  // Find habit ID
  const { data: habit, error: habitError } = await supabase
    .from('habits')
    .select('id, current_streak')
    .eq('name', habitName)
    .single();

  if (habitError || !habit) {
    console.error('Error finding habit:', habitError);
    return null;
  }

  // Insert log
  const { error: logError } = await supabase
    .from('daily_logs')
    .insert([{ habit_id: habit.id, notes }]);

  if (logError) {
    console.error('Error logging habit completion:', logError);
    return null;
  }

  // Update streak
  await supabase
    .from('habits')
    .update({ current_streak: habit.current_streak + 1 })
    .eq('id', habit.id);

  return true;
}
