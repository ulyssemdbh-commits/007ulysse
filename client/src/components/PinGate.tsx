import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Delete, ShieldAlert, Clock } from "lucide-react";

const PIN_CODE = "102040";
const STORAGE_KEY = "pin_gate_state";
const SESSION_KEY = "pin_gate_unlocked";
const LOCKOUT_TIER1_MS = 60 * 1000;
const LOCKOUT_TIER2_MS = 24 * 60 * 60 * 1000;

interface LockState {
  failedAttempts: number;
  lockedUntil: number | null;
  tier: number;
}

function getLockState(): LockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.lockedUntil && Date.now() >= parsed.lockedUntil) {
        const cleared: LockState = { ...parsed, lockedUntil: null };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleared));
        return cleared;
      }
      return parsed;
    }
  } catch {}
  return { failedAttempts: 0, lockedUntil: null, tier: 0 };
}

function saveLockState(state: LockState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function isSessionUnlocked(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === "true";
}

function markSessionUnlocked() {
  sessionStorage.setItem(SESSION_KEY, "true");
}

export function PinGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(isSessionUnlocked);
  const [enteredPin, setEnteredPin] = useState("");
  const [error, setError] = useState("");
  const [lockState, setLockState] = useState<LockState>(getLockState);
  const lockStateRef = useRef(lockState);
  lockStateRef.current = lockState;

  const computeRemaining = () => {
    if (!lockState.lockedUntil) return 0;
    return Math.max(0, lockState.lockedUntil - Date.now());
  };
  const [remainingTime, setRemainingTime] = useState(computeRemaining);

  const isLocked = lockState.lockedUntil !== null && Date.now() < lockState.lockedUntil;

  useEffect(() => {
    if (!lockState.lockedUntil) return;
    setRemainingTime(Math.max(0, lockState.lockedUntil - Date.now()));
    const interval = setInterval(() => {
      const remaining = lockStateRef.current.lockedUntil
        ? lockStateRef.current.lockedUntil - Date.now()
        : 0;
      if (remaining <= 0) {
        setRemainingTime(0);
        setLockState(prev => {
          const updated = { ...prev, lockedUntil: null };
          saveLockState(updated);
          return updated;
        });
      } else {
        setRemainingTime(remaining);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockState.lockedUntil]);

  const attemptsInCurrentTier = lockState.tier === 0
    ? lockState.failedAttempts
    : lockState.failedAttempts - 3;
  const attemptsRemaining = lockState.tier === 0
    ? 3 - lockState.failedAttempts
    : 6 - lockState.failedAttempts;

  const handleSubmit = useCallback(() => {
    const current = lockStateRef.current;
    if (current.lockedUntil && Date.now() < current.lockedUntil) return;
    if (enteredPin.length === 0) return;

    if (enteredPin === PIN_CODE) {
      markSessionUnlocked();
      setUnlocked(true);
      const newState: LockState = { failedAttempts: 0, lockedUntil: null, tier: 0 };
      setLockState(newState);
      saveLockState(newState);
      setError("");
    } else {
      const newAttempts = current.failedAttempts + 1;
      let lockedUntil: number | null = null;
      let newTier = current.tier;

      if (newAttempts >= 6) {
        lockedUntil = Date.now() + LOCKOUT_TIER2_MS;
        newTier = 2;
      } else if (newAttempts >= 3 && current.tier === 0) {
        lockedUntil = Date.now() + LOCKOUT_TIER1_MS;
        newTier = 1;
      }

      const newState: LockState = { failedAttempts: newAttempts, lockedUntil, tier: newTier };
      setLockState(newState);
      saveLockState(newState);
      setEnteredPin("");

      if (newAttempts >= 6) {
        setError("Trop de tentatives. Accès bloqué pendant 24 heures.");
      } else if (newAttempts >= 3 && newTier === 1 && lockedUntil) {
        setError("3 échecs. Accès bloqué pendant 1 minute.");
      } else {
        const remaining = newTier === 0 ? 3 - newAttempts : 6 - newAttempts;
        setError(`Code incorrect. ${remaining} tentative(s) restante(s).`);
      }
    }
  }, [enteredPin]);

  const handleDigit = useCallback((digit: string) => {
    const current = lockStateRef.current;
    if (current.lockedUntil && Date.now() < current.lockedUntil) return;
    setEnteredPin(prev => {
      if (prev.length >= 6) return prev;
      return prev + digit;
    });
    setError("");
  }, []);

  const handleDelete = useCallback(() => {
    setEnteredPin(prev => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setEnteredPin("");
  }, []);

  useEffect(() => {
    if (enteredPin.length === 6) {
      handleSubmit();
    }
  }, [enteredPin, handleSubmit]);

  useEffect(() => {
    if (unlocked) return;
    const handler = (e: KeyboardEvent) => {
      const current = lockStateRef.current;
      if (current.lockedUntil && Date.now() < current.lockedUntil) return;
      if (e.key >= "0" && e.key <= "9") {
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        handleDelete();
      } else if (e.key === "Escape") {
        handleClear();
      } else if (e.key === "Enter") {
        handleSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [unlocked, handleDigit, handleDelete, handleClear, handleSubmit]);

  if (unlocked) return <>{children}</>;

  const formatTime = (ms: number) => {
    const totalSec = Math.ceil(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6 space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">Accès protégé</h2>
          <p className="text-sm text-muted-foreground text-center">
            Entrez le code PIN pour accéder
          </p>
        </div>

        <div className="flex justify-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-colors ${
                i < enteredPin.length ? "bg-primary" : "bg-muted"
              }`}
              data-testid={`pin-dot-${i}`}
            />
          ))}
        </div>

        {isLocked && (
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2 text-destructive text-sm">
              <ShieldAlert className="w-4 h-4" />
              <span>Accès bloqué</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground text-sm">
              <Clock className="w-4 h-4" />
              <span>Réessayez dans {formatTime(remainingTime)}</span>
            </div>
          </div>
        )}

        {error && !isLocked && (
          <p className="text-destructive text-sm text-center" data-testid="text-pin-error">{error}</p>
        )}

        <div className="grid grid-cols-3 gap-2">
          {digits.map((digit, i) => {
            if (digit === "" && i === 9) {
              return (
                <Button
                  key="clear"
                  variant="ghost"
                  size="lg"
                  onClick={handleClear}
                  disabled={isLocked || enteredPin.length === 0}
                  data-testid="button-pin-clear"
                  className="text-sm"
                >
                  Effacer
                </Button>
              );
            }
            if (digit === "" && i === 11) {
              return (
                <Button
                  key="delete"
                  variant="ghost"
                  size="icon"
                  onClick={handleDelete}
                  disabled={isLocked || enteredPin.length === 0}
                  data-testid="button-pin-delete"
                  className="mx-auto"
                >
                  <Delete className="w-5 h-5" />
                </Button>
              );
            }
            return (
              <Button
                key={digit}
                variant="outline"
                size="lg"
                onClick={() => handleDigit(digit)}
                disabled={isLocked}
                data-testid={`button-pin-${digit}`}
                className="text-lg font-medium"
              >
                {digit}
              </Button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
