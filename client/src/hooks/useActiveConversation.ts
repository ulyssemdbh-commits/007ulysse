import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "ulysse-active-conversation";

export function useActiveConversation() {
  const [activeConversationId, setActiveConversationId] = useState<number | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : null;
  });

  const selectConversation = useCallback((id: number | null) => {
    setActiveConversationId(id);
    if (id !== null) {
      localStorage.setItem(STORAGE_KEY, id.toString());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (activeConversationId !== null) {
      localStorage.setItem(STORAGE_KEY, activeConversationId.toString());
    }
  }, [activeConversationId]);

  return {
    activeConversationId,
    setActiveConversationId: selectConversation,
  };
}
