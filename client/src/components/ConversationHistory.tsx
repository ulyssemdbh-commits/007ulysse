import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search, Calendar, MessageSquare, X, ChevronLeft, Download, FileText, FileType, Volume2, Square, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { format, subDays, subWeeks, subMonths } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useVoiceReplay } from "@/hooks/useVoiceReplay";

interface ConversationPreview {
  id: number;
  title: string;
  createdAt: string;
  messageCount: number;
  lastMessage?: string;
  matchedContent?: string;
}

interface ConversationHistoryProps {
  onSelectConversation: (id: number) => void;
  onClose: () => void;
  activeConversationId: number | null;
}

type DateFilter = "all" | "today" | "week" | "month";

export function ConversationHistory({ 
  onSelectConversation, 
  onClose,
  activeConversationId 
}: ConversationHistoryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [replayingId, setReplayingId] = useState<number | null>(null);
  
  const voiceReplay = useVoiceReplay();

  const getDateRange = useCallback(() => {
    const now = new Date();
    switch (dateFilter) {
      case "today":
        return { startDate: subDays(now, 1).toISOString() };
      case "week":
        return { startDate: subWeeks(now, 1).toISOString() };
      case "month":
        return { startDate: subMonths(now, 1).toISOString() };
      default:
        return {};
    }
  }, [dateFilter]);

  const { data: conversations, isLoading } = useQuery<ConversationPreview[]>({
    queryKey: ["/api/conversations/search", debouncedQuery, dateFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedQuery) params.append("query", debouncedQuery);
      const dateRange = getDateRange();
      if (dateRange.startDate) params.append("startDate", dateRange.startDate);
      
      const response = await fetch(`/api/conversations/search?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to search conversations");
      return response.json();
    },
  });

  const handleSearch = useCallback(() => {
    setDebouncedQuery(searchQuery);
  }, [searchQuery]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setDebouncedQuery("");
  };

  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const downloadAsText = async (e: React.MouseEvent, convId: number) => {
    e.stopPropagation();
    setDownloadingId(convId);
    try {
      const response = await fetch(`/api/conversations/${convId}/export/text`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Export failed" }));
        console.error("Export error:", error);
        alert("Erreur lors de l'export: " + (error.error || "Echec de l'export"));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `conversation-${convId}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download text:", error);
      alert("Erreur lors du téléchargement");
    } finally {
      setDownloadingId(null);
    }
  };

  const downloadAsPDF = async (e: React.MouseEvent, convId: number) => {
    e.stopPropagation();
    setDownloadingId(convId);
    try {
      const response = await fetch(`/api/conversations/${convId}/export/pdf`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Export failed" }));
        console.error("Export error:", error);
        alert("Erreur lors de l'export: " + (error.error || "Echec de l'export"));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `conversation-${convId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download PDF:", error);
      alert("Erreur lors du téléchargement");
    } finally {
      setDownloadingId(null);
    }
  };

  const startVoiceReplay = async (e: React.MouseEvent, convId: number) => {
    e.stopPropagation();
    if (replayingId === convId && voiceReplay.state.isPlaying) {
      voiceReplay.stop();
      setReplayingId(null);
      return;
    }
    
    setReplayingId(convId);
    try {
      const response = await fetch(`/api/conversations/${convId}`);
      if (!response.ok) throw new Error("Failed to fetch conversation");
      const data = await response.json();
      
      if (data.messages && data.messages.length > 0) {
        await voiceReplay.playConversation(data.messages);
      }
    } catch (error) {
      console.error("Failed to start voice replay:", error);
    } finally {
      setReplayingId(null);
    }
  };

  const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  const highlightMatch = (text: string, query: string) => {
    if (!query || !text) return text;
    try {
      const escapedQuery = escapeRegex(query);
      const parts = text.split(new RegExp(`(${escapedQuery})`, "gi"));
      return parts.map((part, i) => 
        part.toLowerCase() === query.toLowerCase() 
          ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">{part}</mark>
          : part
      );
    } catch {
      return text;
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            data-testid="button-close-history"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <h2 className="text-lg font-semibold">Historique</h2>
        </div>
      </div>

      {voiceReplay.state.isPlaying && (
        <div className="flex items-center justify-between px-4 py-2 bg-primary/10 border-b border-border/50">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Volume2 className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs truncate">{voiceReplay.state.currentMessage}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-muted-foreground mr-2">
              {voiceReplay.state.currentIndex + 1}/{voiceReplay.state.totalMessages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => voiceReplay.skipToPrevious()}
              data-testid="button-replay-prev"
            >
              <SkipBack className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => voiceReplay.state.isPlaying ? voiceReplay.pause() : voiceReplay.resume()}
              data-testid="button-replay-toggle"
            >
              {voiceReplay.state.isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => voiceReplay.skipToNext()}
              data-testid="button-replay-next"
            >
              <SkipForward className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { voiceReplay.stop(); setReplayingId(null); }}
              data-testid="button-replay-stop"
            >
              <Square className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      <div className="p-4 space-y-3 border-b border-border/50">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Rechercher par mot-clé..."
              className="pl-9 pr-8"
              data-testid="input-search-conversations"
            />
            {searchQuery && (
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={clearSearch}
                data-testid="button-clear-search"
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
          <Button 
            onClick={handleSearch}
            data-testid="button-search"
          >
            <Search className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Badge
            variant={dateFilter === "all" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setDateFilter("all")}
            data-testid="filter-all"
          >
            Tout
          </Badge>
          <Badge
            variant={dateFilter === "today" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setDateFilter("today")}
            data-testid="filter-today"
          >
            <Calendar className="w-3 h-3 mr-1" />
            Aujourd'hui
          </Badge>
          <Badge
            variant={dateFilter === "week" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setDateFilter("week")}
            data-testid="filter-week"
          >
            <Calendar className="w-3 h-3 mr-1" />
            Cette semaine
          </Badge>
          <Badge
            variant={dateFilter === "month" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setDateFilter("month")}
            data-testid="filter-month"
          >
            <Calendar className="w-3 h-3 mr-1" />
            Ce mois
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {isLoading ? (
            <div className="text-center text-muted-foreground py-8">
              Recherche en cours...
            </div>
          ) : conversations?.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Aucune conversation trouvée
            </div>
          ) : (
            conversations?.map((conv) => (
              <Card
                key={conv.id}
                className={cn(
                  "p-3 cursor-pointer hover-elevate transition-colors",
                  activeConversationId === conv.id && "border-primary bg-primary/5"
                )}
                onClick={() => onSelectConversation(conv.id)}
                data-testid={`conversation-item-${conv.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">
                      {highlightMatch(conv.title, debouncedQuery)}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(conv.createdAt), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
                    </p>
                    {conv.matchedContent && debouncedQuery && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2 italic">
                        "...{highlightMatch(conv.matchedContent, debouncedQuery)}..."
                      </p>
                    )}
                    {!conv.matchedContent && conv.lastMessage && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                        {conv.lastMessage}...
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="secondary">
                      <MessageSquare className="w-3 h-3 mr-1" />
                      {conv.messageCount}
                    </Badge>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => startVoiceReplay(e, conv.id)}
                        disabled={replayingId !== null && replayingId !== conv.id}
                        title={replayingId === conv.id && voiceReplay.state.isPlaying ? "Arrêter la lecture" : "Écouter la conversation"}
                        data-testid={`button-voice-replay-${conv.id}`}
                      >
                        {replayingId === conv.id && voiceReplay.state.isPlaying ? (
                          <Square className="w-3 h-3 text-primary" />
                        ) : (
                          <Volume2 className="w-3 h-3" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => downloadAsText(e, conv.id)}
                        disabled={downloadingId === conv.id}
                        title="Exporter en texte"
                        data-testid={`button-export-text-${conv.id}`}
                      >
                        <FileText className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => downloadAsPDF(e, conv.id)}
                        disabled={downloadingId === conv.id}
                        title="Exporter en PDF"
                        data-testid={`button-export-pdf-${conv.id}`}
                      >
                        <FileType className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
