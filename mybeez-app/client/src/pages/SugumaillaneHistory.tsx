import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Calendar, ArrowLeft, ChevronLeft, ChevronRight, ShoppingCart, X, Plus, Check } from "lucide-react";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";

type Language = "fr" | "vi" | "th";

const FLAGS: Record<Language, { emoji: string; label: string }> = {
  fr: { emoji: "🇫🇷", label: "Français" },
  vi: { emoji: "🇻🇳", label: "Tiếng Việt" },
  th: { emoji: "🇹🇭", label: "ไทย" }
};

const WEEKDAYS: Record<Language, string[]> = {
  fr: ["lu", "ma", "me", "je", "ve", "sa", "di"],
  vi: ["T2", "T3", "T4", "T5", "T6", "T7", "CN"],
  th: ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"]
};

interface HistoryEntry {
  date: string;
  items: Array<{
    id: number;
    name: string;
    nameVi?: string | null;
    nameTh?: string | null;
    categoryName: string;
  }>;
}

interface ChecklistItem {
  id: number;
  name: string;
  nameVi: string | null;
  nameTh: string | null;
  categoryId: number;
  categoryName: string;
  isChecked: boolean;
}

interface CategoryWithItems {
  id: number;
  name: string;
  nameVi: string | null;
  nameTh: string | null;
  items: ChecklistItem[];
}

