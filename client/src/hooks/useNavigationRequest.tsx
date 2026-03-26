import { useState, useCallback, createContext, useContext, ReactNode } from "react";

export interface NavigationDestination {
  address: string;
  coordinates?: { lat: number; lng: number };
}

interface NavigationRequestState {
  isOpen: boolean;
  destination: NavigationDestination | null;
  requestNavigation: (address: string, coordinates?: { lat: number; lng: number }) => void;
  closeNavigation: () => void;
  clearDestination: () => void;
}

const NavigationRequestContext = createContext<NavigationRequestState | null>(null);

export function useNavigationRequest() {
  const ctx = useContext(NavigationRequestContext);
  if (!ctx) throw new Error("useNavigationRequest must be used within NavigationRequestProvider");
  return ctx;
}

interface NavigationRequestProviderProps {
  children: ReactNode;
  onOpenPanel?: () => void;
}

export function NavigationRequestProvider({ children, onOpenPanel }: NavigationRequestProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [destination, setDestination] = useState<NavigationDestination | null>(null);

  const requestNavigation = useCallback((address: string, coordinates?: { lat: number; lng: number }) => {
    setDestination({ address, coordinates });
    setIsOpen(true);
    onOpenPanel?.();
  }, [onOpenPanel]);

  const closeNavigation = useCallback(() => {
    setIsOpen(false);
  }, []);

  const clearDestination = useCallback(() => {
    setDestination(null);
  }, []);

  const value: NavigationRequestState = {
    isOpen,
    destination,
    requestNavigation,
    closeNavigation,
    clearDestination,
  };

  return (
    <NavigationRequestContext.Provider value={value}>
      {children}
    </NavigationRequestContext.Provider>
  );
}

export function parseNavigationFromResponse(text: string): string | null {
  const match = text.match(/\[NAVIGATION:\s*(.+?)\]/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

export function removeNavigationTagFromResponse(text: string): string {
  return text.replace(/\[NAVIGATION:\s*.+?\]/gi, "").trim();
}
