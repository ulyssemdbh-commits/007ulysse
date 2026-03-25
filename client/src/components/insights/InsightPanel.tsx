import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface InsightPanelProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}

export function InsightPanel({ title, icon, children, onClose, className }: InsightPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "fixed bottom-24 right-4 z-40 w-80 md:w-96",
        isExpanded && "w-[90vw] md:w-[600px] h-[60vh]",
        className
      )}
    >
      <Card className="bg-card/90 backdrop-blur-xl border-border shadow-2xl h-full">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-2">
            {icon}
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-6 w-6"
              data-testid="button-toggle-expand"
            >
              {isExpanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </Button>
            {onClose && (
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                className="h-6 w-6"
                data-testid="button-close-insight"
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className={cn("overflow-auto", isExpanded ? "h-[calc(100%-60px)]" : "max-h-64")}>
          {children}
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface ChartInsightProps {
  data: { name: string; value: number; color?: string }[];
  title: string;
  onClose?: () => void;
}

export function ChartInsight({ data, title, onClose }: ChartInsightProps) {
  const maxValue = Math.max(...data.map(d => d.value), 1);
  
  return (
    <InsightPanel title={title} onClose={onClose}>
      <div className="space-y-3">
        {data.map((item, idx) => (
          <div key={idx} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-foreground">{item.name}</span>
              <span className="text-muted-foreground">{item.value}</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(item.value / maxValue) * 100}%` }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                className="h-full rounded-full"
                style={{ backgroundColor: item.color || "hsl(var(--primary))" }}
              />
            </div>
          </div>
        ))}
      </div>
    </InsightPanel>
  );
}
