import { create } from 'zustand';

export type Message = { id: string; role: "user" | "assistant" | "system"; content: string };

interface ChatState {
  messages: Message[];
  input: string;
  isLoading: boolean;
  isVoiceActive: boolean;
  
  // Actions
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  addMessage: (message: Message) => void;
  updateLastMessage: (content: string) => void;
  setInput: (input: string) => void;
  setIsLoading: (loading: boolean) => void;
  setIsVoiceActive: (active: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [{ id: "1", role: "assistant", content: "ULTRON INITIALIZED. Awaiting command directive." }],
  input: "",
  isLoading: false,
  isVoiceActive: false,

  setMessages: (messages) => set((state) => ({ 
    messages: typeof messages === 'function' ? messages(state.messages) : messages 
  })),
  
  addMessage: (message) => set((state) => ({ 
    messages: [...state.messages, message] 
  })),

  updateLastMessage: (content) => set((state) => {
    const newMsgs = [...state.messages];
    if (newMsgs.length > 0) {
      newMsgs[newMsgs.length - 1].content = content;
    }
    return { messages: newMsgs };
  }),

  setInput: (input) => set({ input }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsVoiceActive: (active) => set({ isVoiceActive: active }),
}));
