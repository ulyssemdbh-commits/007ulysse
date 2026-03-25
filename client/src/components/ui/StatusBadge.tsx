import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const getStyles = (s: string) => {
    switch (s.toLowerCase()) {
      case "active":
      case "in_progress":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "completed":
      case "done":
        return "bg-green-500/10 text-green-400 border-green-500/20";
      case "todo":
        return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
      case "archived":
        return "bg-gray-500/10 text-gray-400 border-gray-500/20";
      case "high":
        return "bg-red-500/10 text-red-400 border-red-500/20";
      case "medium":
        return "bg-orange-500/10 text-orange-400 border-orange-500/20";
      case "low":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      default:
        return "bg-secondary text-muted-foreground border-border";
    }
  };

  const formatStatus = (s: string) => {
    return s.replace("_", " ").charAt(0).toUpperCase() + s.slice(1).replace("_", " ");
  };

  return (
    <span className={cn(
      "px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase tracking-wider",
      getStyles(status)
    )}>
      {formatStatus(status)}
    </span>
  );
}
