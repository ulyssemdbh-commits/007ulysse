import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShoppingCart, Check, ChefHat, Pencil, X, Calendar, Lock, Unlock, Settings, ChevronUp, ChevronDown, Save, Sun, Moon, MessageSquare, Send, Trash2, RotateCcw } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePageManifest } from "@/hooks/usePageManifest";
import { apiRequest } from "@/lib/queryClient";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, TrendingUp } from "lucide-react";

interface WeeklyStats {
  startDate: string;
  endDate: string;
  days: Array<{
    date: string;
    dayName: string;
    totalItems: number;
    checkedCount: number;
    completionRate: number;
  }>;
  summary: {
    averageCompletion: number;
    averageCheckedItems: number;
    totalItemsBaseline: number;
    daysWithActivity: number;
  };
}

function WeeklyHistorySection({ 
  language, 
  endpoint, 
  colorScheme 
}: { 
  language: "fr" | "vi" | "th";
  endpoint: string;
  colorScheme: "green" | "teal";
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: weeklyStats, isLoading } = useQuery<WeeklyStats>({
    queryKey: [endpoint],
    refetchInterval: 30000,
  });

  const colors = colorScheme === "green" 
    ? { border: "border-green-200 dark:border-green-800", bg: "from-green-50 to-amber-50 dark:from-green-900/20 dark:to-amber-900/20", title: "text-green-800 dark:text-green-300", bar: "bg-green-500" }
    : { border: "border-teal-200 dark:border-teal-800", bg: "from-teal-50 to-emerald-50 dark:from-teal-900/20 dark:to-emerald-900/20", title: "text-teal-800 dark:text-teal-300", bar: "bg-teal-500" };

  if (isLoading || !weeklyStats) return null;

  const maxRate = Math.max(...weeklyStats.days.map(d => d.completionRate), 1);

  return (
    <section className="mb-6" data-testid={`section-weekly-${colorScheme === "green" ? "suguval" : "sugumaillane"}`}>
      <Card className={`${colors.border} bg-gradient-to-r ${colors.bg}`}>
        <CardContent className="pt-4 pb-4">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between cursor-pointer"
            data-testid="button-toggle-weekly-history"
          >
            <div className="flex items-center gap-2">
              <BarChart3 className={`h-5 w-5 ${colors.title}`} />
              <h3 className={`text-lg font-semibold ${colors.title}`}>
                {language === "fr" ? "Historique hebdomadaire" : language === "vi" ? "Lịch sử tuần" : "ประวัติสัปดาห์"}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {language === "fr" ? "Moy:" : language === "vi" ? "TB:" : "เฉลี่ย:"} {weeklyStats.summary.averageCompletion}%
              </span>
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          </button>
          
          {isExpanded && (
            <>
              <div className="flex items-end justify-between gap-1 h-24 mt-4" data-testid={`chart-weekly-${colorScheme === "green" ? "suguval" : "sugumaillane"}`}>
                {weeklyStats.days.map((day, idx) => (
                  <div key={day.date} className="flex flex-col items-center flex-1">
                    <span className="text-xs text-muted-foreground mb-1">{day.completionRate}%</span>
                    <div 
                      className={`w-full ${colors.bar} rounded-t transition-all duration-300`}
                      style={{ height: `${maxRate > 0 ? (day.completionRate / maxRate) * 60 : 0}px`, minHeight: day.completionRate > 0 ? "4px" : "2px" }}
                      data-testid={`bar-day-${idx}`}
                    />
                    <span className="text-xs font-medium mt-1">{day.dayName}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <span className="block text-muted-foreground">
                    {language === "fr" ? "Jours actifs" : language === "vi" ? "Ngày hoạt động" : "วันที่มีกิจกรรม"}
                  </span>
                  <span className="font-semibold" data-testid="text-active-days">{weeklyStats.summary.daysWithActivity}/7</span>
                </div>
                <div>
                  <span className="block text-muted-foreground">
                    {language === "fr" ? "Moy. articles" : language === "vi" ? "TB. món" : "เฉลี่ย รายการ"}
                  </span>
                  <span className="font-semibold" data-testid="text-avg-items">{weeklyStats.summary.averageCheckedItems}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground">
                    {language === "fr" ? "Total articles" : language === "vi" ? "Tổng món" : "รวมรายการ"}
                  </span>
                  <span className="font-semibold" data-testid="text-total-baseline">{weeklyStats.summary.totalItemsBaseline}</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

const PIN_CODE = "2792";
const UNLOCK_CODE = "102040";
const MAX_ATTEMPTS = 3;
const STORAGE_KEY_AUTH = "suguval-auth";
const STORAGE_KEY_ATTEMPTS = "suguval-attempts";
const STORAGE_KEY_BLOCKED = "suguval-blocked";

function PinProtection({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [attempts, setAttempts] = useState(() => {
    return parseInt(localStorage.getItem(STORAGE_KEY_ATTEMPTS) || "0", 10);
  });
  const [isBlocked, setIsBlocked] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_BLOCKED) === "true";
  });

  const requiredLength = isBlocked ? 6 : 4;

  const handlePinEntry = (digit: string) => {
    if (pin.length >= requiredLength) return;
    
    const newPin = pin + digit;
    setPin(newPin);
    setError("");

    if (newPin.length === requiredLength) {
      setTimeout(() => validatePin(newPin), 150);
    }
  };

  const validatePin = (currentPin: string) => {
    if (isBlocked) {
      if (currentPin === UNLOCK_CODE) {
        localStorage.removeItem(STORAGE_KEY_BLOCKED);
        localStorage.setItem(STORAGE_KEY_ATTEMPTS, "0");
        localStorage.setItem(STORAGE_KEY_AUTH, "true");
        setIsBlocked(false);
        setAttempts(0);
        onUnlock();
      } else {
        triggerError("Code de déblocage incorrect");
      }
      return;
    }

    if (currentPin === PIN_CODE) {
      localStorage.setItem(STORAGE_KEY_AUTH, "true");
      localStorage.setItem(STORAGE_KEY_ATTEMPTS, "0");
      onUnlock();
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      localStorage.setItem(STORAGE_KEY_ATTEMPTS, String(newAttempts));
      
      if (newAttempts >= MAX_ATTEMPTS) {
        localStorage.setItem(STORAGE_KEY_BLOCKED, "true");
        setIsBlocked(true);
        triggerError("Accès bloqué");
      } else {
        triggerError(`Code incorrect (${MAX_ATTEMPTS - newAttempts} essai${MAX_ATTEMPTS - newAttempts > 1 ? 's' : ''} restant${MAX_ATTEMPTS - newAttempts > 1 ? 's' : ''})`);
      }
    }
  };

  const triggerError = (message: string) => {
    setError(message);
    setShake(true);
    setTimeout(() => {
      setShake(false);
      setPin("");
    }, 500);
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
    setError("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-700 to-amber-900 flex items-center justify-center p-4">
      <div className="w-full max-w-xs">
        <div className="flex flex-col items-center">
          <div className="mb-6 w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
            {isBlocked ? (
              <Lock className="w-10 h-10 text-red-600" />
            ) : (
              <Unlock className="w-10 h-10 text-amber-700" />
            )}
          </div>
          
          <h1 className="text-white text-2xl font-semibold mb-2">
            {isBlocked ? "Accès Bloqué" : "SUGUVAL"}
          </h1>
          <p className="text-amber-100 text-sm mb-8">
            {isBlocked 
              ? "Entrez le code de déblocage"
              : "Entrez le code PIN"
            }
          </p>

          <div className={`flex gap-4 mb-4 ${shake ? 'animate-shake' : ''}`}>
            {Array.from({ length: requiredLength }).map((_, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 transition-all ${
                  pin.length > i 
                    ? "bg-white border-white" 
                    : "bg-transparent border-amber-200"
                }`}
              />
            ))}
          </div>

          {error && (
            <p className="text-red-300 text-sm mb-4 text-center">{error}</p>
          )}

          <div className="grid grid-cols-3 gap-4 mt-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                onClick={() => handlePinEntry(String(num))}
                className="w-18 h-18 md:w-20 md:h-20 rounded-full bg-amber-800/60 text-white text-2xl font-light 
                  flex items-center justify-center hover:bg-amber-700/60 active:bg-amber-600/60 transition-colors
                  aspect-square"
                data-testid={`pin-${num}`}
              >
                {num}
              </button>
            ))}
            <div />
            <button
              onClick={() => handlePinEntry("0")}
              className="w-18 h-18 md:w-20 md:h-20 rounded-full bg-amber-800/60 text-white text-2xl font-light 
                flex items-center justify-center hover:bg-amber-700/60 active:bg-amber-600/60 transition-colors
                aspect-square"
              data-testid="pin-0"
            >
              0
            </button>
            <button
              onClick={handleDelete}
              className="w-18 h-18 md:w-20 md:h-20 flex items-center justify-center text-white hover:text-amber-200 transition-colors
                aspect-square"
              data-testid="pin-delete"
            >
              <X className="h-7 w-7" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type Language = "fr" | "vi" | "th";

const FLAGS: Record<Language, { emoji: string; label: string }> = {
  fr: { emoji: "🇫🇷", label: "Français" },
  vi: { emoji: "🇻🇳", label: "Tiếng Việt" },
  th: { emoji: "🇹🇭", label: "ไทย" },
};

interface SuguvalItem {
  id: number;
  categoryId: number;
  name: string;
  nameVi: string | null;
  nameTh: string | null;
  sortOrder: number;
  isActive: boolean;
}

interface SuguvalCategory {
  id: number;
  name: string;
  sheet: string;
  sortOrder: number;
  zone: number;
  zoneName: string;
  items: SuguvalItem[];
}

interface SuguvalCheck {
  id: number;
  itemId: number;
  checkDate: string;
  isChecked: boolean;
}

export default function SuguvalChecklist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useRealtimeSync();
  const { theme, setTheme } = useTheme();
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_AUTH) === "true";
  });
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("suguval-lang");
    return (saved as Language) || "fr";
  });
  const prevLanguageRef = useRef<Language>(language);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showCheckedDialog, setShowCheckedDialog] = useState(false);
  const [showCategoryEditor, setShowCategoryEditor] = useState(false);
  const [editingCategories, setEditingCategories] = useState<SuguvalCategory[]>([]);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [showSpecialPinDialog, setShowSpecialPinDialog] = useState(false);
  const [specialPin, setSpecialPin] = useState("");
  const [pendingAction, setPendingAction] = useState<"categories" | "translations" | null>(null);
    const [commentMessage, setCommentMessage] = useState("");

  // Save language preference and translate comments when language changes
  useEffect(() => {
    localStorage.setItem("suguval-lang", language);
    
    // Translate comment when language changes
    const translateComment = async () => {
      if (prevLanguageRef.current !== language && commentMessage.trim()) {
        setIsTranslating(true);
        try {
          const response = await apiRequest("POST", "/api/suguval/translate-comment", {
            text: commentMessage,
            fromLang: prevLanguageRef.current,
            toLang: language
          });
          const data = await response.json();
          if (data.translatedText) {
            setCommentMessage(data.translatedText);
          }
        } catch (error) {
          console.error("Translation error:", error);
        } finally {
          setIsTranslating(false);
        }
      }
      prevLanguageRef.current = language;
    };
    
    translateComment();
  }, [language]);

  // PWA manifest for Suguval
  usePageManifest({
    title: "Courses myBeez",
    manifestPath: "/manifest-suguval.json",
    themeColor: "#b45309",
    appleTitle: "myBeez"
  });

  const { data: categories, isLoading: categoriesLoading } = useQuery<SuguvalCategory[]>({
    queryKey: ["/api/suguval/categories"],
  });

  const { data: checks, isLoading: checksLoading } = useQuery<SuguvalCheck[]>({
    queryKey: ["/api/suguval/checks"],
  });

  // Dashboard stats query
  interface DashboardStats {
    date: string;
    totalItems: number;
    checkedCount: number;
    completionRate: number;
    categoryStats: Array<{
      id: number;
      name: string;
      zoneName: string;
      totalItems: number;
      checkedItems: number;
      completionRate: number;
    }>;
  }
  
  const { data: dashboardStats } = useQuery<DashboardStats>({
    queryKey: ["/api/suguval/dashboard"],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  interface SuguvalComment {
    id: number;
    author: string;
    message: string;
    createdAt: string;
  }

  const { data: comments, isLoading: commentsLoading } = useQuery<SuguvalComment[]>({
    queryKey: ["/api/suguval/comments"],
  });


  // Load saved comment into textarea on mount and translate if needed
  useEffect(() => {
    const loadAndTranslateComments = async () => {
      if (comments && comments.length > 0) {
        const allMessages = comments.map(c => c.message).join("\n---\n");
        
        // Detect if text needs translation (contains Vietnamese/Thai characters when not in that language)
        const hasVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(allMessages);
        const hasThai = /[\u0E00-\u0E7F]/.test(allMessages);
        
        const detectedLang = hasThai ? "th" : hasVietnamese ? "vi" : "fr";
        
        // If detected language differs from current language, translate
        if (detectedLang !== language && allMessages.trim()) {
          setIsTranslating(true);
          try {
            const response = await apiRequest("POST", "/api/suguval/translate-comment", {
              text: allMessages,
              fromLang: detectedLang,
              toLang: language
            });
            const data = await response.json();
            if (data.translatedText) {
              setCommentMessage(data.translatedText);
            } else {
              setCommentMessage(allMessages);
            }
          } catch (error) {
            console.error("Translation error:", error);
            setCommentMessage(allMessages);
          } finally {
            setIsTranslating(false);
          }
        } else {
          setCommentMessage(allMessages);
        }
      }
    };
    
    loadAndTranslateComments();
  }, [comments, language]);

  const saveCommentMutation = useMutation({
    mutationFn: async (message: string) => {
      // Delete old comments first, then save new one
      if (comments && comments.length > 0) {
        for (const c of comments) {
          await apiRequest("DELETE", `/api/suguval/comments/${c.id}`);
        }
      }
      if (message.trim()) {
        return apiRequest("POST", "/api/suguval/comments", { author: "Employé", message });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/comments"] });
    }
  });

  useEffect(() => {
    if (checks) {
      const checked = new Set(checks.filter(c => c.isChecked).map(c => c.itemId));
      setCheckedItems(checked);
    }
  }, [checks]);

  const toggleMutation = useMutation({
    mutationFn: async ({ itemId, isChecked }: { itemId: number; isChecked: boolean }) => {
      const response = await fetch("/api/suguval/toggle", {
        method: "POST",
        body: JSON.stringify({ itemId, isChecked }),
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) throw new Error("Toggle failed");
      return response.json();
    },
    onMutate: async ({ itemId, isChecked }) => {
      setCheckedItems(prev => {
        const next = new Set(prev);
        if (isChecked) {
          next.add(itemId);
        } else {
          next.delete(itemId);
        }
        return next;
      });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/checks"] });
    }
  });

  const handleToggle = (itemId: number) => {
    const isCurrentlyChecked = checkedItems.has(itemId);
    toggleMutation.mutate({ itemId, isChecked: !isCurrentlyChecked });
  };

  const resetMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/suguval/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) throw new Error("Reset failed");
      return response.json();
    },
    onSuccess: () => {
      setCheckedItems(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/dashboard"] });
    }
  });

  const handleReset = () => {
    if (checkedItems.size === 0) return;
    const confirmMsg = language === "fr" 
      ? `Réinitialiser les ${checkedItems.size} articles cochés ?`
      : language === "vi"
        ? `Đặt lại ${checkedItems.size} món đã chọn?`
        : `รีเซ็ต ${checkedItems.size} รายการที่เลือก?`;
    if (confirm(confirmMsg)) {
      resetMutation.mutate();
    }
  };

  const [discordSent, setDiscordSent] = useState(false);
  const [showResetPrompt, setShowResetPrompt] = useState(false);
  const sendDiscordMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/suguval/send-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Envoi Discord échoué");
      return data;
    },
    onSuccess: (data) => {
      setDiscordSent(true);
      setTimeout(() => setDiscordSent(false), 4000);
      toast({
        title: "✅ Envoyé sur Discord",
        description: `${data.count} article${data.count > 1 ? "s" : ""} envoyé${data.count > 1 ? "s" : ""} sur #${data.channel || "général"}`,
      });
      setShowResetPrompt(true);
    },
    onError: (err: any) => {
      toast({
        title: "❌ Erreur Discord",
        description: err.message || "Impossible d'envoyer la liste",
        variant: "destructive",
      });
    }
  });

  // Category management mutations
  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      return apiRequest("PATCH", `/api/suguval/categories/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/categories"] });
    }
  });

  const reorderCategoriesMutation = useMutation({
    mutationFn: async (orderedIds: number[]) => {
      return apiRequest("POST", "/api/suguval/categories/reorder", { orderedIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/categories"] });
      setShowCategoryEditor(false);
    }
  });

  const requestProtectedAccess = (action: "categories" | "translations") => {
    setSpecialPin("");
    setPendingAction(action);
    setShowSpecialPinDialog(true);
  };

  const verifySpecialPin = () => {
    if (specialPin === UNLOCK_CODE) {
      setShowSpecialPinDialog(false);
      setSpecialPin("");
      
      if (pendingAction === "categories") {
        if (categories) {
          setEditingCategories([...categories].sort((a, b) => a.sortOrder - b.sortOrder));
        }
        setShowCategoryEditor(true);
      } else if (pendingAction === "translations") {
        window.location.href = "/courses/suguval/edit";
      }
      
      setPendingAction(null);
    }
  };

  const moveCategory = (index: number, direction: "up" | "down") => {
    const newOrder = [...editingCategories];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
    setEditingCategories(newOrder);
  };

  const startEditingCategory = (cat: SuguvalCategory) => {
    setEditingCategoryId(cat.id);
    setEditingCategoryName(cat.name);
  };

  const saveEditingCategory = () => {
    if (editingCategoryId && editingCategoryName.trim()) {
      updateCategoryMutation.mutate({ id: editingCategoryId, name: editingCategoryName.trim() });
      // Update local state
      setEditingCategories(prev => prev.map(c => 
        c.id === editingCategoryId ? { ...c, name: editingCategoryName.trim() } : c
      ));
    }
    setEditingCategoryId(null);
    setEditingCategoryName("");
  };

  const saveCategoryOrder = () => {
    const orderedIds = editingCategories.map(c => c.id);
    reorderCategoriesMutation.mutate(orderedIds);
  };

  const isLoading = categoriesLoading || checksLoading;
  const totalItems = categories?.reduce((acc, cat) => acc + cat.items.length, 0) || 0;
  const checkedCount = checkedItems.size;

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=dimanche, 5=vendredi, 6=samedi
  
  // Calculer la date d'achat selon les règles du restaurant
  // Fermé samedi et dimanche, donc :
  // - Vendredi (5) → Lundi (+3 jours)
  // - Samedi (6) → Lundi (+2 jours) 
  // - Dimanche (0) → Lundi (+1 jour)
  // - Autres jours → Demain (+1 jour)
  const purchaseDateObj = new Date(now);
  if (dayOfWeek === 5) { // Vendredi → Lundi
    purchaseDateObj.setDate(purchaseDateObj.getDate() + 3);
  } else if (dayOfWeek === 6) { // Samedi → Lundi
    purchaseDateObj.setDate(purchaseDateObj.getDate() + 2);
  } else if (dayOfWeek === 0) { // Dimanche → Lundi
    purchaseDateObj.setDate(purchaseDateObj.getDate() + 1);
  } else { // Autres jours → Demain
    purchaseDateObj.setDate(purchaseDateObj.getDate() + 1);
  }
  
  const today = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  
  const purchaseDate = purchaseDateObj.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });

  // PIN protection - show unlock screen if not authenticated
  if (!isAuthenticated) {
    return <PinProtection onUnlock={() => setIsAuthenticated(true)} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-orange-50 to-amber-50 dark:from-zinc-900 dark:to-zinc-800 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-orange-500" />
          <p className="text-lg text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  // Group categories by zone (zone 1-2 = Cuisine & Frais, zone 3-6 = Reserve & Livraison)
  const cuisineZones = [1, 2]; // CUISINE, SUSHI BAR
  const reserveZones = [3, 4, 5, 6]; // RÉSERVE SÈCHE, HYGIÈNE, BOISSONS, LIVRAISON
  
  const categoriesWithItems = categories?.filter(c => c.items.length > 0) || [];
  const feuil2Categories = categoriesWithItems.filter(c => cuisineZones.includes(c.zone || 1));
  const feuil1Categories = categoriesWithItems.filter(c => reserveZones.includes(c.zone || 3));

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-amber-50 dark:from-zinc-900 dark:to-zinc-800">
      <header className="sticky top-0 z-50 bg-green-600 dark:bg-green-700 text-white shadow-lg pt-safe">
        <div className="max-w-6xl mx-auto px-2 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div>
                <h1 className="text-base md:text-xl font-bold">SUGU Valentine</h1>
                <p className="text-green-100 text-[10px] md:text-xs">
                  {language === "fr" ? "Liste des courses" : language === "vi" ? "Danh sách mua sắm" : "รายการซื้อ"}
                </p>
              </div>
            </div>
            
            {/* Action buttons */}
            <div className="flex items-center gap-0.5">
              {/* Theme toggle */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-white hover:bg-white/20"
                title={theme === "dark" ? "Mode jour" : "Mode nuit"}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                data-testid="button-theme-toggle"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>

              {/* Calendar button */}
              <Link href="/courses/suguval/history">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-white hover:bg-white/20"
                  title={language === "fr" ? "Historique" : language === "vi" ? "Lịch sử" : "ประวัติ"}
                  data-testid="button-history"
                >
                  <Calendar className="h-4 w-4" />
                </Button>
              </Link>
              
              {/* Edit button - protected */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-white hover:bg-white/20"
                title="Modifier les traductions"
                onClick={() => requestProtectedAccess("translations")}
                data-testid="button-edit-translations"
              >
                <Pencil className="h-4 w-4" />
              </Button>

              {/* Category settings button - protected */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-white hover:bg-white/20"
                title="Gérer les catégories"
                onClick={() => requestProtectedAccess("categories")}
                data-testid="button-category-settings"
              >
                <Settings className="h-4 w-4" />
              </Button>

              {/* Reset button */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-white hover:bg-white/20"
                title={language === "fr" ? "Réinitialiser" : language === "vi" ? "Đặt lại" : "รีเซ็ต"}
                onClick={handleReset}
                disabled={checkedItems.size === 0 || resetMutation.isPending}
                data-testid="button-reset"
              >
                {resetMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
              </Button>

              {/* Discord send button */}
              <Button
                variant="ghost"
                size="icon"
                className={`hover:bg-white/20 transition-colors ${discordSent ? "text-blue-300" : "text-white"}`}
                title={language === "fr" ? "Envoyer sur Discord" : language === "vi" ? "Gửi Discord" : "ส่ง Discord"}
                onClick={() => {
                  if (checkedItems.size === 0) return;
                  sendDiscordMutation.mutate();
                }}
                disabled={checkedItems.size === 0 || sendDiscordMutation.isPending}
                data-testid="button-send-discord"
              >
                {sendDiscordMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : discordSent ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
              </Button>

              {/* Close button */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-white hover:bg-white/20"
                data-testid="button-close"
                onClick={() => {
                  localStorage.removeItem(STORAGE_KEY_AUTH);
                  window.location.href = "/courses/suguval";
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Language selector with flags */}
            <div className="flex items-center gap-0.5">
              {(Object.keys(FLAGS) as Language[]).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={`text-lg p-1 rounded transition-all touch-manipulation
                    ${language === lang 
                      ? "bg-white/30 scale-105 ring-1 ring-white" 
                      : "opacity-60 hover:opacity-100 hover:bg-white/10"
                    }`}
                  title={FLAGS[lang].label}
                  data-testid={`flag-${lang}`}
                >
                  {FLAGS[lang].emoji}
                </button>
              ))}
            </div>
            
            <div className="text-right">
              <Badge 
                variant="secondary" 
                className="bg-white/20 text-white text-sm md:text-base px-2 py-1 cursor-pointer hover:bg-white/30 transition-colors"
                onClick={() => setShowCheckedDialog(true)}
                data-testid="badge-checked-count"
              >
                <ShoppingCart className="h-4 w-4 mr-1 inline" />
                {checkedCount} / {totalItems}
              </Badge>
            </div>
          </div>
          <div className="flex items-center justify-between mt-1">
            <div className="text-left">
              <p className="text-white font-semibold capitalize text-xs md:text-sm">{today}</p>
              <p className="text-green-100 italic text-[10px] md:text-xs">
                {language === "fr" ? "Achat : " : language === "vi" ? "Mua: " : "ซื้อ: "}
                <span className="capitalize">{purchaseDate}</span>
              </p>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-2 py-6 pb-28">
        {/* Dashboard Summary Section - uses API stats */}
        <section className="mb-6" data-testid="section-dashboard-suguval">
          <Card className="border-green-200 dark:border-green-800 bg-gradient-to-r from-green-50 to-amber-50 dark:from-green-900/20 dark:to-amber-900/20">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-green-800 dark:text-green-300">
                    {language === "fr" ? "Progression du jour" : language === "vi" ? "Tiến độ hôm nay" : "ความคืบหน้าวันนี้"}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {language === "fr" 
                      ? `${dashboardStats?.checkedCount ?? checkedCount} sur ${dashboardStats?.totalItems ?? totalItems} articles cochés`
                      : language === "vi"
                        ? `${dashboardStats?.checkedCount ?? checkedCount} trên ${dashboardStats?.totalItems ?? totalItems} món đã chọn`
                        : `${dashboardStats?.checkedCount ?? checkedCount} จาก ${dashboardStats?.totalItems ?? totalItems} รายการที่เลือก`
                    }
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-completion-rate-suguval">
                    {dashboardStats?.completionRate ?? (totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0)}%
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {language === "fr" ? "complété" : language === "vi" ? "hoàn thành" : "เสร็จสิ้น"}
                  </p>
                </div>
              </div>
              {/* Progress Bar */}
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden" data-testid="progress-container-suguval">
                <div 
                  className="bg-gradient-to-r from-green-500 to-amber-500 h-3 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${dashboardStats?.completionRate ?? (totalItems > 0 ? (checkedCount / totalItems) * 100 : 0)}%` }}
                  data-testid="progress-bar-suguval"
                />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Weekly History Section */}
        <WeeklyHistorySection language={language} endpoint="/api/suguval/weekly" colorScheme="green" />

        {feuil2Categories.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xl md:text-2xl font-bold text-green-800 dark:text-green-300 mb-4 flex items-center gap-2">
              <ChefHat className="h-6 w-6" />
              {language === "fr" ? "Cuisine & Frais" : language === "vi" ? "Bếp & Tươi sống" : "ครัวและสด"}
            </h2>
            <div className="grid gap-2 grid-cols-3">
              {feuil2Categories.map(category => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  checkedItems={checkedItems}
                  onToggle={handleToggle}
                  language={language}
                  variant="cuisine"
                />
              ))}
            </div>
          </section>
        )}

        {feuil1Categories.length > 0 && (
          <section>
            <h2 className="text-xl md:text-2xl font-bold text-orange-800 dark:text-orange-300 mb-4 flex items-center gap-2">
              <ShoppingCart className="h-6 w-6" />
              {language === "fr" ? "Reserve & Livraison" : language === "vi" ? "Kho & Giao hàng" : "คลังและจัดส่ง"}
            </h2>
            <div className="grid gap-2 grid-cols-3">
              {feuil1Categories.map(category => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  checkedItems={checkedItems}
                  onToggle={handleToggle}
                  language={language}
                />
              ))}
            </div>
          </section>
        )}

        {/* Commentaires - Employee notes to admin */}
        <section className="mt-8">
          <Card className="border-blue-200 dark:border-blue-800">
            <CardHeader className="py-3 bg-blue-50 dark:bg-blue-900/30">
              <CardTitle className="text-base flex items-center gap-2 text-blue-800 dark:text-blue-300">
                <MessageSquare className="h-5 w-5" />
                {language === "fr" ? "Commentaires" : language === "vi" ? "Ghi chú" : "ความคิดเห็น"}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-3">
                <div className="relative">
                  <Textarea
                    placeholder={language === "fr" ? "Votre message pour demain..." : language === "vi" ? "Tin nhắn cho ngày mai..." : "ข้อความสำหรับพรุ่งนี้..."}
                    value={commentMessage}
                    onChange={(e) => setCommentMessage(e.target.value)}
                    className="text-sm"
                    rows={3}
                    disabled={isTranslating}
                    data-testid="input-comment-message"
                  />
                  {isTranslating && (
                    <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-md">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {language === "fr" ? "Traduction..." : language === "vi" ? "Đang dịch..." : "กำลังแปล..."}
                      </div>
                    </div>
                  )}
                </div>
                <Button
                  onClick={() => saveCommentMutation.mutate(commentMessage.trim())}
                  disabled={saveCommentMutation.isPending}
                  className="w-full bg-blue-600"
                  data-testid="button-send-comment"
                >
                  {saveCommentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {language === "fr" ? "Sauvegarder" : language === "vi" ? "Lưu" : "บันทึก"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
      {checkedCount > 0 && (
        <footer className="fixed bottom-0 left-0 right-0 bg-green-600 dark:bg-green-700 text-white p-5 shadow-lg safe-area-inset-bottom">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-3">
            <Check className="h-6 w-6" />
            <span className="font-medium text-lg md:text-xl">
              {language === "fr" 
                ? `${checkedCount} article${checkedCount > 1 ? "s" : ""} à acheter demain`
                : language === "vi"
                  ? `${checkedCount} món cần mua ngày mai`
                  : `${checkedCount} รายการที่ต้องซื้อพรุ่งนี้`
              }
            </span>
          </div>
        </footer>
      )}
      {/* Reset prompt after Discord send */}
      <Dialog open={showResetPrompt} onOpenChange={setShowResetPrompt}>
        <DialogContent className="max-w-xs text-center">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center gap-2 text-base">
              <MessageSquare className="h-5 w-5 text-blue-500" />
              {language === "fr" ? "Liste envoyée sur Discord" : language === "vi" ? "Đã gửi lên Discord" : "ส่งถึง Discord แล้ว"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {language === "fr"
              ? "Voulez-vous réinitialiser la liste maintenant ?"
              : language === "vi"
              ? "Bạn có muốn đặt lại danh sách không ?"
              : "คุณต้องการรีเซ็ตรายการตอนนี้ไหม ?"}
          </p>
          <DialogFooter className="flex gap-2 sm:justify-center">
            <Button
              variant="outline"
              onClick={() => setShowResetPrompt(false)}
              data-testid="button-reset-no"
            >
              {language === "fr" ? "Non" : language === "vi" ? "Không" : "ไม่"}
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => {
                setShowResetPrompt(false);
                resetMutation.mutate();
              }}
              disabled={resetMutation.isPending}
              data-testid="button-reset-yes"
            >
              {resetMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              {language === "fr" ? "Oui, réinitialiser" : language === "vi" ? "Có, đặt lại" : "ใช่ รีเซ็ต"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog showing checked items */}
      <Dialog open={showCheckedDialog} onOpenChange={setShowCheckedDialog}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              {language === "fr" 
                ? `${checkedCount} article${checkedCount > 1 ? "s" : ""} coché${checkedCount > 1 ? "s" : ""}`
                : language === "vi"
                  ? `${checkedCount} món đã chọn`
                  : `${checkedCount} รายการที่เลือก`
              }
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            {checkedCount === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                {language === "fr" ? "Aucun article coché" : language === "vi" ? "Chưa chọn món nào" : "ยังไม่ได้เลือกรายการ"}
              </p>
            ) : (
              <div className="space-y-1">
                {categories?.flatMap(cat => 
                  cat.items
                    .filter(item => checkedItems.has(item.id))
                    .map(item => {
                      const displayName = language === "fr" 
                        ? item.name 
                        : language === "vi" 
                          ? (item.nameVi || item.name)
                          : (item.nameTh || item.name);
                      return (
                        <div 
                          key={item.id} 
                          className="flex items-center justify-between py-2 px-3 rounded-md bg-green-50 dark:bg-green-900/20"
                        >
                          <div>
                            <span className="font-medium">{displayName}</span>
                            {language !== "fr" && (
                              <span className="text-xs text-muted-foreground block">{item.name}</span>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-100"
                            onClick={() => handleToggle(item.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* iOS-style PIN pad dialog */}
      <Dialog open={showSpecialPinDialog} onOpenChange={(open) => {
        if (!open) setSpecialPin("");
        setShowSpecialPinDialog(open);
      }}>
        <DialogContent className="max-w-xs bg-gray-900/95 dark:bg-gray-900/98 border-none p-6">
          <div className="flex flex-col items-center">
            <Lock className="h-8 w-8 text-white mb-4" />
            <p className="text-white text-lg mb-4">
              {language === "fr" ? "Saisissez le code" : language === "vi" ? "Nhập mã" : "ใส่รหัส"}
            </p>
            
            <div className="flex gap-3 mb-8">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full border-2 border-white transition-all ${
                    specialPin.length > i ? "bg-white" : "bg-transparent"
                  }`}
                />
              ))}
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  onClick={() => {
                    if (specialPin.length < 6) {
                      const newPin = specialPin + num;
                      setSpecialPin(newPin);
                      if (newPin.length === 6 && newPin === UNLOCK_CODE) {
                        setTimeout(() => {
                          setShowSpecialPinDialog(false);
                          setSpecialPin("");
                          if (pendingAction === "categories") {
                            if (categories) {
                              setEditingCategories([...categories].sort((a, b) => a.sortOrder - b.sortOrder));
                            }
                            setShowCategoryEditor(true);
                          } else if (pendingAction === "translations") {
                            window.location.href = "/courses/suguval/edit";
                          }
                          setPendingAction(null);
                        }, 200);
                      }
                    }
                  }}
                  className="w-16 h-16 rounded-full bg-gray-700/80 text-white text-2xl font-light 
                    flex items-center justify-center hover:bg-gray-600/80 active:bg-gray-500/80 transition-colors"
                  data-testid={`pin-${num}`}
                >
                  {num}
                </button>
              ))}
              <div /> 
              <button
                onClick={() => {
                  if (specialPin.length < 6) {
                    const newPin = specialPin + "0";
                    setSpecialPin(newPin);
                    if (newPin.length === 6 && newPin === UNLOCK_CODE) {
                      setTimeout(() => {
                        setShowSpecialPinDialog(false);
                        setSpecialPin("");
                        if (pendingAction === "categories") {
                          if (categories) {
                            setEditingCategories([...categories].sort((a, b) => a.sortOrder - b.sortOrder));
                          }
                          setShowCategoryEditor(true);
                        } else if (pendingAction === "translations") {
                          window.location.href = "/courses/suguval/edit";
                        }
                        setPendingAction(null);
                      }, 200);
                    }
                  }
                }}
                className="w-16 h-16 rounded-full bg-gray-700/80 text-white text-2xl font-light 
                  flex items-center justify-center hover:bg-gray-600/80 active:bg-gray-500/80 transition-colors"
                data-testid="pin-0"
              >
                0
              </button>
              <button
                onClick={() => setSpecialPin(prev => prev.slice(0, -1))}
                className="w-16 h-16 flex items-center justify-center text-white"
                data-testid="pin-delete"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            
            <button
              onClick={() => setShowSpecialPinDialog(false)}
              className="mt-6 text-gray-400 text-sm hover:text-white transition-colors"
            >
              {language === "fr" ? "Annuler" : language === "vi" ? "Hủy" : "ยกเลิก"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Category editor dialog */}
      <Dialog open={showCategoryEditor} onOpenChange={setShowCategoryEditor}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Gérer les catégories
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-6 px-6 space-y-2">
            {editingCategories.map((cat, index) => (
              <div 
                key={cat.id} 
                className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border"
              >
                <div className="flex flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => moveCategory(index, "up")}
                    disabled={index === 0}
                    data-testid={`button-move-up-${cat.id}`}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => moveCategory(index, "down")}
                    disabled={index === editingCategories.length - 1}
                    data-testid={`button-move-down-${cat.id}`}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
                
                <span className="text-sm text-muted-foreground w-6">{index + 1}</span>
                
                {editingCategoryId === cat.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={editingCategoryName}
                      onChange={(e) => setEditingCategoryName(e.target.value)}
                      className="flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEditingCategory();
                        if (e.key === "Escape") {
                          setEditingCategoryId(null);
                          setEditingCategoryName("");
                        }
                      }}
                      data-testid={`input-category-name-${cat.id}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={saveEditingCategory}
                      className="text-green-600"
                      data-testid={`button-save-category-${cat.id}`}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingCategoryId(null);
                        setEditingCategoryName("");
                      }}
                      className="text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-between">
                    <div>
                      <span className="font-medium">{cat.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({cat.items.length} articles)
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => startEditingCategory(cat)}
                      data-testid={`button-edit-category-${cat.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowCategoryEditor(false)}>
              Annuler
            </Button>
            <Button 
              onClick={saveCategoryOrder}
              disabled={reorderCategoriesMutation.isPending}
              data-testid="button-save-category-order"
            >
              {reorderCategoriesMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Enregistrer l'ordre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryCard({
  category,
  checkedItems,
  onToggle,
  language,
  variant = "reserve"
}: {
  category: SuguvalCategory;
  checkedItems: Set<number>;
  onToggle: (itemId: number) => void;
  language: Language;
  variant?: "reserve" | "cuisine";
}) {
  const checkedInCategory = category.items.filter(item => checkedItems.has(item.id)).length;
  const headerColor = variant === "cuisine" 
    ? "bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700"
    : "bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700";
  const badgeColor = variant === "cuisine"
    ? "bg-green-500"
    : "bg-orange-500";

  const categoryName = language === "fr" 
    ? category.name 
    : language === "vi" 
      ? (category.nameVi || category.name)
      : (category.nameTh || category.name);

  // Don't render if no items
  if (category.items.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className={`py-1.5 px-2 ${headerColor} border-b`}>
        <CardTitle className="flex items-center justify-between text-xs">
          <span className="truncate font-semibold">{categoryName}</span>
          {checkedInCategory > 0 && (
            <Badge className={`${badgeColor} text-white text-[10px] px-1.5 py-0`}>
              {checkedInCategory}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {category.items.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              isChecked={checkedItems.has(item.id)}
              onToggle={() => onToggle(item.id)}
              language={language}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ItemRow({
  item,
  isChecked,
  onToggle,
  language
}: {
  item: SuguvalItem;
  isChecked: boolean;
  onToggle: () => void;
  language: Language;
}) {
  // Get the display name based on language
  const displayName = language === "fr" 
    ? item.name 
    : language === "vi" 
      ? (item.nameVi || item.name)
      : (item.nameTh || item.name);
  
  // Show subtitle in French if viewing in another language
  const subtitle = language !== "fr" ? item.name : null;

  return (
    <label
      className={`flex items-center gap-1.5 px-1.5 py-1 cursor-pointer transition-colors touch-manipulation
        ${isChecked 
          ? "bg-green-50 dark:bg-green-900/20" 
          : "hover:bg-muted/50 active:bg-muted"
        }`}
      data-testid={`item-${item.id}`}
    >
      <Checkbox
        checked={isChecked}
        onCheckedChange={onToggle}
        className="h-4 w-4 flex-shrink-0"
        data-testid={`checkbox-${item.id}`}
      />
      <span className={`flex-1 min-w-0 font-medium text-[10px] leading-tight truncate ${isChecked ? "text-muted-foreground" : ""}`}>
        {displayName}
      </span>
      {isChecked && (
        <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
      )}
    </label>
  );
}
