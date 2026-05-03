import { useState, useRef, useEffect } from "react";
import { Send, User } from "lucide-react";
import { Button } from "@/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrandMark } from "@/components/brand/BrandMark";

const markdownComponents = {
  p: (props: { children?: React.ReactNode }) => (
    <p className="mb-1 last:mb-0 text-xs">{props.children}</p>
  ),
  ul: (props: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside mb-1 space-y-0.5 pl-2 text-xs">
      {props.children}
    </ul>
  ),
  ol: (props: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside mb-1 space-y-0.5 pl-2 text-xs">
      {props.children}
    </ol>
  ),
  li: (props: { children?: React.ReactNode }) => (
    <li className="ml-1 text-xs">{props.children}</li>
  ),
  strong: (props: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-xs">{props.children}</strong>
  ),
  em: (props: { children?: React.ReactNode }) => (
    <em className="italic text-xs">{props.children}</em>
  ),
  code: (props: { children?: React.ReactNode }) => (
    <code className="bg-gray-200 px-1 py-0.5 rounded text-xs font-mono">
      {props.children}
    </code>
  ),
  h1: (props: { children?: React.ReactNode }) => (
    <h1 className="text-sm font-bold mb-1 text-xs">{props.children}</h1>
  ),
  h2: (props: { children?: React.ReactNode }) => (
    <h2 className="text-xs font-bold mb-1 text-xs">{props.children}</h2>
  ),
  h3: (props: { children?: React.ReactNode }) => (
    <h3 className="text-xs font-semibold mb-0.5 text-xs">{props.children}</h3>
  ),
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

interface ChatPanelProps {
  messages: Message[];
  onSendMessage: (message: string) => void;
  isGenerating?: boolean;
}

export function ChatPanel({
  messages,
  onSendMessage,
  isGenerating = false,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (input.trim() && !isGenerating) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-white border-r border-gray-200">
      {/* Header */}
      <div className="px-4 py-2 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <BrandMark variant="mark" className="h-4 text-white" />
          Proyekto AI
        </h2>
        <p className="text-xs text-gray-600 mt-1">
          Ask questions or request changes to your roadmap
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {messages.length === 0 && (
          <div className="text-center py-6 text-gray-500">
            <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center">
              P
            </div>
            <p className="text-xs">
              Start a conversation to build your roadmap
            </p>
            <p className="text-xs mt-1 text-gray-400">
              Try: "Add a design phase" or "What's the timeline?"
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {message.role === "assistant" && (
              <div className="w-6 h-6 flex items-center justify-center shrink-0">
                <BrandMark variant="mark" className="h-4 text-white" />
              </div>
            )}

            <div
              className={`max-w-[80%] rounded-xl px-3 py-2 ${
                message.role === "user"
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {message.role === "assistant" ? (
                <div className="text-xs leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {String(message.content)}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs leading-relaxed whitespace-pre-wrap">
                  {message.content}
                </p>
              )}
              <span className="text-xs opacity-70 mt-1 block">
                {message.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>

            {message.role === "user" && (
              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-gray-600" />
              </div>
            )}
          </div>
        ))}

        {isGenerating && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 flex items-center justify-center shrink-0">
              <BrandMark variant="mark" className="h-4 text-white" />
            </div>
            <div className="bg-gray-100 text-gray-900 rounded-xl px-3 py-2">
              <div className="flex gap-1">
                <div
                  className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-2 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            disabled={isGenerating}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-4xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            variant="contained"
            colorScheme="primary"
            className="px-3 py-2"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
