const fs = require('fs');

// 1. Update maxDuration
let chatApi = fs.readFileSync('src/app/api/chat/route.ts', 'utf-8');
chatApi = chatApi.replace('export const maxDuration = 30;', 'export const maxDuration = 60;');
if (!chatApi.includes('import "@/lib/env"')) {
  chatApi = chatApi.replace('import { generateAIResponse } from "@/lib/ai";', 'import { generateAIResponse } from "@/lib/ai";\nimport "@/lib/env";');
}
fs.writeFileSync('src/app/api/chat/route.ts', chatApi);

// 2. Create env validation
const envCode = `import { z } from "zod";

const envSchema = z.object({
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1, "Google API Key is missing"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("Invalid Supabase URL").optional().or(z.literal('')),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "Supabase Anon Key is missing").optional().or(z.literal('')),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.format());
}

export const env = _env.success ? _env.data : process.env;
`;
fs.writeFileSync('src/lib/env.ts', envCode);

// 3. Fix page.tsx streaming and add retry
let pageCode = fs.readFileSync('src/app/page.tsx', 'utf-8');

const oldSendMessage = `  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok) throw new Error("API Connection Failed");

      const data = await res.json();
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: data.text }]);
    } catch (err: any) {
      toast.error(err.message || "Failed to communicate with Neural Link");
    } finally {
      setIsLoading(false);
    }
  };`;

const newSendMessage = `  const [retryInput, setRetryInput] = useState<string | null>(null);

  const sendMessage = async (e?: React.FormEvent, customInput?: string) => {
    e?.preventDefault();
    const textToSend = customInput || input;
    if (!textToSend.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: textToSend };
    
    // Only append user message if it's not a retry
    if (!customInput) {
      setMessages(prev => [...prev, userMsg]);
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
      
      if (!res.ok) throw new Error("API Connection Failed: " + res.statusText);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader stream available");

      const decoder = new TextDecoder();
      let assistantMsg = "";
      
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        assistantMsg += decoder.decode(value, { stream: true });
        setMessages(prev => {
          const newMsgs = [...prev];
          newMsgs[newMsgs.length - 1].content = assistantMsg;
          return newMsgs;
        });
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
  };`;

if (pageCode.includes('setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: data.text }]);')) {
  pageCode = pageCode.replace(oldSendMessage, newSendMessage);
  fs.writeFileSync('src/app/page.tsx', pageCode);
  console.log('page.tsx upgraded for streaming!');
} else {
  console.log('Could not find old sendMessage block to replace.');
}

