import { useState, useEffect, useCallback, useRef } from 'react';

interface WakeLockState {
  isSupported: boolean;
  isActive: boolean;
  error: string | null;
}

interface UseWakeLockReturn extends WakeLockState {
  requestWakeLock: () => Promise<boolean>;
  releaseWakeLock: () => Promise<void>;
  toggleWakeLock: () => Promise<void>;
}

export function useWakeLock(autoActivate = false): UseWakeLockReturn {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const [state, setState] = useState<WakeLockState>({
    isSupported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
    isActive: false,
    error: null,
  });

  const requestWakeLock = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      setState(prev => ({ ...prev, error: 'Wake Lock non supporté par ce navigateur' }));
      return false;
    }

    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      
      wakeLockRef.current.addEventListener('release', () => {
        console.log('[WakeLock] Released');
        wakeLockRef.current = null;
        setState(prev => ({ ...prev, isActive: false }));
      });

      console.log('[WakeLock] Activated - screen will stay awake');
      setState(prev => ({ ...prev, isActive: true, error: null }));
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';
      console.error('[WakeLock] Failed to activate:', errorMessage);
      setState(prev => ({ ...prev, error: errorMessage, isActive: false }));
      return false;
    }
  }, [state.isSupported]);

  const releaseWakeLock = useCallback(async (): Promise<void> => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('[WakeLock] Manually released');
        setState(prev => ({ ...prev, isActive: false }));
      } catch (err) {
        console.error('[WakeLock] Failed to release:', err);
      }
    }
  }, []);

  const toggleWakeLock = useCallback(async (): Promise<void> => {
    if (state.isActive) {
      await releaseWakeLock();
    } else {
      await requestWakeLock();
    }
  }, [state.isActive, requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && state.isActive && !wakeLockRef.current) {
        console.log('[WakeLock] Re-acquiring after tab became visible');
        await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [state.isActive, requestWakeLock]);

  useEffect(() => {
    if (autoActivate && state.isSupported) {
      requestWakeLock();
    }

    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
      }
    };
  }, [autoActivate, state.isSupported]);

  return {
    ...state,
    requestWakeLock,
    releaseWakeLock,
    toggleWakeLock,
  };
}
