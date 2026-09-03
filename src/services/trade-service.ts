import { supabase } from "../lib/supabase";

export type Trade = {
  id?: number;
  created_at?: string;
  asset: string;
  type: "long" | "short";
  entry_price: number;
  exit_price?: number | null;
  status: "open" | "closed";
  notes?: string | null;
};

export const tradeService = {
  async createTrade(trade: Trade) {
    const { data, error } = await supabase.from("trades").insert([trade]).select();
    if (error) throw error;
    return data;
  },

  async getOpenTrades() {
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("status", "open");
    if (error) throw error;
    return data;
  },

  async closeTrade(id: number, exitPrice: number) {
    const { data, error } = await supabase
      .from("trades")
      .update({ exit_price: exitPrice, status: "closed" })
      .eq("id", id);
    if (error) throw error;
    return data;
  },
};
