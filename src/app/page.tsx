"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  BrainCircuit, Terminal, Send, Loader2, Mic, MessageSquare,
  Target, TrendingUp, MapPin, Activity, ShieldAlert, Cpu, X, Database, AlertTriangle, Rocket, User, Volume2 
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import TextareaAutosize from "react-textarea-autosize";
import { useChatStore, Message } from "@/store/chatStore";
import dynamic from "next/dynamic";
import { useGPS } from "@/hooks/useGPS";

const LiveCryptoChart = dynamic(() => import("@/components/LiveCryptoChart").then(mod => mod.LiveCryptoChart), { ssr: false });

function ChatInterface({ messages, isLoading, sendMessage, input, setInput, isVoiceActive, setIsVoiceActive }: any) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(e as any);
    }
  };

  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fa-IR";
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className=\"flex flex-col bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden h-[600px] shadow-2xl relative\">
      <div className=\"p-4 border-b border-white/10 bg-black/20 flex justify-between items-center\">
        <div className=\"flex items-center gap-3\">
          <BrainCircuit className=\"w-5 h-5 text-phase1\" />
          <span className=\"text-sm font-semibold text-slate-200 tracking-wider\">CORE // NEURAL_LINK</span>
        </div>
        <div className=\"flex items-center gap-2\">
          <span className=\"relative flex h-2 w-2\">
            <span className=\"animate-ping absolute inline-flex h-full w-full rounded-full bg-phase1 opacity-75\" />
            <span className=\"relative inline-flex rounded-full h-2 w-2 bg-phase1\" />
          </span>
          <span className=\"text-xs font-mono text-phase1/80\">ONLINE</span>
        </div>
      </div>

      <div className=\"flex-1 p-5 overflow-y-auto space-y-6\">
        <AnimatePresence initial={false}>
          {messages.map((msg: Message) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              className={`flex gap-3 ${msg.role === \"user\" ? \"flex-row-reverse\" : \"flex-row\"}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${msg.role === \"user\" ? \"bg-slate-800 border-slate-700 text-slate-400\" : \"bg-phase1/20 border-phase1/40 text-phase1 shadow-[0_0_10px_rgba(0,191,255,0.2)]\"}`}>
                {msg.role === \"user\" ? <User className=\"w-4 h-4\" /> : <Terminal className=\"w-4 h-4\" />}
              </div>
              <div className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed ${msg.role === \"user\"
                ? \"bg-slate-800/80 border border-slate-700/50 text-slate-100 rounded-tr-none\"
                : \"bg-phase1/10 border border-phase1/20 text-slate-200 rounded-tl-none shadow-[0_0_15px_rgba(0,191,255,0.05)]\"
                }`}>
                <div className=\"whitespace-pre-wrap\">{msg.content}</div>
                {msg.role === \"assistant\" && (
                  <div className=\"flex items-center justify-between mt-3\">
                    {msg.content.includes(\"Executing\") && (
                      <span className=\"inline-flex items-center gap-2 px-2 py-0.5 bg-phase1/20 text-phase1 rounded text-[10px] border border-phase1/30\">
                        <Activity className=\"w-3 h-3 animate-pulse\" /> Active Process
                      </span>
                    )}
                    <button onClick={() => speak(msg.content)} className=\"ml-auto p-1.5 hover:bg-white/10 rounded-full transition-colors text-slate-500 hover:text-white\">
                      <Volume2 className=\"w-4 h-4\" />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && messages[messages.length - 1]?.role !== \"assistant\" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className=\"flex gap-3\">
            <div className=\"w-8 h-8 rounded-full flex items-center justify-center shrink-0 border bg-phase1/20 border-phase1/40 text-phase1\">
              <Loader2 className=\"w-4 h-4 animate-spin\" />
            </div>
            <div className=\"p-4 rounded-2xl bg-phase1/5 border border-phase1/10 rounded-tl-none flex items-center gap-2\">
              <span className=\"w-1.5 h-1.5 bg-phase1/60 rounded-full animate-bounce\" style={{ animationDelay: '0ms' }} />
              <span className=\"w-1.5 h-1.5 bg-phase1/60 rounded-full animate-bounce\" style={{ animationDelay: '150ms' }} />
              <span className=\"w-1.5 h-1.5 bg-phase1/60 rounded-full animate-bounce\" style={{ animationDelay: '300ms' }} />
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className=\"p-4 border-t border-white/10 bg-black/40\">
        <form onSubmit={sendMessage} className=\"relative flex items-end gap-2\">
          <button
            type=\"button\"
            onClick={() => setIsVoiceActive(!isVoiceActive)}
            className={`p-3 rounded-xl border transition-all shrink-0 ${isVoiceActive
              ? \"bg-phase7/20 border-phase7/40 text-phase7 animate-pulse\"
              : \"bg-white/5 border-white/10 text-slate-400 hover:text-white\"
              }`}
          >
            <Mic className=\"w-5 h-5\" />
          </button>
          
          <TextareaAutosize
            minRows={1}
            maxRows={5}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder=\"Awaiting command... (Shift+Enter for newline)\"
            className=\"flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-phase1/50 focus:bg-phase1/5 transition-all resize-none\"
          />
          
          <button
            type=\"submit\"
            disabled={!input.trim() || isLoading}
            className=\"p-3 rounded-xl bg-phase1 hover:bg-phase1/80 text-slate-900 font-bold transition-all disabled:opacity-50 disabled:hover:bg-phase1 shrink-0\"
          >
            {isLoading ? <Loader2 className=\"w-5 h-5 animate-spin\" /> : <Send className=\"w-5 h-5\" />}
          </button>
        </form>
      </div>
    </div>
  );
}

// ... rest of the component (DashboardModule, UltronDashboard) remains the same
const variantMap: Record<string, string> = {
  phase1: \"border-phase1/20 hover:border-phase1/40 bg-phase1/10 text-phase1\",
  phase2: \"border-phase2/20 hover:border-phase2/40 bg-phase2/10 text-phase2\",
  phase3: \"border-phase3/20 hover:border-phase3/40 bg-phase3/10 text-phase3\",
  phase4: \"border-phase4/20 hover:border-phase4/40 bg-phase4/10 text-phase4\",
  phase5: \"border-phase5/20 hover:border-phase5/40 bg-phase5/10 text-phase5\",
  phase6: \"border-phase6/20 hover:border-phase6/40 bg-phase6/10 text-phase6\",
  phase7: \"border-phase7/20 hover:border-phase7/40 bg-phase7/10 text-phase7\",
  phase8: \"border-phase8/20 hover:border-phase8/40 bg-phase8/10 text-phase8\",
};

function DashboardModule({ title, icon: Icon, variant, children }: any) {
  const styles = variantMap[variant] || variantMap.phase2;
  const [borderColor, hoverColor, bgColor, textColor] = styles.split(\" \");

  return (
    <div className={`bg-white/5 backdrop-blur-xl border ${borderColor} rounded-2xl p-5 ${hoverColor} transition-colors shadow-lg`}>
      <div className=\"flex items-center gap-3 mb-4\">
        <div className={`p-2 rounded-lg ${bgColor} ${textColor} border ${borderColor}`}>
          <Icon className=\"w-5 h-5\" />
        </div>
        <h2 className={`font-mono text-xs tracking-widest font-bold ${textColor}`}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function UltronDashboard() {
  const router = useRouter();
  const { location, isLoading: isLocationLoading } = useGPS();
  const { 
    messages, input, isLoading, isVoiceActive, 
    addMessage, setInput, setIsLoading, setIsVoiceActive, updateLastMessage, setMessages
  } = useChatStore();

  const [modalType, setModalType] = useState<\"telegram\" | \"vapi\" | \"arbitrage\" | \"trading\" | \"memory\" | \"system\" | \"deploy\" | null>(null);
  const [isArbitrageRunning, setIsArbitrageRunning] = useState(false);
  const [isTradingRunning, setIsTradingRunning] = useState(false);

  useEffect(() => {
    if (typeof window !== \"undefined\" && (window as any).Telegram && (window as any).Telegram.WebApp) {
      const twa = (window as any).Telegram.WebApp;
      twa.ready();
      if (twa.themeParams) {
        document.documentElement.style.setProperty('--tg-theme-bg-color', twa.themeParams.bg_color || '');
        document.documentElement.style.setProperty('--tg-theme-text-color', twa.themeParams.text_color || '');
      }
    }
  }, []);

  const sendMessage = async (e?: React.FormEvent | React.KeyboardEvent, customInput?: string) => {
    if (e && 'preventDefault' in e) e.preventDefault();
    const textToSend = customInput || input;
    if (!textToSend.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: \"user\", content: textToSend };
    
    if (!customInput) {
      addMessage(userMsg);
      setInput(\"\");
    }
    
    setIsLoading(true);

    try {
      const msgsToSend = customInput ? messages : [...messages, userMsg];
      const res = await fetch(\"/api/chat\", {
        method: \"POST\",
        headers: { \"Content-Type\": \"application/json\" },
        body: JSON.stringify({ messages: msgsToSend.map(m => ({ role: m.role, content: m.content })) }),
      });
      
      if (!res.ok) throw new Error(res.statusText);

      const reader = res.body?.getReader();
      if (!reader) throw new Error(\"No reader stream available\");

      const decoder = new TextDecoder();
      let assistantMsg = \"\";
      
      addMessage({ id: (Date.now() + 1).toString(), role: \"assistant\", content: \"\" });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        assistantMsg += decoder.decode(value, { stream: true });
        updateLastMessage(assistantMsg);
      }
    } catch (err: any) {
      toast.error(\"Stream Interrupted: \" + (err.message || \"Connection lost\"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <><Toaster theme=\"dark\" position=\"top-center\" richColors /><div className=\"min-h-screen bg-surface text-slate-200 p-4 md:p-8 font-sans selection:bg-phase1/30 relative overflow-hidden\">
      <div className=\"absolute top-0 left-1/4 w-[500px] h-[500px] bg-phase1/5 rounded-full blur-[120px] pointer-events-none\" />
      <div className=\"absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-phase2/5 rounded-full blur-[150px] pointer-events-none\" />

      <header className=\"flex flex-col md:flex-row justify-between items-center mb-8 gap-4 relative z-10\">
        <div className=\"flex items-center gap-4\">
          <div className=\"relative w-12 h-12 flex items-center justify-center bg-black/40 rounded-xl border border-white/10 shadow-xl overflow-hidden group\">
            <div className=\"absolute inset-0 bg-gradient-to-br from-phase1/20 to-phase2/20 opacity-0 group-hover:opacity-100 transition-opacity\" />
            <BrainCircuit className=\"w-6 h-6 text-phase1\" />
          </div>
          <div>
            <h1 className=\"text-3xl font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-phase1 to-phase2\">
              ULTRON
            </h1>
            <p className=\"text-[10px] text-slate-400 tracking-[0.3em] uppercase mt-0.5\">Tactical Command Center</p>
          </div>
        </div>
      </header>

      <main className=\"grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10\">
        <div className=\"lg:col-span-7 xl:col-span-8 flex flex-col gap-6\">
          <ChatInterface
            messages={messages} isLoading={isLoading}
            sendMessage={sendMessage} input={input} setInput={setInput}
            isVoiceActive={isVoiceActive} setIsVoiceActive={setIsVoiceActive}
          />
        </div>
      </main>
    </div>
    </>
  );
}
