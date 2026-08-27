const fs = require('fs');
let code = fs.readFileSync('src/app/page.tsx', 'utf-8');

// 1. Imports
code = code.replace(
  /import \{([^}]+)\} from "lucide-react";/,
  "import { $1, User } from \"lucide-react\";\nimport { Toaster, toast } from \"sonner\";\nimport TextareaAutosize from \"react-textarea-autosize\";"
);

// 2. State
code = code.replace('const [error, setError] = useState<string | null>(null);', '');
code = code.replace('setError(null);', '');
code = code.replace(/setError\(err\.message\);?/g, 'toast.error(err.message || "Action failed");');

// 3. Alerts
code = code.replace(/alert\('([^']+)'\);/g, "toast.success('$1');");

// 4. Manual Trade catch
code = code.replace(/try \{\s*await fetch\('\/api\/cron\/trading'\);\s*toast\.success\('Gann Trading Cycle Complete\. Check Binance Testnet\.'\);\s*\} finally \{/,
  `try {
      await fetch('/api/cron/trading');
      toast.success('Gann Trading Cycle Complete. Check Binance Testnet.');
    } catch (err: any) {
      toast.error('Trading engine failed: ' + err.message);
    } finally {`
);

// 5. Toaster
code = code.replace('<div className="min-h-screen', '<><Toaster theme="dark" position="top-center" richColors /><div className="min-h-screen');
code = code.replace(/<\/main>\s*<\/div>\s*\);\s*\}/, '</main>\n    </div>\n    </>\n  );\n}');

// 6. ChatInterface replacement
const newChat = `function ChatInterface({ messages, isLoading, sendMessage, input, setInput, isVoiceActive, setIsVoiceActive }: any) {
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
              className={\`flex gap-3 \${msg.role === "user" ? "flex-row-reverse" : "flex-row"}\`}
            >
              <div className={\`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border \${msg.role === "user" ? "bg-slate-800 border-slate-700 text-slate-400" : "bg-phase1/20 border-phase1/40 text-phase1 shadow-[0_0_10px_rgba(0,191,255,0.2)]"}\`}>
                {msg.role === "user" ? <User className="w-4 h-4" /> : <Terminal className="w-4 h-4" />}
              </div>
              <div className={\`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed \${msg.role === "user"
                ? "bg-slate-800/80 border border-slate-700/50 text-slate-100 rounded-tr-none"
                : "bg-phase1/10 border border-phase1/20 text-slate-200 rounded-tl-none shadow-[0_0_15px_rgba(0,191,255,0.05)]"
                }\`}>
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
            className={\`p-3 rounded-xl border transition-all shrink-0 \${isVoiceActive
              ? "bg-phase7/20 border-phase7/40 text-phase7 animate-pulse"
              : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
              }\`}
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

function DashboardModule`;

const chatStart = code.indexOf('function ChatInterface');
const chatEnd = code.indexOf('function DashboardModule');
if (chatStart !== -1 && chatEnd !== -1) {
  code = code.substring(0, chatStart) + newChat + code.substring(chatEnd + 'function DashboardModule'.length);
}

// Update ChatInterface call props
code = code.replace(/<ChatInterface[\s\S]*?\/>/, `<ChatInterface
            messages={messages} isLoading={isLoading}
            sendMessage={sendMessage} input={input} setInput={setInput}
            isVoiceActive={isVoiceActive} setIsVoiceActive={setIsVoiceActive}
          />`);

// Also fix DashboardModule which was partially overwritten
code = code.replace('function DashboardModule{ title, icon: Icon, variant, children }: any) {', 'function DashboardModule({ title, icon: Icon, variant, children }: any) {');

fs.writeFileSync('src/app/page.tsx', code);
console.log('page.tsx upgraded!');
