import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart3, ChevronUp, ChevronDown } from "lucide-react";

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

export function WeeklyHistorySection({
  language,
  endpoint,
  colorScheme,
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

  const colors =
    colorScheme === "green"
      ? {
          border: "border-green-200 dark:border-green-800",
          bg: "from-green-50 to-amber-50 dark:from-green-900/20 dark:to-amber-900/20",
          title: "text-green-800 dark:text-green-300",
          bar: "bg-green-500",
        }
      : {
          border: "border-teal-200 dark:border-teal-800",
          bg: "from-teal-50 to-emerald-50 dark:from-teal-900/20 dark:to-emerald-900/20",
          title: "text-teal-800 dark:text-teal-300",
          bar: "bg-teal-500",
        };

  if (isLoading || !weeklyStats) return null;

  const maxRate = Math.max(...weeklyStats.days.map((d) => d.completionRate), 1);
  const sectionId = colorScheme === "green" ? "suguval" : "sugumaillane";

  return (
    <section
      className="mb-6"
      aria-label={
        language === "fr"
          ? "Historique hebdomadaire"
          : language === "vi"
          ? "Lich su tuan"
          : "ประวัติสัปดาห์"
      }
      data-testid={`section-weekly-${sectionId}`}
    >
      <Card className={`${colors.border} bg-gradient-to-r ${colors.bg}`}>
        <CardContent className="pt-4 pb-4">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg p-1 -m-1"
            aria-expanded={isExpanded}
            aria-controls={`weekly-chart-${sectionId}`}
            data-testid="button-toggle-weekly-history"
          >
            <div className="flex items-center gap-2">
              <BarChart3 className={`h-5 w-5 ${colors.title}`} aria-hidden="true" />
              <h3 className={`text-lg font-semibold ${colors.title}`}>
                {language === "fr"
                  ? "Historique hebdomadaire"
                  : language === "vi"
                  ? "Lich su tuan"
                  : "ประวัติสัปดาห์"}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {language === "fr" ? "Moy:" : language === "vi" ? "TB:" : "เฉลี่ย:"}{" "}
                {weeklyStats.summary.averageCompletion}%
              </span>
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
          </button>

          {isExpanded && (
            <div id={`weekly-chart-${sectionId}`}>
              <div
                className="flex items-end justify-between gap-1 h-24 mt-4"
                role="img"
                aria-label={`Graphique hebdomadaire — moyenne ${weeklyStats.summary.averageCompletion}%`}
                data-testid={`chart-weekly-${sectionId}`}
              >
                {weeklyStats.days.map((day, idx) => (
                  <div key={day.date} className="flex flex-col items-center flex-1">
                    <span className="text-xs text-muted-foreground mb-1">
                      {day.completionRate}%
                    </span>
                    <div
                      className={`w-full ${colors.bar} rounded-t transition-all duration-300`}
                      style={{
                        height: `${
                          maxRate > 0 ? (day.completionRate / maxRate) * 60 : 0
                        }px`,
                        minHeight: day.completionRate > 0 ? "4px" : "2px",
                      }}
                      data-testid={`bar-day-${idx}`}
                    />
                    <span className="text-xs font-medium mt-1">{day.dayName}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <span className="block text-muted-foreground">
                    {language === "fr"
                      ? "Jours actifs"
                      : language === "vi"
                      ? "Ngay hoat dong"
                      : "วันที่มีกิจกรรม"}
                  </span>
                  <span className="font-semibold" data-testid="text-active-days">
                    {weeklyStats.summary.daysWithActivity}/7
                  </span>
                </div>
                <div>
                  <span className="block text-muted-foreground">
                    {language === "fr"
                      ? "Moy. articles"
                      : language === "vi"
                      ? "TB. mon"
                      : "เฉลี่ย รายการ"}
                  </span>
                  <span className="font-semibold" data-testid="text-avg-items">
                    {weeklyStats.summary.averageCheckedItems}
                  </span>
                </div>
                <div>
                  <span className="block text-muted-foreground">
                    {language === "fr"
                      ? "Total articles"
                      : language === "vi"
                      ? "Tong mon"
                      : "รวมรายการ"}
                  </span>
                  <span className="font-semibold" data-testid="text-total-baseline">
                    {weeklyStats.summary.totalItemsBaseline}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
