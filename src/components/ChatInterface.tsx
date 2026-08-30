import React from 'react';
import { Volume2 } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const ChatInterface = ({ messages }: { messages: Message[] }) => {
  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fa-IR';
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg, i) => (
        <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
          <div className="p-3 rounded-lg bg-gray-100 max-w-md">
            <p>{msg.text}</p>
          </div>
          {msg.role === 'assistant' && (
            <button 
              onClick={() => speak(msg.text)} 
              className="mt-1 p-1 text-gray-500 hover:text-blue-600 transition-colors"
              title="پخش صوتی"
            >
              <Volume2 size={18} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default ChatInterface;