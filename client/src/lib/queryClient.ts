import { QueryClient, QueryFunction } from "@tanstack/react-query";

function isDevmaxPath(): boolean {
  const p = window.location.pathname;
  return p.startsWith('/devmax') || p === '/devops-max';
}

function redirectToLoginOnSessionExpired() {
  const currentPath = window.location.pathname;
  const publicPaths = ['/login', '/setup', '/'];
  const hasInlineAuth = currentPath.startsWith('/talking') || currentPath === '/suguval' || currentPath === '/sugumaillane';
  const isPublicPage = currentPath.startsWith('/courses/suguval') || currentPath.startsWith('/courses/sugumaillane');
  if (!publicPaths.includes(currentPath) && !hasInlineAuth && !isPublicPage && !isDevmaxPath()) {
    window.location.href = '/login';
  }
}

async function throwIfResNotOk(res: Response, skipRedirectOn401 = false) {
  if (!res.ok) {
    if (res.status === 401 && !skipRedirectOn401 && !isDevmaxPath()) {
      redirectToLoginOnSessionExpired();
    }
    if (res.status === 401 && isDevmaxPath()) {
      return;
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  const isAuthEndpoint = url.includes('/api/auth/');
  await throwIfResNotOk(res, isAuthEndpoint);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw" | "redirect";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey[0] as string;
    const res = await fetch(url, {
      credentials: "include",
    });

    if (res.status === 401) {
      if (isDevmaxPath() || unauthorizedBehavior === "returnNull") {
        return null;
      }
      if (unauthorizedBehavior === "redirect") {
        redirectToLoginOnSessionExpired();
      }
    }

    const isAuthEndpoint = url.includes('/api/auth/');
    await throwIfResNotOk(res, isAuthEndpoint);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "redirect" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
