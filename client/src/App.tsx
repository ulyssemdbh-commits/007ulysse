import { Switch, Route, useLocation, Redirect } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/components/AuthProvider";
import { VoiceProvider } from "@/components/VoiceProvider";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";
import { PinGate } from "@/components/PinGate";
import { useAutoReconnect } from "@/hooks/useAutoReconnect";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { useUiSnapshot } from "@/hooks/useUiSnapshot";
import { useDashboardScreenshot } from "@/hooks/useDashboardScreenshot";
import { InactivityGuard } from "@/components/InactivityGuard";
import { UlysseChatProvider } from "@/contexts/UlysseChatContext";
import { UlysseChatWidget } from "@/components/UlysseChatWidget";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Dashboard from "@/pages/Dashboard";
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";

const Projects = lazy(() => import("@/pages/Projects"));
const ProjectDetail = lazy(() => import("@/pages/ProjectDetail"));
const Tasks = lazy(() => import("@/pages/Tasks"));
const Notes = lazy(() => import("@/pages/Notes"));
const Assistant = lazy(() => import("@/pages/Assistant"));
const Settings = lazy(() => import("@/pages/Settings"));
const Emails = lazy(() => import("@/pages/Emails"));
const AlfredApp = lazy(() => import("@/pages/AlfredApp"));
const TalkingApp = lazy(() => import("@/pages/TalkingApp"));
const SuguValManagement = lazy(() => import("@/pages/SuguValManagement"));
const SuguvalChecklist = lazy(() => import("@/pages/SuguvalChecklist"));
const SuguvalAdmin = lazy(() => import("@/pages/SuguvalAdmin"));
const SuguvalHistory = lazy(() => import("@/pages/SuguvalHistory"));
const SugumaillaneChecklist = lazy(() => import("@/pages/SugumaillaneChecklist"));
const SugumaillaneHistory = lazy(() => import("@/pages/SugumaillaneHistory"));
const SugumaillaneAdmin = lazy(() => import("@/pages/SugumaillaneAdmin"));
const SuguMaillaneManagement = lazy(() => import("@/pages/SuguMaillaneManagement"));
const UlysseInsights = lazy(() => import("@/pages/UlysseInsights"));
const SportsPredictions = lazy(() => import("@/pages/SportsPredictions"));
const FootAlmanach = lazy(() => import("@/pages/FootAlmanach"));
const BrainDashboard = lazy(() => import("@/pages/BrainDashboard"));
const Diagnostics = lazy(() => import("@/pages/Diagnostics"));
const Finances = lazy(() => import("@/pages/Finances"));
const SecurityDashboard = lazy(() => import("@/pages/SecurityDashboard"));
const UnifiedDashboard = lazy(() => import("@/pages/UnifiedDashboard"));
const DevOps = lazy(() => import("@/pages/DevOps"));
const DevOpsIris = lazy(() => import("@/pages/DevOpsIris"));
const DevOpsMaxPage = lazy(() => import("@/pages/DevOpsMax"));
const DevMaxAdminPage = lazy(() => import("@/pages/DevMaxAdmin"));
const CobaProPage = lazy(() => import("@/pages/CobaPro"));
const SuperChat = lazy(() => import("@/pages/SuperChat"));
const Commax = lazy(() => import("@/pages/Commax"));
const IrisDashboard = lazy(() => import("@/pages/IrisDashboard"));
const IrisHomework = lazy(() => import("@/pages/IrisHomework"));
const IrisFiles = lazy(() => import("@/pages/IrisFiles"));
const TalkingIris = lazy(() => import("@/pages/TalkingIris"));
const ScreenMonitorPage = lazy(() => import("@/pages/ScreenMonitor"));
const TracesPage = lazy(() => import("@/pages/Traces"));
const SkillsPage = lazy(() => import("@/pages/Skills"));

function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    }>
      {children}
    </Suspense>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, needsSetup, user } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || needsSetup)) {
      const redirectParam = location !== "/" ? `?redirect=${encodeURIComponent(location)}` : "";
      setLocation(`/login${redirectParam}`);
    }
    if (!isLoading && isAuthenticated && user?.role === "external") {
      setLocation("/max");
    }
    if (!isLoading && isAuthenticated && user?.role === "suguval_only") {
      setLocation("/suguval");
    }
    if (!isLoading && isAuthenticated && user?.role === "sugumaillane_only") {
      setLocation("/sugumaillane");
    }
  }, [isAuthenticated, isLoading, needsSetup, setLocation, location, user]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (user?.role === "external" || user?.role === "suguval_only" || user?.role === "sugumaillane_only") {
    return null;
  }

  return <>{children}</>;
}

function IrisRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }
  if (!isAuthenticated) return null;
  return <>{children}</>;
}

function TalkingRedirect() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user?.role === "approved") {
      setLocation("/iris-talking");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Chargement...</div>
      </div>
    );
  }

  if (user?.role === "approved") return null;

  return <LazyPage><TalkingApp /></LazyPage>;
}

function OwnerOrRedirect({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user && !user.isOwner && user.role === "approved") {
      setLocation("/iris");
    }
  }, [user, setLocation]);

  if (user && !user.isOwner && user.role === "approved") return null;
  return <>{children}</>;
}

function ExternalUserGuard({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [location, setLocation] = useLocation();
  
  // /talking and /courses/* are exempt from all redirects
  const isExemptRoute = location === "/talking" || location.startsWith("/talking") || location.startsWith("/courses/") || location === "/devops-max" || location.startsWith("/devmax") || location.startsWith("/pro/");
  
  useEffect(() => {
    if (!isLoading && isAuthenticated && user?.role === "external" && location !== "/max" && !isExemptRoute) {
      setLocation("/max");
    }
    if (!isLoading && isAuthenticated && user?.role === "suguval_only" && location !== "/suguval") {
      setLocation("/suguval");
    }
    if (!isLoading && isAuthenticated && user?.role === "sugumaillane_only" && location !== "/sugumaillane") {
      setLocation("/sugumaillane");
    }
  }, [isLoading, isAuthenticated, user, location, setLocation, isExemptRoute]);
  
  if (isLoading) return null;
  if (isAuthenticated && user?.role === "external" && location !== "/max" && !isExemptRoute) return null;
  if (isAuthenticated && user?.role === "suguval_only" && location !== "/suguval") return null;
  if (isAuthenticated && user?.role === "sugumaillane_only" && location !== "/sugumaillane") return null;
  
  return <>{children}</>;
}

function DevMaxWrapper() {
  return <LazyPage><DevOpsMaxPage /></LazyPage>;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/devmax/devopsmax">
        {() => <DevMaxWrapper />}
      </Route>
      <Route path="/devmax">
        {() => <DevMaxWrapper />}
      </Route>
      <Route path="/devops-max">
        {() => <DevMaxWrapper />}
      </Route>
      <Route path="/max">
        {() => (
          <LazyPage><AlfredApp /></LazyPage>
        )}
      </Route>
      <Route path="/talking">
        {() => (
          <TalkingRedirect />
        )}
      </Route>
      <Route path="/suguval">
        {() => (
          <LazyPage><SuguValManagement /></LazyPage>
        )}
      </Route>
      <Route path="/courses/suguval">
        {() => (
          <LazyPage><SuguvalChecklist /></LazyPage>
        )}
      </Route>
      <Route path="/courses/suguval/edit">
        {() => (
          <LazyPage><SuguvalAdmin /></LazyPage>
        )}
      </Route>
      <Route path="/courses/suguval/history">
        {() => (
          <LazyPage><SuguvalHistory /></LazyPage>
        )}
      </Route>
      <Route path="/courses/sugumaillane">
        {() => (
          <LazyPage><SugumaillaneChecklist /></LazyPage>
        )}
      </Route>
      <Route path="/courses/sugumaillane/history">
        {() => (
          <LazyPage><SugumaillaneHistory /></LazyPage>
        )}
      </Route>
      <Route path="/courses/sugumaillane/edit">
        {() => (
          <LazyPage><SugumaillaneAdmin /></LazyPage>
        )}
      </Route>
      <Route path="/sugumaillane">
        {() => (
          <LazyPage><SuguMaillaneManagement /></LazyPage>
        )}
      </Route>
      <Route path="/projects/:id">
        {() => (
          <ProtectedRoute>
            <LazyPage><ProjectDetail /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/projects">
        {() => (
          <ProtectedRoute>
            <LazyPage><Projects /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/tasks">
        {() => (
          <ProtectedRoute>
            <LazyPage><Tasks /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/notes">
        {() => (
          <ProtectedRoute>
            <LazyPage><Notes /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/assistant">
        {() => (
          <ProtectedRoute>
            <LazyPage><Assistant /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/superchat">
        {() => (
          <ProtectedRoute>
            <LazyPage><SuperChat /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/commax">
        {() => (
          <ProtectedRoute>
            <LazyPage><Commax /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/screen-monitor">
        {() => (
          <ProtectedRoute>
            <LazyPage><ScreenMonitorPage /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/settings">
        {() => (
          <ProtectedRoute>
            <LazyPage><Settings /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/emails">
        {() => (
          <ProtectedRoute>
            <LazyPage><Emails /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/ulysse-insights">
        {() => (
          <ProtectedRoute>
            <LazyPage><UlysseInsights /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/sports/predictions/footalmanach">
        {() => (
          <ProtectedRoute>
            <PinGate>
              <LazyPage><FootAlmanach /></LazyPage>
            </PinGate>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/sports/predictions">
        {() => (
          <ProtectedRoute>
            <PinGate>
              <LazyPage><SportsPredictions /></LazyPage>
            </PinGate>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/brain">
        {() => (
          <ProtectedRoute>
            <LazyPage><BrainDashboard /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/traces">
        {() => (
          <ProtectedRoute>
            <LazyPage><TracesPage /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/skills">
        {() => (
          <ProtectedRoute>
            <LazyPage><SkillsPage /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/diagnostics">
        {() => (
          <ProtectedRoute>
            <LazyPage><Diagnostics /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/finances">
        {() => (
          <ProtectedRoute>
            <LazyPage><Finances /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/security">
        {() => (
          <ProtectedRoute>
            <LazyPage><SecurityDashboard /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/analytics">
        {() => (
          <ProtectedRoute>
            <LazyPage><UnifiedDashboard /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/devops">
        {() => (
          <ProtectedRoute>
            <LazyPage><DevOps /></LazyPage>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/devops-iris">
        {() => (
          <IrisRoute>
            <LazyPage><DevOpsIris /></LazyPage>
          </IrisRoute>
        )}
      </Route>
      <Route path="/iris">
        {() => (
          <IrisRoute>
            <LazyPage><IrisDashboard /></LazyPage>
          </IrisRoute>
        )}
      </Route>
      <Route path="/iris-homework">
        {() => (
          <IrisRoute>
            <LazyPage><IrisHomework /></LazyPage>
          </IrisRoute>
        )}
      </Route>
      <Route path="/iris-files">
        {() => (
          <IrisRoute>
            <LazyPage><IrisFiles /></LazyPage>
          </IrisRoute>
        )}
      </Route>
      <Route path="/iris-talking">
        {() => (
          <IrisRoute>
            <LazyPage><TalkingIris /></LazyPage>
          </IrisRoute>
        )}
      </Route>
      <Route path="/">
        {() => (
          <ProtectedRoute>
            <OwnerOrRedirect>
              <Dashboard />
            </OwnerOrRedirect>
          </ProtectedRoute>
        )}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function ConnectionManager({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  
  useAutoReconnect({
    healthCheckInterval: 30000,
    onReconnect: () => console.log("[App] Reconnected to server"),
    onDisconnect: () => console.log("[App] Disconnected from server")
  });
  useRealtimeSync({
    userId: user?.id,
    onDashboardCommand: (cmd: any) => {
      if (cmd?.action === "take_screenshot") {
        window.dispatchEvent(new CustomEvent("ulysse:take-screenshot", { detail: cmd }));
      }
    },
  });
  useAppNavigation();
  useUiSnapshot();
  useDashboardScreenshot();
  
  return <>{children}</>;
}

function DevMaxAdminWrapper() {
  return <LazyPage><DevMaxAdminPage /></LazyPage>;
}

function App() {
  const path = window.location.pathname;
  const isDevmaxAdmin = path === "/devmax/123admin";
  const isDevmax = !isDevmaxAdmin && (path.startsWith("/devmax") || path === "/devops-max");
  const isCobaPro = path.startsWith("/pro/");

  if (isCobaPro) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="auto">
          <TooltipProvider>
            <Toaster />
            <LazyPage><CobaProPage /></LazyPage>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  if (isDevmaxAdmin) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="auto">
          <TooltipProvider>
            <Toaster />
            <DevMaxAdminWrapper />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  if (isDevmax) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="auto">
          <TooltipProvider>
            <ErrorBoundary>
              <Toaster />
              <DevMaxWrapper />
            </ErrorBoundary>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="auto">
        <TooltipProvider>
          <ErrorBoundary>
            <AuthProvider>
              <InactivityGuard />
              <VoiceProvider>
                <ConnectionManager>
                  <Toaster />
                  <ExternalUserGuard>
                    <UlysseChatProvider>
                      <AppRouter />
                      <UlysseChatWidget />
                    </UlysseChatProvider>
                  </ExternalUserGuard>
                </ConnectionManager>
              </VoiceProvider>
            </AuthProvider>
          </ErrorBoundary>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