export default function SugumaillaneHistory() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("sugumaillane-lang");
    return (saved as Language) || "fr";
  });

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"calendar" | "past" | "future">("calendar");

  useEffect(() => {
    localStorage.setItem("sugumaillane-lang", language);
  }, [language]);

  const { data: history, isLoading } = useQuery<HistoryEntry[]>({
    queryKey: ["/api/sugumaillane/history", selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/sugumaillane/history?month=${selectedMonth}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    }
  });

  const { data: categories } = useQuery<CategoryWithItems[]>({
    queryKey: ["/api/sugumaillane/categories"],
    enabled: viewMode === "future"
  });

  const { data: futureItems } = useQuery<number[]>({
    queryKey: ["/api/sugumaillane/future", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/sugumaillane/future?date=${selectedDate}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch future items");
      return res.json();
    },
    enabled: !!selectedDate && viewMode === "future"
  });

  const addFutureItemMutation = useMutation({
    mutationFn: async ({ itemId, date }: { itemId: number; date: string }) => {
      return apiRequest("POST", "/api/sugumaillane/future", { itemId, date });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sugumaillane/future", selectedDate] });
    }
  });

  const removeFutureItemMutation = useMutation({
    mutationFn: async ({ itemId, date }: { itemId: number; date: string }) => {
      return apiRequest("DELETE", "/api/sugumaillane/future", { itemId, date });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sugumaillane/future", selectedDate] });
    }
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
    const locale = language === "fr" ? "fr-FR" : language === "vi" ? "vi-VN" : "th-TH";
    return date.toLocaleDateString(locale, options);
  };

  const prevMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month - 2, 1);
    setSelectedMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  };

  const nextMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month, 1);
    setSelectedMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  };

  const getMonthLabel = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    const locale = language === "fr" ? "fr-FR" : language === "vi" ? "vi-VN" : "th-TH";
    return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  };

  const getCalendarDays = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;
    const days: Array<{ date: Date | null; dayNum: number | null }> = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      const prevDate = new Date(year, month - 1, -startDayOfWeek + i + 1);
      days.push({ date: prevDate, dayNum: prevDate.getDate() });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(year, month - 1, d), dayNum: d });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const nextDate = new Date(year, month, i);
      days.push({ date: nextDate, dayNum: nextDate.getDate() });
    }
    return days;
  };

  const getHistoryForDate = (dateStr: string) => history?.find(h => h.date === dateStr);
  const isToday = (date: Date) => date.toDateString() === new Date().toDateString();
  const isPastDate = (date: Date) => { const t = new Date(); t.setHours(0,0,0,0); return date < t; };
  const isFutureDate = (date: Date) => { const t = new Date(); t.setHours(0,0,0,0); return date > t; };
  const isCurrentMonth = (date: Date) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    return date.getMonth() === month - 1 && date.getFullYear() === year;
  };
  const isWeekend = (date: Date) => { const d = date.getDay(); return d === 0 || d === 6; };

  const handleDateClick = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    setSelectedDate(dateStr);
    if (isPastDate(date) || isToday(date)) setViewMode("past");
    else if (isFutureDate(date)) setViewMode("future");
  };

  const closeDetailView = () => { setViewMode("calendar"); setSelectedDate(null); };

  const toggleFutureItem = (itemId: number) => {
    if (!selectedDate) return;
    if (futureItems?.includes(itemId)) removeFutureItemMutation.mutate({ itemId, date: selectedDate });
    else addFutureItemMutation.mutate({ itemId, date: selectedDate });
  };

  const calendarDays = getCalendarDays();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-green-100 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-green-500 mx-auto mb-4" />
          <p className="text-muted-foreground">
            {language === "fr" ? "Chargement..." : language === "vi" ? "Đang tải..." : "กำลังโหลด..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-green-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-gradient-to-r from-green-600 to-green-700 text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/sugumaillane">
                <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" aria-label="Retour a la checklist" data-testid="button-back">
                  <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                <h1 className="text-lg md:text-xl font-bold">
                  {language === "fr" ? "Calendrier Maillane" : language === "vi" ? "Lịch Maillane" : "ปฏิทิน Maillane"}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {(Object.keys(FLAGS) as Language[]).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={`text-lg p-1 rounded-lg transition-all ${language === lang ? "bg-white/30 scale-110" : "hover:bg-white/20 opacity-70"}`}
                  title={FLAGS[lang].label}
                  data-testid={`lang-${lang}`}
                >
                  {FLAGS[lang].emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-4">
        {viewMode === "calendar" ? (
          <Card className="overflow-hidden">
            <CardHeader className="py-3 bg-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <span className="text-white font-medium capitalize">{getMonthLabel()}</span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 h-8 w-8" onClick={prevMonth} aria-label="Mois precedent" data-testid="button-prev-month">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 h-8 w-8" onClick={nextMonth} aria-label="Mois suivant" data-testid="button-next-month">
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 bg-gray-800 dark:bg-gray-900">
              <div className="grid grid-cols-7 text-center text-gray-400 text-sm py-2 border-b border-gray-700">
                {WEEKDAYS[language].map((day, i) => <div key={i} className="py-1">{day}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((day, idx) => {
                  if (!day.date) return <div key={idx} className="p-2" />;
                  const dateStr = day.date.toISOString().split('T')[0];
                  const historyEntry = getHistoryForDate(dateStr);
                  const hasHistory = !!historyEntry && historyEntry.items.length > 0;
                  const isCurrent = isToday(day.date);
                  const inCurrentMonth = isCurrentMonth(day.date);
                  const weekend = isWeekend(day.date);
                  return (
                    <button
                      key={idx}
                      onClick={() => handleDateClick(day.date!)}
                      className={`relative aspect-square flex flex-col items-center justify-center text-sm transition-all hover:bg-gray-700/50 ${!inCurrentMonth ? "text-gray-600" : "text-gray-300"} ${weekend && inCurrentMonth ? "text-gray-500" : ""} ${isCurrent ? "bg-purple-400 text-white rounded-full mx-1 my-1" : ""} ${hasHistory && !isCurrent ? "font-bold text-green-400" : ""}`}
                      data-testid={`calendar-day-${dateStr}`}
                    >
                      <span>{day.dayNum}</span>
                      {hasHistory && !isCurrent && <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-green-500" />}
                    </button>
                  );
                })}
              </div>
            </CardContent>
            <div className="p-3 bg-gray-800 dark:bg-gray-900 border-t border-gray-700">
              <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  <span>{language === "fr" ? "Aujourd'hui" : language === "vi" ? "Hôm nay" : "วันนี้"}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span>{language === "fr" ? "Achats" : language === "vi" ? "Đã mua" : "ซื้อแล้ว"}</span>
                </div>
              </div>
            </div>
          </Card>
        ) : viewMode === "past" && selectedDate ? (
          <Card>
            <CardHeader className="py-3 bg-green-100 dark:bg-green-900/30">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="capitalize">{formatDate(selectedDate)}</span>
                <Button variant="ghost" size="icon" onClick={closeDetailView} className="h-8 w-8" aria-label="Fermer le detail" data-testid="button-close-detail">
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(() => {
                const entry = getHistoryForDate(selectedDate);
                if (!entry || entry.items.length === 0) {
                  return (
                    <div className="p-8 text-center text-muted-foreground">
                      <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-50" />
                      <p>{language === "fr" ? "Aucun achat ce jour" : language === "vi" ? "Không có mua sắm ngày này" : "ไม่มีการซื้อในวันนี้"}</p>
                    </div>
                  );
                }
                return (
                  <div className="divide-y divide-border">
                    {entry.items.map((item) => {
                      const displayName = language === "fr" ? item.name : language === "vi" ? (item.nameVi || item.name) : (item.nameTh || item.name);
                      return (
                        <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                          <div>
                            <span className="font-medium">{displayName}</span>
                            {language !== "fr" && <span className="text-xs text-muted-foreground block">{item.name}</span>}
                          </div>
                          <Badge variant="secondary" className="text-xs">{item.categoryName}</Badge>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        ) : viewMode === "future" && selectedDate ? (
          <Card>
            <CardHeader className="py-3 bg-blue-100 dark:bg-blue-900/30">
              <CardTitle className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  <span className="capitalize">{formatDate(selectedDate)}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={closeDetailView} className="h-8 w-8" aria-label="Fermer la planification" data-testid="button-close-future">
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border-b">
                <p className="text-sm text-center text-blue-700 dark:text-blue-300">
                  {language === "fr" ? "Sélectionnez les articles à préparer pour ce jour" : language === "vi" ? "Chọn các mặt hàng cần chuẩn bị cho ngày này" : "เลือกสินค้าที่จะเตรียมสำหรับวันนี้"}
                </p>
              </div>
              {categories && categories.length > 0 ? (
                <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
                  {categories.map((cat) => (
                    <div key={cat.id}>
                      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 font-medium text-sm">
                        {language === "fr" ? cat.name : language === "vi" ? (cat.nameVi || cat.name) : (cat.nameTh || cat.name)}
                      </div>
                      {cat.items.map((item) => {
                        const displayName = language === "fr" ? item.name : language === "vi" ? (item.nameVi || item.name) : (item.nameTh || item.name);
                        const isSelected = futureItems?.includes(item.id);
                        return (
                          <div
                            key={item.id}
                            className={`px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 ${isSelected ? "bg-blue-50 dark:bg-blue-900/20" : ""}`}
                            onClick={() => toggleFutureItem(item.id)}
                            data-testid={`future-item-${item.id}`}
                          >
                            <Checkbox checked={isSelected} className={isSelected ? "border-blue-500 bg-blue-500" : ""} />
                            <div className="flex-1">
                              <span className={isSelected ? "font-medium text-blue-700 dark:text-blue-300" : ""}>{displayName}</span>
                              {language !== "fr" && <span className="text-xs text-muted-foreground block">{item.name}</span>}
                            </div>
                            {isSelected && <Check className="h-4 w-4 text-blue-500" />}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                </div>
              )}
              {futureItems && futureItems.length > 0 && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border-t">
                  <Badge className="bg-blue-500">
                    {futureItems.length} {language === "fr" ? "article(s) prévu(s)" : language === "vi" ? "mặt hàng đã chọn" : "รายการที่เลือก"}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
