/**
 * Auth Hook — Standalone SUGUVal.
 * Simplified auth for standalone deployment.
 */
import { useState } from "react";

interface User {
  id: number;
  username: string;
  role: string;
}

export function useAuth() {
  const [user] = useState<User | null>({ id: 1, username: "admin", role: "admin" });

  return {
    user,
    isAuthenticated: true,
    isLoading: false,
    needsSetup: false,
    login: async (_username: string, _password: string) => {},
    logout: async () => {},
  };
}
