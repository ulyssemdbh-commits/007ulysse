import { ReactNode, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AuthContext } from "@/hooks/use-auth";

interface User {
  id: number;
  username: string;
  displayName: string | null;
  role: string;
  isOwner: boolean;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { data: statusData, isLoading: statusLoading } = useQuery<{ ownerExists: boolean; needsSetup: boolean }>({
    queryKey: ["/api/auth/status"],
  });

  const { data: userData, isLoading: userLoading, error } = useQuery<{ user: User; requires2FA?: boolean }>({
    queryKey: ["/api/auth/me"],
    retry: false,
    enabled: statusData?.ownerExists ?? false,
  });

  const loginMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
    },
  });

  const verify2FAMutation = useMutation({
    mutationFn: async (data: { code: string }) => {
      const res = await apiRequest("POST", "/api/auth/2fa/verify", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const resend2FAMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/resend");
      return res.json();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/logout");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const setupMutation = useMutation({
    mutationFn: async (data: { username: string; password: string; displayName: string }) => {
      const res = await apiRequest("POST", "/api/auth/setup", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
    },
  });

  const value = useMemo(() => ({
    user: userData?.user ?? null,
    isLoading: statusLoading || userLoading,
    isAuthenticated: !!userData?.user,
    needsSetup: statusData?.needsSetup ?? false,
    requires2FA: userData?.requires2FA ?? false,
    login: async (username: string, password: string) => {
      const result = await loginMutation.mutateAsync({ username, password });
      return result;
    },
    logout: async () => {
      await logoutMutation.mutateAsync();
      const path = window.location.pathname;
      const hasInlineAuth = path.startsWith("/talking") || path === "/suguval" || path === "/sugumaillane";
      if (!hasInlineAuth) {
        window.location.href = "/login";
      }
    },
    setup: async (username: string, password: string, displayName: string) => {
      await setupMutation.mutateAsync({ username, password, displayName });
    },
    verify2FA: async (code: string) => {
      const result = await verify2FAMutation.mutateAsync({ code });
      return result;
    },
    resend2FA: async () => {
      const result = await resend2FAMutation.mutateAsync();
      return result;
    },
  }), [userData, statusData, statusLoading, userLoading]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
