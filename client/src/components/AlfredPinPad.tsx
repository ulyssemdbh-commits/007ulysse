import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Lock, Delete, CheckCircle2, XCircle } from "lucide-react";

interface AlfredPinPadProps {
  correctPin: string;
  onSuccess: () => void;
  onCancel?: () => void;
  className?: string;
}

const PIN_LENGTH = 6;
const CORRECT_PIN = "115256";

export function AlfredPinPad({ correctPin = CORRECT_PIN, onSuccess, onCancel, className }: AlfredPinPadProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const handleDigit = useCallback((digit: string) => {
    if (pin.length >= PIN_LENGTH || success) return;
    
    setError(false);
    const newPin = pin + digit;
    setPin(newPin);

    if (newPin.length === PIN_LENGTH) {
      if (newPin === correctPin) {
        setSuccess(true);
        setTimeout(() => {
          onSuccess();
        }, 500);
      } else {
        setError(true);
        setAttempts(prev => prev + 1);
        setTimeout(() => {
          setPin("");
          setError(false);
        }, 800);
      }
    }
  }, [pin, correctPin, onSuccess, success]);

  const handleDelete = useCallback(() => {
    if (success) return;
    setPin(prev => prev.slice(0, -1));
    setError(false);
  }, [success]);

  const handleClear = useCallback(() => {
    if (success) return;
    setPin("");
    setError(false);
  }, [success]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        handleDelete();
      } else if (e.key === "Escape" && onCancel) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDigit, handleDelete, onCancel]);

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""];

  return (
    <div className={cn("flex flex-col items-center gap-6", className)} data-testid="alfred-pin-pad">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center gap-4"
      >
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shadow-lg">
          <Lock className="w-8 h-8 text-white" />
        </div>
        
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground">Max</h2>
          <p className="text-sm text-muted-foreground">Entrez votre code PIN</p>
        </div>
      </motion.div>

      <div className="flex gap-3 justify-center" data-testid="pin-display">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <motion.div
            key={i}
            animate={{
              scale: error ? [1, 1.1, 1] : success && i < pin.length ? [1, 1.2, 1] : 1,
              backgroundColor: error 
                ? "hsl(var(--destructive))" 
                : success && i < pin.length
                ? "hsl(142 76% 36%)"
                : i < pin.length 
                ? "hsl(var(--primary))" 
                : "hsl(var(--muted))",
            }}
            transition={{ duration: 0.15, delay: error || success ? i * 0.05 : 0 }}
            className={cn(
              "w-4 h-4 rounded-full transition-colors",
              i < pin.length ? "bg-primary" : "bg-muted"
            )}
            data-testid={`pin-dot-${i}`}
          />
        ))}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 text-destructive text-sm"
          >
            <XCircle className="w-4 h-4" />
            <span>Code incorrect {attempts > 2 ? `(${attempts} tentatives)` : ""}</span>
          </motion.div>
        )}
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Accès autorisé</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-3 gap-3" data-testid="pin-keypad">
        {digits.map((digit, i) => (
          <div key={i} className="w-16 h-16">
            {digit ? (
              <Button
                variant="outline"
                className={cn(
                  "w-full h-full text-2xl font-semibold hover-elevate",
                  "border-2 rounded-xl transition-all"
                )}
                onClick={() => handleDigit(digit)}
                disabled={success}
                data-testid={`pin-key-${digit}`}
              >
                {digit}
              </Button>
            ) : i === 9 ? (
              <Button
                variant="ghost"
                className="w-full h-full text-muted-foreground hover-elevate"
                onClick={handleClear}
                disabled={success || pin.length === 0}
                data-testid="pin-key-clear"
              >
                C
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="w-full h-full hover-elevate"
                onClick={handleDelete}
                disabled={success || pin.length === 0}
                data-testid="pin-key-delete"
              >
                <Delete className="w-5 h-5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {onCancel && (
        <Button
          variant="ghost"
          className="text-muted-foreground text-sm"
          onClick={onCancel}
          data-testid="button-pin-cancel"
        >
          Annuler
        </Button>
      )}
    </div>
  );
}

export function useAlfredPinAuth() {
  const STORAGE_KEY = "alfred_pin_auth";
  const TIMEOUT_MS = 5 * 60 * 1000;

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [lastActivity, setLastActivity] = useState<number>(Date.now());

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const { timestamp } = JSON.parse(stored);
      const elapsed = Date.now() - timestamp;
      if (elapsed < TIMEOUT_MS) {
        setIsAuthenticated(true);
        setLastActivity(timestamp);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    const checkTimeout = () => {
      const elapsed = Date.now() - lastActivity;
      if (elapsed > TIMEOUT_MS) {
        setIsAuthenticated(false);
        localStorage.removeItem(STORAGE_KEY);
      }
    };

    const interval = setInterval(checkTimeout, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, lastActivity]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const updateActivity = () => {
      const now = Date.now();
      setLastActivity(now);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ timestamp: now }));
    };

    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach(event => window.addEventListener(event, updateActivity, { passive: true }));
    
    return () => {
      events.forEach(event => window.removeEventListener(event, updateActivity));
    };
  }, [isAuthenticated]);

  const authenticate = useCallback(() => {
    const now = Date.now();
    setIsAuthenticated(true);
    setLastActivity(now);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ timestamp: now }));
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    isAuthenticated,
    authenticate,
    logout,
    timeoutMs: TIMEOUT_MS,
  };
}
