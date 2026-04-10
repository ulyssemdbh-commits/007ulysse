import { Switch, Route } from "wouter";
import { lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";

const DevMaxLanding = lazy(() => import("@/pages/DevMaxLanding"));
const DevOpsMax = lazy(() => import("@/pages/DevOpsMax"));
const DevMaxAdmin = lazy(() => import("@/pages/DevMaxAdmin"));

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
    <QueryClientProvider client={queryClient}>
      <div className="dark min-h-screen bg-background text-foreground">
        <Switch>
          <Route path="/">
            <LazyPage><DevMaxLanding /></LazyPage>
          </Route>
          <Route path="/devmax">
            <LazyPage><DevOpsMax /></LazyPage>
          </Route>
          <Route path="/devmax/admin">
            <LazyPage><DevMaxAdmin /></LazyPage>
          </Route>
          <Route path="/devops-max">
            <LazyPage><DevOpsMax /></LazyPage>
          </Route>
          <Route>
            <NotFound />
          </Route>
        </Switch>
        <Toaster />
      </div>
    </QueryClientProvider>
  );
}
