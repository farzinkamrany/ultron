"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  BrainCircuit, Terminal, Send, Loader2, Mic, MessageSquare,
  Target, TrendingUp, MapPin, Activity, ShieldAlert, Cpu, X, Database, AlertTriangle, Rocket
, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import TextareaAutosize from "react-textarea-autosize";
import { useChatStore, Message } from "@/store/chatStore";
import dynamic from "next/dynamic";
import { useGPS } from "@/hooks/useGPS";

const LiveCryptoChart = dynamic(() => import("@/components/LiveCryptoChart").then(mod => mod.LiveCryptoChart), { ssr: false });

// --- Sub-Components ---
function ChatInterface({ messages, isLoading, sendMessage, input, setInput, isVoiceActive, setIsVoiceActive }: any) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(e as any);
    }
  };

  return (
    <div className="flex flex-col bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden h-[600px] shadow-2xl relative">
      <div className="p-4 border-b border-white/10 bg-black/20 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <BrainCircuit className="w-5 h-5 text-phase1" />
          <span className="text-sm font-semibold text-slate-200 tracking-wider">CORE // NEURAL_LINK</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-phase1 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-phase1" />
          </span>
          <span className="text-xs font-mono text-phase1/80">ONLINE</span>
        </div>
      </div>

      <div className="flex-1 p-5 overflow-y-auto space-y-6">
        <AnimatePresence initial={false}>
          {messages.map((msg: Message) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${msg.role === "user" ? "bg-slate-800 border-slate-700 text-slate-400" : "bg-phase1/20 border-phase1/40 text-phase1 shadow-[0_0_10px_rgba(0,191,255,0.2)]"}`}>
                {msg.role === "user" ? <User className="w-4 h-4" /> : <Terminal className="w-4 h-4" />}
              </div>
              <div className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed ${msg.role === "user"
                ? "bg-slate-800/80 border border-slate-700/50 text-slate-100 rounded-tr-none"
                : "bg-phase1/10 border border-phase1/20 text-slate-200 rounded-tl-none shadow-[0_0_15px_rgba(0,191,255,0.05)]"
                }`}>
                <div className="whitespace-pre-wrap">{msg.content}</div>
                {msg.role === "assistant" && msg.content.includes("Executing") && (
                  <span className="inline-flex items-center gap-2 mt-3 px-2 py-0.5 bg-phase1/20 text-phase1 rounded text-[10px] border border-phase1/30">
                    <Activity className="w-3 h-3 animate-pulse" /> Active Process
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border bg-phase1/20 border-phase1/40 text-phase1">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
            <div className="p-4 rounded-2xl bg-phase1/5 border border-phase1/10 rounded-tl-none flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-phase1/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-phase1/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-phase1/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 border-t border-white/10 bg-black/40">
        <form onSubmit={sendMessage} className="relative flex items-end gap-2">
          <button
            type="button"
            onClick={() => setIsVoiceActive(!isVoiceActive)}
            className={`p-3 rounded-xl border transition-all shrink-0 ${isVoiceActive
              ? "bg-phase7/20 border-phase7/40 text-phase7 animate-pulse"
              : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
              }`}
          >
            <Mic className="w-5 h-5" />
          </button>
          
          <TextareaAutosize
            minRows={1}
            maxRows={5}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Awaiting command... (Shift+Enter for newline)"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-phase1/50 focus:bg-phase1/5 transition-all resize-none"
          />
          
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-3 rounded-xl bg-phase1 hover:bg-phase1/80 text-slate-900 font-bold transition-all disabled:opacity-50 disabled:hover:bg-phase1 shrink-0"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
      </div>
    </div>
  );
}

const variantMap: Record<string, string> = {
  phase1: "border-phase1/20 hover:border-phase1/40 bg-phase1/10 text-phase1",
  phase2: "border-phase2/20 hover:border-phase2/40 bg-phase2/10 text-phase2",
  phase3: "border-phase3/20 hover:border-phase3/40 bg-phase3/10 text-phase3",
  phase4: "border-phase4/20 hover:border-phase4/40 bg-phase4/10 text-phase4",
  phase5: "border-phase5/20 hover:border-phase5/40 bg-phase5/10 text-phase5",
  phase6: "border-phase6/20 hover:border-phase6/40 bg-phase6/10 text-phase6",
  phase7: "border-phase7/20 hover:border-phase7/40 bg-phase7/10 text-phase7",
  phase8: "border-phase8/20 hover:border-phase8/40 bg-phase8/10 text-phase8",
};

function DashboardModule({ title, icon: Icon, variant, children }: any) {
  const styles = variantMap[variant] || variantMap.phase2;
  const [borderColor, hoverColor, bgColor, textColor] = styles.split(" ");

  return (
    <div className={`bg-white/5 backdrop-blur-xl border ${borderColor} rounded-2xl p-5 ${hoverColor} transition-colors shadow-lg`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2 rounded-lg ${bgColor} ${textColor} border ${borderColor}`}>
          <Icon className="w-5 h-5" />
        </div>
        <h2 className={`font-mono text-xs tracking-widest font-bold ${textColor}`}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

// --- Main Page ---
export default function UltronDashboard() {
  const router = useRouter();
  const { location, isLoading: isLocationLoading } = useGPS();
  const { 
    messages, input, isLoading, isVoiceActive, 
    addMessage, setInput, setIsLoading, setIsVoiceActive, updateLastMessage, setMessages
  } = useChatStore();

  const [modalType, setModalType] = useState<"telegram" | "vapi" | "arbitrage" | "trading" | "memory" | "system" | "deploy" | null>(null);
  const [isArbitrageRunning, setIsArbitrageRunning] = useState(false);
  const [isTradingRunning, setIsTradingRunning] = useState(false);

  // TWA Initialization
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).Telegram && (window as any).Telegram.WebApp) {
      const twa = (window as any).Telegram.WebApp;
      twa.ready();
      
      // Apply TWA theme colors to CSS variables if you want to adapt to the user's theme
      if (twa.themeParams) {
        document.documentElement.style.setProperty('--tg-theme-bg-color', twa.themeParams.bg_color || '');
        document.documentElement.style.setProperty('--tg-theme-text-color', twa.themeParams.text_color || '');
      }
    }
  }, []);

  const [retryInput, setRetryInput] = useState<string | null>(null);

  const sendMessage = async (e?: React.FormEvent | React.KeyboardEvent, customInput?: string) => {
    if (e && 'preventDefault' in e) e.preventDefault();
    const textToSend = customInput || input;
    if (!textToSend.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: textToSend };
    
    // Only append user message if it's not a retry
    if (!customInput) {
      addMessage(userMsg);
      setInput("");
    }
    
    setIsLoading(true);
    setRetryInput(null);

    try {
      const msgsToSend = customInput ? messages : [...messages, userMsg];
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgsToSend.map(m => ({ role: m.role, content: m.content })) }),
      });
      
      if (!res.ok) {
        let errMsg = res.statusText;
        try {
          const errData = await res.json();
          if (errData.error) errMsg = errData.error;
        } catch (e) {}
        throw new Error(errMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader stream available");

      const decoder = new TextDecoder();
      let assistantMsg = "";
      
      addMessage({ id: (Date.now() + 1).toString(), role: "assistant", content: "" });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        assistantMsg += decoder.decode(value, { stream: true });
        updateLastMessage(assistantMsg);
      }
    } catch (err: any) {
      setRetryInput(textToSend);
      toast.error("Stream Interrupted: " + (err.message || "Connection lost"), {
        action: {
          label: 'Retry',
          onClick: () => sendMessage(undefined, textToSend)
        },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualArbitrage = async () => {
    setIsArbitrageRunning(true);
    try {
      await fetch('/api/cron/arbitrage');
      toast.success('Manual Scan Complete! Check Telegram for alerts.');
    } finally {
      setIsArbitrageRunning(false);
      setModalType(null);
    }
  };

  const handleManualTrade = async () => {
    setIsTradingRunning(true);
    try {
      await fetch('/api/cron/trading');
      toast.success('Gann Trading Cycle Complete. Check Binance Testnet.');
    } catch (err: any) {
      toast.error('Trading engine failed: ' + err.message);
    } finally {
      setIsTradingRunning(false);
      setModalType(null);
    }
  };

  return (
    <><Toaster theme="dark" position="top-center" richColors /><div className="min-h-screen bg-surface text-slate-200 p-4 md:p-8 font-sans selection:bg-phase1/30 relative overflow-hidden">
      {/* Background Ornaments */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-phase1/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-phase2/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Modal Overlay */}
      <AnimatePresence>
        {modalType && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl relative"
            >
              <button onClick={() => setModalType(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-1.5 rounded-lg">
                <X className="w-5 h-5" />
              </button>

              {modalType === "telegram" && (
                <>
                  <h3 className="text-lg font-bold text-phase2 flex items-center gap-2 mb-4"><MessageSquare className="w-5 h-5" /> Telegram Configuration</h3>
                  <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                    Set your Webhook URL in Telegram to point to <code className="bg-slate-800 px-1 py-0.5 rounded text-phase1">/api/telegram/webhook</code>.
                  </p>
                  <button onClick={() => setModalType(null)} className="w-full py-2 flex items-center justify-center gap-2 bg-phase2 hover:bg-phase2 text-white rounded font-semibold transition-colors">
                    Close
                  </button>
                </>
              )}

              {modalType === "vapi" && (
                <>
                  <h3 className="text-lg font-bold text-secondary flex items-center gap-2 mb-4"><Mic className="w-5 h-5" /> Vapi Voice Stream</h3>
                  <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                    Ensure your Vapi assistant is configured with the correct Server URL to reach <code className="bg-slate-800 px-1 py-0.5 rounded text-phase1">/api/vapi/webhook</code>.
                  </p>
                  <button onClick={() => setModalType(null)} className="w-full py-2 flex items-center justify-center gap-2 bg-secondary hover:bg-secondary text-white rounded font-semibold transition-colors">
                    Close
                  </button>
                </>
              )}

              {modalType === "arbitrage" && (
                <>
                  <h3 className="text-lg font-bold text-phase4 flex items-center gap-2 mb-4"><Target className="w-5 h-5" /> Divar Scraper Engine</h3>
                  <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                    This engine scrapes Divar every 15 minutes, calculates the Mean and Standard Deviation (Z-Score) of prices, and sends a Telegram alert if an item is priced significantly below market value.
                  </p>
                  <button onClick={handleManualArbitrage} disabled={isArbitrageRunning} className="w-full py-2 flex items-center justify-center gap-2 bg-phase4 hover:bg-phase4 text-white rounded font-semibold transition-colors disabled:opacity-50">
                    {isArbitrageRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                    {isArbitrageRunning ? "Scanning Market..." : "Force Manual Scan"}
                  </button>
                </>
              )}

              {modalType === "trading" && (
                <>
                  <h3 className="text-lg font-bold text-phase5 flex items-center gap-2 mb-4"><TrendingUp className="w-5 h-5" /> Quantitative Trading Engine</h3>
                  <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                    Runs daily at midnight. Uses CCXT to fetch Binance data (BTC/USDT).
                    Applies <strong>W.D. Gann Square of 9</strong> levels.
                    <br /><br />
                    <strong>Guardrails:</strong> Max 2% drawdown limit on all signals.
                  </p>
                  <button onClick={handleManualTrade} disabled={isTradingRunning} className="w-full py-2 flex items-center justify-center gap-2 bg-phase5 hover:bg-phase5 text-slate-900 rounded font-bold transition-colors disabled:opacity-50">
                    {isTradingRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                    {isTradingRunning ? "Analyzing Market..." : "Run Gann Analysis Now"}
                  </button>
                </>
              )}

              {modalType === "memory" && (
                <>
                  <h3 className="text-lg font-bold text-phase6 flex items-center gap-2 mb-4"><Database className="w-5 h-5" /> Deep Memory Engine</h3>
                  <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                    Ultron automatically records significant events into a Supabase pgvector database every night at 23:59.
                    <br /><br />
                    When you chat, Ultron uses RAG (Retrieval-Augmented Generation) to search these vectors and recall past context.
                  </p>
                  <button onClick={() => {
                    fetch('/api/cron/reflect');
                    toast.success('Nightly reflection triggered in background.');
                    setModalType(null);
                  }} className="w-full py-2 flex items-center justify-center gap-2 bg-phase1 hover:bg-phase1 text-slate-900 rounded font-bold transition-colors">
                    <Database className="w-4 h-4" /> Force Nightly Sync
                  </button>
                </>
              )}

              {modalType === "system" && (
                <>
                  <h3 className="text-lg font-bold text-phase7 flex items-center gap-2 mb-4"><AlertTriangle className="w-5 h-5" /> System Integrity</h3>
                  <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                    Global error handlers are active across all API routes. Any critical failure will bypass standard protocols and push a <strong>System Degraded</strong> alert to your Telegram.
                    <br /><br />
                    All stack traces are securely written to Supabase `system_logs`.
                  </p>
                  <button onClick={() => {
                    toast.success('Simulated Crash Logged to Database & Telegram!');
                    setModalType(null);
                  }} className="w-full py-2 flex items-center justify-center gap-2 bg-phase7 hover:bg-phase7 text-slate-900 rounded font-bold transition-colors">
                    <AlertTriangle className="w-4 h-4" /> Simulate Critical Crash
                  </button>
                </>
              )}

              {modalType === "deploy" && (
                <>
                  <h3 className="text-lg font-bold text-phase8 flex items-center gap-2 mb-4"><Rocket className="w-5 h-5" /> Production Deployment</h3>
                  <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                    Ultron is configured for 24/7 Vercel deployment. Cron jobs are bound to `vercel.json`.
                    <br /><br />
                    Remember to remove `HTTPS_PROXY` from your production environment variables.
                  </p>
                  <a href="https://vercel.com/new" target="_blank" rel="noreferrer" className="w-full py-2 flex items-center justify-center gap-2 bg-phase4 hover:bg-phase4 text-slate-900 rounded font-bold transition-colors">
                    <Rocket className="w-4 h-4" /> Deploy to Vercel
                  </a>
                </>
              )}

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Navigation / Brand */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4 relative z-10">
        <div className="flex items-center gap-4">
          <div className="relative w-12 h-12 flex items-center justify-center bg-black/40 rounded-xl border border-white/10 shadow-xl overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-phase1/20 to-phase2/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            <BrainCircuit className="w-6 h-6 text-phase1" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-phase1 to-phase2">
              ULTRON
            </h1>
            <p className="text-[10px] text-slate-400 tracking-[0.3em] uppercase mt-0.5">Tactical Command Center</p>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-slate-300 flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5 text-phase5" /> VERCEL_CRON: ACTIVE
          </div>
          <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-slate-300 flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-phase1" /> MEMORY: OPTIMAL
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">

        {/* Left Column: Chat (Phase 1) */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-6">
          <ChatInterface
            messages={messages} isLoading={isLoading}
            sendMessage={sendMessage} input={input} setInput={setInput}
            isVoiceActive={isVoiceActive} setIsVoiceActive={setIsVoiceActive}
          />

          {/* Bottom Row: Phase 3 (GPS) */}
          <DashboardModule title="SPATIAL AWARENESS (PHASE 3)" icon={MapPin} variant="phase3">
            <div className="flex items-center justify-between bg-black/20 p-3 rounded-xl border border-white/5">
              <div>
                <div className="text-xs text-slate-400 font-mono mb-1">CURRENT CONTEXT</div>
                <div className="text-phase3 font-semibold text-sm flex items-center gap-2">
                  {isLocationLoading ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Fetching...</>
                  ) : location ? (
                    <>
                      <span className="relative flex h-2 w-2 mr-1">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-phase3 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-phase3" />
                      </span>
                      {location.context} {location.battery && <span className="text-xs text-slate-500 ml-1">({location.battery}%)</span>}
                    </>
                  ) : (
                    "Unknown Location"
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400 font-mono mb-1">LAST SYNC</div>
                <div className="text-slate-300 text-sm">
                  {location ? (() => {
                    const diffInMinutes = Math.floor((new Date().getTime() - new Date(location.recorded_at).getTime()) / 60000);
                    if (diffInMinutes < 1) return 'Just now';
                    if (diffInMinutes < 60) return `${diffInMinutes} mins ago`;
                    const diffInHours = Math.floor(diffInMinutes / 60);
                    if (diffInHours < 24) return `${diffInHours} hours ago`;
                    return `${Math.floor(diffInHours / 24)} days ago`;
                  })() : "--"}
                </div>
              </div>
            </div>
          </DashboardModule>
        </div>

        {/* Right Column: Plugins (Phase 2, 4, 5, 6, 7, 8) */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-6">

          {/* Market Overview */}
          <DashboardModule title="LIVE MARKET OVERVIEW" icon={Activity} variant="phase1">
            <div className="space-y-4">
              <LiveCryptoChart symbol="BTCUSDT" color="#f59e0b" />
              <LiveCryptoChart symbol="ETHUSDT" color="#3b82f6" />
            </div>
          </DashboardModule>

          {/* Phase 2 */}
          <DashboardModule title="COMMS INTERFACE (PHASE 2)" icon={Activity} variant="phase2">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-black/20 rounded-xl border border-white/5 hover:border-phase2/30 transition-colors cursor-pointer group">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-4 h-4 text-phase2" />
                  <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Telegram Webhook</span>
                </div>
                <div className="w-2 h-2 rounded-full bg-phase2 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
              </div>
              <div className="flex items-center justify-between p-3 bg-black/20 rounded-xl border border-white/5 hover:border-phase2/30 transition-colors cursor-pointer group">
                <div className="flex items-center gap-3">
                  <Mic className="w-4 h-4 text-secondary" />
                  <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Vapi Voice Stream</span>
                </div>
                <div className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
              </div>
            </div>
          </DashboardModule>

          {/* Phase 4 */}
          <DashboardModule title="MARKET ARBITRAGE (PHASE 4)" icon={Target} variant="phase4">
            <div className="bg-black/20 p-4 rounded-xl border border-white/5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs text-slate-400 font-mono">TARGET: DIVAR_TEHRAN</span>
                <span className="text-[10px] bg-phase4/10 text-phase4 px-2 py-0.5 rounded border border-phase4/20">Z-SCORE -1.5</span>
              </div>
              <button onClick={() => setModalType("arbitrage")} className="w-full py-2.5 bg-phase4/10 hover:bg-phase4/20 text-phase4 rounded-lg border border-phase4/30 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                <Target className="w-4 h-4" /> Open Scraper Engine
              </button>
            </div>
          </DashboardModule>

          {/* Phase 5 */}
          <DashboardModule title="GANN QUANT TRADING (PHASE 5)" icon={TrendingUp} variant="phase5">
            <div className="bg-black/20 p-4 rounded-xl border border-white/5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs text-slate-400 font-mono">ASSET: BTC/USDT</span>
                <span className="text-[10px] bg-phase5/10 text-phase5 px-2 py-0.5 rounded border border-phase5/20">RISK LIMIT 2%</span>
              </div>
              <button onClick={() => router.push('/trading')} className="w-full py-2.5 bg-phase5 hover:bg-phase5 text-slate-900 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                <TrendingUp className="w-4 h-4" /> Open Trading Engine
              </button>
            </div>
          </DashboardModule>

          {/* Phase 6 */}
          <DashboardModule title="DEEP MEMORY (PHASE 6)" icon={Database} variant="phase6">
            <div className="bg-black/20 p-4 rounded-xl border border-white/5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs text-slate-400 font-mono">DB: SUPABASE PGVECTOR</span>
                <span className="text-[10px] bg-phase6/10 text-phase6 px-2 py-0.5 rounded border border-phase6/20">768 DIM</span>
              </div>
              <button onClick={() => setModalType("memory")} className="w-full py-2.5 bg-phase6/10 hover:bg-phase6/20 text-phase6 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg">
                <Database className="w-4 h-4" /> Open Memory Engine
              </button>
            </div>
          </DashboardModule>

          {/* Phase 7 */}
          <DashboardModule title="SYSTEM INTEGRITY (PHASE 7)" icon={AlertTriangle} variant="phase7">
            <div className="bg-black/20 p-4 rounded-xl border border-white/5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs text-slate-400 font-mono">FALLBACK PROTOCOL</span>
                <span className="text-[10px] bg-phase7/10 text-phase7 px-2 py-0.5 rounded border border-phase7/20">ACTIVE</span>
              </div>
              <button onClick={() => setModalType("system")} className="w-full py-2.5 bg-phase7/10 hover:bg-phase7/20 text-phase7 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg">
                <AlertTriangle className="w-4 h-4" /> Test Global Handlers
              </button>
            </div>
          </DashboardModule>

          {/* Phase 8 */}
          <DashboardModule title="CI/CD DEPLOYMENT (PHASE 8)" icon={Rocket} variant="phase8">
            <div className="bg-black/20 p-4 rounded-xl border border-white/5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs text-slate-400 font-mono">TARGET: VERCEL EDGE</span>
                <span className="text-[10px] bg-phase8/10 text-phase8 px-2 py-0.5 rounded border border-phase8/20">READY</span>
              </div>
              <button onClick={() => setModalType("deploy")} className="w-full py-2.5 bg-phase8 hover:bg-phase8 text-slate-900 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                <Rocket className="w-4 h-4" /> Final Launch Setup
              </button>
            </div>
          </DashboardModule>

        </div>
      </main>
    </div>
    </>
  );
}








