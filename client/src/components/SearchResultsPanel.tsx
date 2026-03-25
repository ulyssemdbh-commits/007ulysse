import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Image as ImageIcon, Globe, Shield, ChevronDown, ChevronUp, Search, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  reliability?: number;
  imageUrl?: string;
  publishedDate?: string;
}

export interface SearchFact {
  content: string;
  type: "statistic" | "date" | "name" | "event" | "claim" | "definition";
  confidence: "verified" | "probable" | "unverified" | "disputed";
  sources: string[];
}

export interface MARSResultsData {
  query: string;
  sources: SearchSource[];
  facts: SearchFact[];
  summary: string;
  overallConfidence: number;
  warnings?: string[];
  searchTime?: number;
}

interface SearchResultsCardProps {
  result: SearchSource;
  index: number;
  onImageClick?: (url: string, title: string) => void;
}

function SearchResultCard({ result, index, onImageClick }: SearchResultsCardProps) {
  const [imageError, setImageError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const reliabilityColor = useMemo(() => {
    if (!result.reliability) return "bg-muted";
    if (result.reliability >= 70) return "bg-green-500/20 text-green-400";
    if (result.reliability >= 40) return "bg-yellow-500/20 text-yellow-400";
    return "bg-red-500/20 text-red-400";
  }, [result.reliability]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="bg-card/60 border-border/30 hover-elevate">
        <CardContent className="p-3">
          <div className="flex gap-3">
            {result.imageUrl && !imageError && (
              <div 
                className="shrink-0 w-20 h-20 rounded-md overflow-hidden bg-muted cursor-pointer"
                onClick={() => onImageClick?.(result.imageUrl!, result.title)}
              >
                <img
                  src={result.imageUrl}
                  alt={result.title}
                  className="w-full h-full object-cover"
                  onError={() => setImageError(true)}
                  loading="lazy"
                />
              </div>
            )}
            
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <a 
                  href={result.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="font-medium text-sm text-foreground hover:text-primary transition-colors line-clamp-2"
                  data-testid={`link-search-result-${index}`}
                >
                  {result.title}
                </a>
                <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              </div>
              
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  {result.domain}
                </span>
                {result.reliability !== undefined && (
                  <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", reliabilityColor)}>
                    <Shield className="w-2.5 h-2.5 mr-0.5" />
                    {result.reliability}%
                  </Badge>
                )}
                {result.publishedDate && (
                  <span className="text-[10px] text-muted-foreground">
                    {result.publishedDate}
                  </span>
                )}
              </div>
              
              <Collapsible open={expanded} onOpenChange={setExpanded}>
                <p className={cn("text-xs text-muted-foreground mt-1.5", !expanded && "line-clamp-2")}>
                  {result.snippet}
                </p>
                {result.snippet.length > 150 && (
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-5 px-1 mt-1 text-[10px]">
                      {expanded ? (
                        <><ChevronUp className="w-3 h-3 mr-0.5" /> Moins</>
                      ) : (
                        <><ChevronDown className="w-3 h-3 mr-0.5" /> Plus</>
                      )}
                    </Button>
                  </CollapsibleTrigger>
                )}
              </Collapsible>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function FactCard({ fact, index }: { fact: SearchFact; index: number }) {
  const confidenceIcon = useMemo(() => {
    switch (fact.confidence) {
      case "verified":
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
      case "probable":
        return <Info className="w-3.5 h-3.5 text-blue-400" />;
      case "disputed":
        return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
      default:
        return <Info className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  }, [fact.confidence]);

  const typeLabel = useMemo(() => {
    const labels: Record<string, string> = {
      statistic: "Statistique",
      date: "Date",
      name: "Nom",
      event: "Événement",
      claim: "Affirmation",
      definition: "Définition"
    };
    return labels[fact.type] || fact.type;
  }, [fact.type]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className="flex items-start gap-2 p-2 rounded-md bg-muted/30"
    >
      {confidenceIcon}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{fact.content}</p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {typeLabel}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {fact.sources.length} source{fact.sources.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

interface SearchResultsPanelProps {
  data: MARSResultsData;
  onImageClick?: (url: string, title: string) => void;
  className?: string;
}

export function SearchResultsPanel({ data, onImageClick, className }: SearchResultsPanelProps) {
  const [showFacts, setShowFacts] = useState(true);
  const [showSources, setShowSources] = useState(true);

  const confidence = data.overallConfidence ?? 0;
  
  const confidenceColor = useMemo(() => {
    if (confidence >= 70) return "text-green-400";
    if (confidence >= 40) return "text-yellow-400";
    return "text-red-400";
  }, [confidence]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">Résultats MARS</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={cn("text-xs", confidenceColor)}>
              Confiance: {confidence}%
            </Badge>
            {data.searchTime && (
              <span className="text-xs text-muted-foreground">
                {(data.searchTime / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
          "{data.query}"
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {data.summary && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-sm text-foreground">{data.summary}</p>
            </div>
          )}

          {data.warnings && data.warnings.length > 0 && (
            <div className="space-y-1">
              {data.warnings.map((warning, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-yellow-500/10 text-yellow-400 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {warning}
                </div>
              ))}
            </div>
          )}

          {data.facts && data.facts.length > 0 && (
            <Collapsible open={showFacts} onOpenChange={setShowFacts}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between h-8 px-2">
                  <span className="text-sm font-medium">
                    Faits extraits ({data.facts.length})
                  </span>
                  {showFacts ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-2 mt-2">
                  {data.facts.map((fact, i) => (
                    <FactCard key={i} fact={fact} index={i} />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {data.sources && data.sources.length > 0 && (
            <Collapsible open={showSources} onOpenChange={setShowSources}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between h-8 px-2">
                  <span className="text-sm font-medium">
                    Sources ({data.sources.length})
                  </span>
                  {showSources ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-2 mt-2">
                  {data.sources.map((source, i) => (
                    <SearchResultCard 
                      key={i} 
                      result={source} 
                      index={i} 
                      onImageClick={onImageClick}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function parseSearchResultsFromResponse(response: string): MARSResultsData | null {
  try {
    const marsMatch = response.match(/\[MARS_RESULTS\]([\s\S]*?)\[\/MARS_RESULTS\]/);
    if (marsMatch) {
      return JSON.parse(marsMatch[1]);
    }
    
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.sources || parsed.facts || parsed.query) {
        return parsed as MARSResultsData;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}
