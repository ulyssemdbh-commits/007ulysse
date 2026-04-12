import { Switch, Route } from "wouter";
import { lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SkipLink } from "@/components/SkipLink";

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
      <div className="min-h-screen bg-background flex items-center justify-center" role="status">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 mx-auto rounded-xl bg-primary/10 flex items-center justify-center animate-pulse">
            <span className="text-lg font-bold text-primary">B</span>
          </div>
          <p className="text-sm text-muted-foreground">Chargement...</p>
          <span className="sr-only">Page en cours de chargement</span>
        </div>
      </div>
    }>
      {children}
    </Suspense>
  );
}

function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 flex items-center justify-center p-4">
      <div className="text-center space-y-8 max-w-lg w-full">
        {/* Logo */}
        <div className="space-y-3">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <span className="text-3xl font-bold text-white">B</span>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 dark:from-amber-400 dark:to-orange-400 bg-clip-text text-transparent">
            myBeez
          </h1>
          <p className="text-muted-foreground text-sm">
            Gestion des checklists et inventaires restaurant
          </p>
        </div>

        {/* Restaurant cards */}
        <nav aria-label="Restaurants" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Valentine */}
            <a
              href="/suguval"
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 dark:from-amber-500/5 dark:to-orange-500/5 border border-amber-200/50 dark:border-amber-500/20 p-5 text-left hover:shadow-lg hover:shadow-amber-500/10 hover:border-amber-300 dark:hover:border-amber-500/40 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold shadow-md group-hover:scale-105 transition-transform">
                  V
                </div>
                <div>
                  <div className="font-semibold text-foreground">Valentine</div>
                  <div className="text-xs text-muted-foreground">Checklist courses</div>
                </div>
              </div>
            </a>

            {/* Maillane */}
            <a
              href="/sugumaillane"
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/5 dark:to-teal-500/5 border border-emerald-200/50 dark:border-emerald-500/20 p-5 text-left hover:shadow-lg hover:shadow-emerald-500/10 hover:border-emerald-300 dark:hover:border-emerald-500/40 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold shadow-md group-hover:scale-105 transition-transform">
                  M
                </div>
                <div>
                  <div className="font-semibold text-foreground">Maillane</div>
                  <div className="text-xs text-muted-foreground">Checklist courses</div>
                </div>
              </div>
            </a>
          </div>

          {/* Management links */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href="/suguval/management"
              className="rounded-xl bg-card border border-border p-4 text-left hover:bg-accent/50 hover:border-accent transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="font-medium text-sm text-foreground">Gestion Valentine</div>
              <div className="text-xs text-muted-foreground mt-0.5">Comptabilite & administration</div>
            </a>
            <a
              href="/sugumaillane/management"
              className="rounded-xl bg-card border border-border p-4 text-left hover:bg-accent/50 hover:border-accent transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="font-medium text-sm text-foreground">Gestion Maillane</div>
              <div className="text-xs text-muted-foreground mt-0.5">Comptabilite & administration</div>
            </a>
          </div>
        </nav>

        <p className="text-xs text-muted-foreground/60">myBeez v1.0</p>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center text-foreground p-4" role="alert">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-muted-foreground/30">404</h1>
        <p className="text-muted-foreground">Page introuvable</p>
        <a
          href="/"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Retour a l'accueil
        </a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <QueryClientProvider client={queryClient}>
          <SkipLink />
          <div id="main-content" className="min-h-screen bg-background text-foreground">
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
    </ErrorBoundary>
  );
}
