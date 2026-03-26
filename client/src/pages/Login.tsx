import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Fingerprint, Lock, User, Eye, EyeOff, Loader2, CheckCircle2, Zap, Activity, ShieldCheck, Mail, RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { REGEXP_ONLY_DIGITS } from "input-otp";

export default function Login() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const cleanSearch = searchString.startsWith("?") ? searchString.slice(1) : searchString;
  const redirectTo = new URLSearchParams(cleanSearch).get("redirect") || "/";
  const { user, isLoading, isAuthenticated, needsSetup, requires2FA, login, setup, verify2FA, resend2FA } = useAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState<"login" | "setup">("login");
  const [show2FA, setShow2FA] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [isVerifying2FA, setIsVerifying2FA] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (needsSetup) {
      setMode("setup");
    }
  }, [needsSetup]);

  useEffect(() => {
    if (requires2FA && isAuthenticated) {
      setShow2FA(true);
    }
  }, [requires2FA, isAuthenticated]);

  const [showLoadingScreen, setShowLoadingScreen] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState([
    { id: "init", label: "Initialisation de l'application", progress: 0, complete: false },
    { id: "diagnostics", label: "Auto-diagnostic", progress: 0, complete: false },
  ]);
  const [loadingComplete, setLoadingComplete] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !isLoading && !showLoadingScreen && !requires2FA && !show2FA) {
      setShowLoadingScreen(true);
      runLoadingSequence();
    }
  }, [isAuthenticated, isLoading, requires2FA, show2FA]);

  const updateStep = (stepId: string, progress: number, complete: boolean = false) => {
    setLoadingSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, progress, complete } : step
    ));
  };

  const runLoadingSequence = async () => {
    updateStep("init", 30);
    await new Promise(r => setTimeout(r, 200));
    updateStep("init", 70);
    await new Promise(r => setTimeout(r, 200));
    updateStep("init", 100, true);
    
    updateStep("diagnostics", 20);
    try {
      const response = await fetch("/api/diagnostics/run", { credentials: "include" });
      updateStep("diagnostics", 60);
      if (response.ok) {
        await response.json();
        updateStep("diagnostics", 100, true);
      } else {
        updateStep("diagnostics", 100, true);
      }
    } catch {
      updateStep("diagnostics", 100, true);
    }
    
    await new Promise(r => setTimeout(r, 400));
    setLoadingComplete(true);
    
    await new Promise(r => setTimeout(r, 400));
    setLocation(redirectTo);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (mode === "setup") {
        await setup(username, password, displayName);
        toast({
          title: "Bienvenue, Maurice",
          description: "Votre compte a été créé avec succès.",
        });
      } else {
        const result = await login(username, password);
        if (result?.requires2FA) {
          setShow2FA(true);
          toast({
            title: "Vérification requise",
            description: "Un code a été envoyé à votre email.",
          });
        } else {
          toast({
            title: "Connexion réussie",
            description: "Bienvenue sur Ulysse.",
          });
        }
      }
    } catch (error: any) {
      toast({
        title: "Erreur",
        description: error.message || "Une erreur est survenue",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify2FA = async () => {
    if (otpCode.length !== 6) return;
    setIsVerifying2FA(true);
    try {
      await verify2FA(otpCode);
      toast({
        title: "Vérification réussie",
        description: "Bienvenue, Maurice.",
      });
      setShow2FA(false);
    } catch (error: any) {
      toast({
        title: "Code incorrect",
        description: error.message || "Veuillez réessayer.",
        variant: "destructive",
      });
      setOtpCode("");
    } finally {
      setIsVerifying2FA(false);
    }
  };

  const handleResend2FA = async () => {
    setIsResending(true);
    try {
      await resend2FA();
      toast({
        title: "Code renvoyé",
        description: "Vérifiez votre email.",
      });
      setOtpCode("");
    } catch (error: any) {
      toast({
        title: "Erreur",
        description: "Impossible de renvoyer le code.",
        variant: "destructive",
      });
    } finally {
      setIsResending(false);
    }
  };

  const handleWebAuthn = async () => {
    if (!window.PublicKeyCredential) {
      toast({
        title: "Non supporté",
        description: "Votre navigateur ne supporte pas l'authentification biométrique.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "En cours de développement",
      description: "L'authentification FaceID/TouchID sera bientôt disponible.",
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Chargement...</p>
        </motion.div>
      </div>
    );
  }

  if (showLoadingScreen) {
    const personaName = user?.isOwner ? "Ulysse" : user?.role === "external" ? "Max" : "Iris";
    const overallProgress = Math.round(loadingSteps.reduce((sum, s) => sum + s.progress, 0) / loadingSteps.length);
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-4"
            >
              <motion.div
                className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600"
                animate={{ 
                  scale: [1, 1.1, 1],
                  boxShadow: [
                    "0 0 20px rgba(99, 102, 241, 0.3)",
                    "0 0 40px rgba(99, 102, 241, 0.5)",
                    "0 0 20px rgba(99, 102, 241, 0.3)"
                  ]
                }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </motion.div>
            <h1 className="text-2xl font-bold text-foreground">{personaName}</h1>
            <p className="text-muted-foreground mt-1">Préparation de votre espace...</p>
          </div>

          <Card>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Progression globale</span>
                  <span className="font-medium">{overallProgress}%</span>
                </div>
                <Progress value={overallProgress} className="h-2" />
              </div>

              <div className="space-y-4">
                {loadingSteps.map((step, index) => (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="space-y-2"
                  >
                    <div className="flex items-center gap-3">
                      <AnimatePresence mode="wait">
                        {step.complete ? (
                          <motion.div key="complete" initial={{ scale: 0 }} animate={{ scale: 1 }}>
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          </motion.div>
                        ) : step.progress > 0 ? (
                          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            <Loader2 className="w-5 h-5 text-primary animate-spin" />
                          </motion.div>
                        ) : (
                          <motion.div key="pending" initial={{ opacity: 0.5 }} animate={{ opacity: 0.5 }}>
                            {step.id === "init" ? (
                              <Zap className="w-5 h-5 text-muted-foreground" />
                            ) : (
                              <Activity className="w-5 h-5 text-muted-foreground" />
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className={step.complete ? "text-foreground" : "text-muted-foreground"}>
                            {step.id === "diagnostics" ? `Auto-diagnostic ${personaName}` : step.label}
                          </span>
                          <span className="text-xs text-muted-foreground">{step.progress}%</span>
                        </div>
                        <Progress value={step.progress} className="h-1 mt-1" />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <AnimatePresence>
                {loadingComplete && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center pt-2"
                  >
                    <p className="text-sm text-green-500 font-medium">{personaName} est prêt</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  if (show2FA) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-4"
            >
              <ShieldCheck className="w-10 h-10 text-primary" />
            </motion.div>
            <h1 className="text-2xl font-bold text-foreground">Vérification 2FA</h1>
            <p className="text-muted-foreground mt-2">
              Un code à 6 chiffres a été envoyé à votre email
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Code de vérification
              </CardTitle>
              <CardDescription>
                Saisissez le code reçu par email pour confirmer votre identité
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex justify-center" data-testid="otp-input-container">
                <InputOTP
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  value={otpCode}
                  onChange={(value) => setOtpCode(value)}
                  onComplete={(value) => {
                    setOtpCode(value);
                    setTimeout(() => handleVerify2FA(), 100);
                  }}
                  data-testid="input-otp"
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <span className="text-2xl text-muted-foreground mx-2">-</span>
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button
                className="w-full"
                onClick={handleVerify2FA}
                disabled={otpCode.length !== 6 || isVerifying2FA}
                data-testid="button-verify-2fa"
              >
                {isVerifying2FA ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mr-2" />
                )}
                Vérifier
              </Button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={handleResend2FA}
                  disabled={isResending}
                  className="text-primary hover:underline flex items-center gap-1"
                  data-testid="button-resend-2fa"
                >
                  {isResending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Renvoyer le code
                </button>
                <span className="text-muted-foreground">Expire dans 10 min</span>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-4">
            Authentification à deux facteurs — Accès Master Admin
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600" />
          </motion.div>
          <h1 className="text-3xl font-bold text-foreground">Ulysse</h1>
          <p className="text-muted-foreground mt-2">
            {mode === "setup" ? "Configuration initiale" : "Assistant personnel de Maurice"}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {mode === "setup" ? "Créer votre compte" : "Connexion"}
            </CardTitle>
            <CardDescription>
              {mode === "setup" 
                ? "Configurez votre accès en tant que propriétaire d'Ulysse" 
                : "Connectez-vous pour accéder à Ulysse"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "setup" && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">Nom complet</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="displayName"
                      type="text"
                      placeholder="Maurice Djedou"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="pl-10"
                      required
                      data-testid="input-display-name"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="username">Identifiant</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="maurice"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-username"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Mot de passe</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Minimum 8 caractères"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10"
                    required
                    minLength={8}
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover-elevate p-1 rounded"
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
                data-testid="button-submit"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                {mode === "setup" ? "Créer le compte" : "Se connecter"}
              </Button>
            </form>

            {mode === "login" && (
              <>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">ou</span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleWebAuthn}
                  data-testid="button-biometric"
                >
                  <Fingerprint className="w-4 h-4 mr-2" />
                  FaceID / TouchID
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-4">
          Accès réservé aux utilisateurs autorisés
        </p>

        <button
          type="button"
          onClick={() => { window.location.href = '/devmax'; }}
          className="mt-6 flex items-center gap-2 mx-auto text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
          data-testid="link-devmax"
        >
          <Lock className="w-3 h-3" />
          DevMax
        </button>
      </motion.div>
    </div>
  );
}
