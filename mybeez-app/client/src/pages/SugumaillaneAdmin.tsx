import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, ChefHat, ArrowLeft, Check, X, Languages } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

interface SugumaillaneItem {
  id: number;
  categoryId: number;
  name: string;
  nameVi: string | null;
  nameTh: string | null;
  sortOrder: number;
  isActive: boolean;
}

interface SugumaillaneCategory {
  id: number;
  name: string;
  nameVi: string | null;
  nameTh: string | null;
  sortOrder: number;
  items: SugumaillaneItem[];
}

type SaveStatus = "saving" | "saved" | "error" | undefined;

export default function SugumaillaneAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [editValues, setEditValues] = useState({ nameVi: "", nameTh: "" });
  const [saveStatus, setSaveStatus] = useState<Record<number, SaveStatus>>({});
  const [isTranslating, setIsTranslating] = useState<{ vi: boolean; th: boolean }>({ vi: false, th: false });

  const { data: categories, isLoading } = useQuery<SugumaillaneCategory[]>({
    queryKey: ["/api/sugumaillane/categories"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ itemId, nameVi, nameTh }: { itemId: number; nameVi: string; nameTh: string }) => {
      const response = await fetch(`/api/sugumaillane/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ nameVi: nameVi || null, nameTh: nameTh || null }),
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) throw new Error("Update failed");
      return response.json();
    },
    onMutate: ({ itemId }) => {
      setSaveStatus(prev => ({ ...prev, [itemId]: "saving" }));
    },
    onSuccess: (_, { itemId }) => {
      setSaveStatus(prev => ({ ...prev, [itemId]: "saved" }));
      queryClient.invalidateQueries({ queryKey: ["/api/sugumaillane/categories"] });
      setEditingItem(null);
      setTimeout(() => {
        setSaveStatus(prev => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      }, 2000);
    },
    onError: (_, { itemId }) => {
      setSaveStatus(prev => ({ ...prev, [itemId]: "error" }));
      toast({ title: "Erreur de sauvegarde", variant: "destructive" });
    }
  });

  const startEdit = (item: SugumaillaneItem) => {
    setEditingItem(item.id);
    setEditValues({ nameVi: item.nameVi || "", nameTh: item.nameTh || "" });
  };

  const saveEdit = (itemId: number) => {
    updateMutation.mutate({ itemId, ...editValues });
  };

  const cancelEdit = () => {
    setEditingItem(null);
    setEditValues({ nameVi: "", nameTh: "" });
  };

  const autoTranslate = async (itemName: string, targetLanguage: "vi" | "th") => {
    if (!itemName) return;
    setIsTranslating(prev => ({ ...prev, [targetLanguage]: true }));
    try {
      const response = await fetch("/api/suguval/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: itemName, targetLanguage })
      });
      if (response.ok) {
        const { translation } = await response.json();
        setEditValues(prev => ({
          ...prev,
          [targetLanguage === "vi" ? "nameVi" : "nameTh"]: translation
        }));
      } else {
        toast({ title: "Erreur de traduction", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setIsTranslating(prev => ({ ...prev, [targetLanguage]: false }));
    }
  };

  const totalItems = categories?.reduce((sum, cat) => sum + cat.items.length, 0) || 0;
  const translatedVi = categories?.reduce((sum, cat) =>
    sum + cat.items.filter(i => i.nameVi).length, 0) || 0;
  const translatedTh = categories?.reduce((sum, cat) =>
    sum + cat.items.filter(i => i.nameTh).length, 0) || 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-emerald-50 dark:from-zinc-900 dark:to-zinc-800 flex items-center justify-center" role="status">
        <Loader2 className="h-12 w-12 animate-spin text-green-500" aria-hidden="true" />
        <span className="sr-only">Chargement des traductions</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-emerald-50 dark:from-zinc-900 dark:to-zinc-800">
      <header className="sticky top-0 z-50 bg-green-700 dark:bg-green-800 text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/sugumaillane">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" aria-label="Retour a la checklist" data-testid="button-back">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <ChefHat className="h-8 w-8" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-bold">SUGU Maillane — Traductions</h1>
              <p className="text-green-100 text-sm">
                {translatedVi}/{totalItems} VI · {translatedTh}/{totalItems} TH
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold">{totalItems}</div>
              <div className="text-xs text-muted-foreground mt-1">Articles</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">{translatedVi}</div>
              <div className="text-xs text-muted-foreground mt-1">🇻🇳 Traduits</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-pink-600">{translatedTh}</div>
              <div className="text-xs text-muted-foreground mt-1">🇹🇭 Traduits</div>
            </CardContent>
          </Card>
        </div>

        {categories?.map((category) => (
          <Card key={category.id}>
            <CardHeader className="py-3 bg-green-600 dark:bg-green-700 text-white rounded-t-lg">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{category.name}</span>
                <Badge variant="secondary" className="bg-white/20 text-white border-0 text-xs">
                  {category.items.length} articles
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {category.items.map((item) => {
                const isEditing = editingItem === item.id;
                const status = saveStatus[item.id];
                const missingVi = !item.nameVi;
                const missingTh = !item.nameTh;

                return (
                  <div
                    key={item.id}
                    className={`px-4 py-3 border-b last:border-b-0 ${isEditing ? "bg-green-50 dark:bg-green-900/20" : ""}`}
                    data-testid={`item-row-${item.id}`}
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="font-medium text-sm">{item.name}</div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-6">🇻🇳</span>
                          <Input
                            value={editValues.nameVi}
                            onChange={(e) => setEditValues(prev => ({ ...prev, nameVi: e.target.value }))}
                            placeholder="Tiếng Việt..."
                            className="h-8 text-sm flex-1"
                            data-testid={`input-namevi-${item.id}`}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => autoTranslate(item.name, "vi")}
                            disabled={isTranslating.vi}
                            aria-label="Traduire en vietnamien"
                          >
                            {isTranslating.vi ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Languages className="h-3 w-3" aria-hidden="true" />}
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-6">🇹🇭</span>
                          <Input
                            value={editValues.nameTh}
                            onChange={(e) => setEditValues(prev => ({ ...prev, nameTh: e.target.value }))}
                            placeholder="ภาษาไทย..."
                            className="h-8 text-sm flex-1"
                            data-testid={`input-nameth-${item.id}`}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => autoTranslate(item.name, "th")}
                            disabled={isTranslating.th}
                            aria-label="Traduire en thailandais"
                          >
                            {isTranslating.th ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Languages className="h-3 w-3" aria-hidden="true" />}
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-8 bg-green-600 hover:bg-green-700"
                            onClick={() => saveEdit(item.id)}
                            disabled={status === "saving"}
                            data-testid={`button-save-${item.id}`}
                          >
                            {status === "saving" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                            Enregistrer
                          </Button>
                          <Button size="sm" variant="outline" className="h-8" onClick={cancelEdit} data-testid={`button-cancel-${item.id}`}>
                            <X className="h-3 w-3 mr-1" />
                            Annuler
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 rounded px-1 -mx-1"
                        onClick={() => startEdit(item)}
                        data-testid={`button-edit-${item.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{item.name}</div>
                          <div className="flex gap-3 mt-0.5">
                            <span className={`text-xs truncate ${item.nameVi ? "text-muted-foreground" : "text-red-400"}`}>
                              🇻🇳 {item.nameVi || "—"}
                            </span>
                            <span className={`text-xs truncate ${item.nameTh ? "text-muted-foreground" : "text-red-400"}`}>
                              🇹🇭 {item.nameTh || "—"}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          {status === "saved" && <Check className="h-4 w-4 text-green-500" />}
                          {(missingVi || missingTh) && (
                            <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">
                              {[missingVi && "VI", missingTh && "TH"].filter(Boolean).join("+")}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
