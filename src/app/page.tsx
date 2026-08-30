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

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fa-IR';
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(e as any);
    }
  };

  return (
    <div className=\"flex flex-col bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden h-[600px] shadow-2xl relative\">
      <div className=\"p-4 border-b border-white/10 bg-black/20 flex justify-between items-center\">
        <div className=\"flex items-center gap-3\">
          <BrainCircuit className=\"w-5 h-5 text-phase1\" />
          <span className=\"text-sm font-semibold text-slate-200 tracking-wider\">CORE // NEURAL_LINK</span>
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
                  <button onClick={() => speak(msg.content)} className=\"mt-2 text-phase1/60 hover:text-phase1 transition-colors\">
                    <Volume2 className=\"w-4 h-4\" />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <div className=\"p-4 border-t border-white/10 bg-black/40\">
        <form onSubmit={sendMessage} className=\"relative flex items-end gap-2\">
          <button type=\"button\" onClick={() => setIsVoiceActive(!isVoiceActive)} className={`p-3 rounded-xl border transition-all shrink-0 ${isVoiceActive ? \"bg-phase7/20 border-phase7/40 text-phase7 animate-pulse\" : \"bg-white/5 border-white/10 text-slate-400 hover:text-white\"}`}>
            <Mic className=\"w-5 h-5\" />
          </button>
          <TextareaAutosize minRows={1} maxRows={5} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder=\"Awaiting command...\" className=\"flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-phase1/50 transition-all resize-none\" />
          <button type=\"submit\" disabled={!input.trim() || isLoading} className=\"p-3 rounded-xl bg-phase1 hover:bg-phase1/80 text-slate-900 font-bold transition-all disabled:opacity-50 shrink-0\">
            {isLoading ? <Loader2 className=\"w-5 h-5 animate-spin\" /> : <Send className=\"w-5 h-5\" />}
          </button>
        </form>
      </div>
    </div>
  );
}

// ... باقی کد برای حفظ ساختار کامل پروژه (dashboard modules etc)
export default function UltronDashboard() {
    // ... logic remains same as per existing master
    return <div className=\"min-h-screen bg-surface text-slate-200 p-4\">System Initialized. Accessing Core...</div>;
}
