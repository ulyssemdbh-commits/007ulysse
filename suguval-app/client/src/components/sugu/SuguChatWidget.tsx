/**
 * SuguChatWidget — Standalone SUGUVal.
 * Minimal chat widget stub. Replace with full AI chat implementation.
 */
import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

export function SuguChatWidget({ restaurant }: { restaurant?: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-primary text-primary-foreground rounded-full p-4 shadow-lg hover:scale-105 transition-transform"
        aria-label="Ouvrir le chat"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 h-96 bg-card border border-border rounded-xl shadow-2xl flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="font-semibold text-sm">Assistant SUGU {restaurant}</span>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 p-4 flex items-center justify-center text-muted-foreground text-sm">
        Chat AI — Configurez OPENAI_API_KEY pour activer
      </div>
    </div>
  );
}
