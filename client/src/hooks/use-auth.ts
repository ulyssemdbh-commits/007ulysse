import { createContext, useContext } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface User {
  id: number;
  username: string;
  displayName: string | null;
  role: string;
  isOwner: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  needsSetup: boolean;
  requires2FA: boolean;
  login: (username: string, password: string) => Promise<any>;
  logout: () => Promise<void>;
  setup: (username: string, password: string, displayName: string) => Promise<void>;
  verify2FA: (code: string) => Promise<any>;
  resend2FA: () => Promise<any>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function useAuthStatus() {
  return useQuery<{ ownerExists: boolean; needsSetup: boolean }>({
    queryKey: ["/api/auth/status"],
  });
}

export function useCurrentUser() {
  return useQuery<{ user: User; requires2FA?: boolean }>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
    },
  });
}

export function useVerify2FA() {
  return useMutation({
    mutationFn: async (data: { code: string }) => {
      const res = await apiRequest("POST", "/api/auth/2fa/verify", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}

export function useResend2FA() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/resend");
      return res.json();
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/logout");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}

export function useSetup() {
  return useMutation({
    mutationFn: async (data: { username: string; password: string; displayName: string }) => {
      const res = await apiRequest("POST", "/api/auth/setup", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
    },
  });
}
