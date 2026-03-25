import { useState, useEffect, useCallback, useRef } from "react";

interface UseVisibilityOptions {
  onVisible?: () => void;
  onHidden?: () => void;
  pauseAfterMs?: number;
}

export function useVisibility(options: UseVisibilityOptions = {}) {
  const { onVisible, onHidden, pauseAfterMs = 30000 } = options;
  const [isVisible, setIsVisible] = useState(!document.hidden);
  const [isPaused, setIsPaused] = useState(false);
  const hiddenTimeRef = useRef<number | null>(null);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleVisibilityChange = useCallback(() => {
    const nowHidden = document.hidden;
    setIsVisible(!nowHidden);

    if (nowHidden) {
      hiddenTimeRef.current = Date.now();
      pauseTimeoutRef.current = setTimeout(() => {
        setIsPaused(true);
        onHidden?.();
      }, pauseAfterMs);
    } else {
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
        pauseTimeoutRef.current = null;
      }
      
      if (isPaused) {
        setIsPaused(false);
        onVisible?.();
      }
      hiddenTimeRef.current = null;
    }
  }, [isPaused, onHidden, onVisible, pauseAfterMs]);

  useEffect(() => {
    const handlePageHide = () => {
      onHidden?.();
    };
    
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        onVisible?.();
      }
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
    };
  }, [handleVisibilityChange, onHidden, onVisible]);

  return { isVisible, isPaused };
}

export function useReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}

export function useIOSDetection() {
  const [isIOS, setIsIOS] = useState(false);
  const [isIPhone15Pro, setIsIPhone15Pro] = useState(false);
  const [devicePixelRatio, setDevicePixelRatio] = useState(1);
  const [screenWidth, setScreenWidth] = useState(0);

  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua);
    setIsIOS(ios);
    setDevicePixelRatio(window.devicePixelRatio || 1);
    setScreenWidth(window.screen.width);

    const width = window.screen.width;
    const height = window.screen.height;
    const ratio = window.devicePixelRatio;

    const isIPhone15ProSize = 
      (width === 393 && height === 852 && ratio === 3) ||
      (width === 430 && height === 932 && ratio === 3);
    
    setIsIPhone15Pro(ios && isIPhone15ProSize);
  }, []);

  return { isIOS, isIPhone15Pro, devicePixelRatio, screenWidth };
}
