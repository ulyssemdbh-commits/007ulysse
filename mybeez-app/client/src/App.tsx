import { Switch, Route } from "wouter";
import { lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const SuguvalChecklist = lazy(() => import("@/pages/SuguvalChecklist"));
const SuguvalAdmin = lazy(() => import("@/pages/SuguvalAdmin"));
const SuguvalHistory = lazy(() => import("@/pages/SuguvalHistory"));
const SuguValManagement = lazy(() => import("@/pages/SuguValManagement"));
const SugumaillaneChecklist = lazy(() => import("@/pages/SugumaillaneChecklist"));
const SugumaillaneAdmin = lazy(() => import("@/pages/SugumaillaneAdmin"));
const SugumaillaneHistory = lazy(() => import("@/pages/SugumaillaneHistory"));
const SuguMaillaneManagement = lazy(() => import("@/pages/SuguMaillaneManagement"));

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

function Home() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center text-foreground">
      <div className="text-center space-y-6 max-w-md">
        <h1 className="text-4xl font-bold">myBeez</h1>
        <p className="text-muted-foreground">Gestion des checklists et inventaires restaurant</p>
        <div className="grid grid-cols-2 gap-3">
          <a href="/suguval" className="bg-primary/10 border border-primary/30 rounded-lg p-4 hover:bg-primary/20 transition-colors">
            <div className="font-semibold">Valentine</div>
            <div className="text-sm text-muted-foreground">Checklist</div>
          </a>
          <a href="/sugumaillane" className="bg-primary/10 border border-primary/30 rounded-lg p-4 hover:bg-primary/20 transition-colors">
            <div className="font-semibold">Maillane</div>
            <div className="text-sm text-muted-foreground">Checklist</div>
          </a>
          <a href="/suguval/admin" className="bg-card border border-border rounded-lg p-4 hover:bg-muted transition-colors">
            <div className="font-semibold">Admin Val</div>
            <div className="text-sm text-muted-foreground">Gestion</div>
          </a>
          <a href="/sugumaillane/admin" className="bg-card border border-border rounded-lg p-4 hover:bg-muted transition-colors">
            <div className="font-semibold">Admin Mail</div>
            <div className="text-sm text-muted-foreground">Gestion</div>
          </a>
        </div>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center text-foreground">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="text-muted-foreground">Page introuvable</p>
        <a href="/" className="text-primary hover:underline">Retour à l'accueil</a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-background text-foreground">
          <Switch>
            <Route path="/" component={Home} />

            {/* myBeez Valentine */}
            <Route path="/suguval">
              <LazyPage><SuguvalChecklist /></LazyPage>
            </Route>
            <Route path="/suguval/admin">
              <LazyPage><SuguvalAdmin /></LazyPage>
            </Route>
            <Route path="/suguval/history">
              <LazyPage><SuguvalHistory /></LazyPage>
            </Route>
            <Route path="/suguval/management">
              <LazyPage><SuguValManagement /></LazyPage>
            </Route>

            {/* myBeez Maillane */}
            <Route path="/sugumaillane">
              <LazyPage><SugumaillaneChecklist /></LazyPage>
            </Route>
            <Route path="/sugumaillane/admin">
              <LazyPage><SugumaillaneAdmin /></LazyPage>
            </Route>
            <Route path="/sugumaillane/history">
              <LazyPage><SugumaillaneHistory /></LazyPage>
            </Route>
            <Route path="/sugumaillane/management">
              <LazyPage><SuguMaillaneManagement /></LazyPage>
            </Route>

            <Route>
              <NotFound />
            </Route>
          </Switch>
          <Toaster />
        </div>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
