import { useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Mic, MicOff, Paperclip, X, Loader2, Image, File } from "lucide-react";

interface MobileInputAreaProps {
  input: string;
  setInput: (value: string) => void;
  selectedFiles: File[];
  isListening: boolean;
  isProcessing: boolean;
  isThinking: boolean;
  onSend: () => void;
  onToggleListening: () => void;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (index: number) => void;
}

export function MobileInputArea({
  input,
  setInput,
  selectedFiles,
  isListening,
  isProcessing,
  isThinking,
  onSend,
  onToggleListening,
  onFileSelect,
  onRemoveFile,
}: MobileInputAreaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSend();
  };

  return (
    <div className="p-4 border-t border-border/30 bg-background/80 backdrop-blur-xl">
      <AnimatePresence>
        {selectedFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-2 mb-3"
          >
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm"
              >
                {file.type.startsWith("image/") ? (
                  <Image className="w-3.5 h-3.5" />
                ) : (
                  <File className="w-3.5 h-3.5" />
                )}
                <span className="max-w-[100px] truncate">{file.name}</span>
                <button
                  onClick={() => onRemoveFile(index)}
                  className="w-4 h-4 rounded-full bg-muted-foreground/20 flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp,.heic"
          onChange={onFileSelect}
          className="hidden"
          data-testid="input-file"
        />
        
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-11 h-11 rounded-full flex items-center justify-center glass-button shrink-0"
          data-testid="button-attach"
        >
          <Paperclip className="w-5 h-5 text-muted-foreground" />
        </button>

        <div className="flex-1 relative">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Écrivez votre message..."
            className="pr-12 h-11 rounded-full bg-muted/50 border-0 focus-visible:ring-1 focus-visible:ring-primary/50"
            disabled={isProcessing || isThinking}
            data-testid="input-message"
          />
        </div>

        <button
          type="button"
          onClick={onToggleListening}
          disabled={isProcessing || isThinking}
          className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all ${
            isListening 
              ? "bg-red-500 text-white animate-pulse" 
              : "glass-button"
          }`}
          data-testid="button-voice"
        >
          {isListening ? (
            <MicOff className="w-5 h-5" />
          ) : (
            <Mic className="w-5 h-5 text-muted-foreground" />
          )}
        </button>

        <Button
          type="submit"
          size="icon"
          disabled={(!input.trim() && selectedFiles.length === 0) || isProcessing || isThinking}
          className="w-11 h-11 rounded-full ai-gradient shrink-0"
          data-testid="button-send"
        >
          {isProcessing || isThinking ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </Button>
      </form>
    </div>
  );
}
