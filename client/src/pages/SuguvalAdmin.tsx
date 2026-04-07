import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, ChefHat, ArrowLeft, RefreshCw, GripVertical, Languages, Plus, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { usePageManifest } from "@/hooks/usePageManifest";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

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
  items: SuguvalItem[];
}

function SortableItem({ 
  item, 
  categoryId,
  isEditing, 
  onStartEdit, 
  onSave,
  onCancel,
  onDelete,
  editValues,
  setEditValues,
  saveStatus,
  categories,
  onTranslate,
  isTranslating
}: { 
  item: SuguvalItem;
  categoryId: number;
  isEditing: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  editValues: { name: string; nameVi: string; nameTh: string; categoryId: number };
  setEditValues: (fn: (prev: any) => any) => void;
  saveStatus: "saving" | "saved" | "error" | undefined;
  categories: SuguvalCategory[];
  onTranslate: (targetLanguage: "vi" | "th") => Promise<void>;
  isTranslating: { vi: boolean; th: boolean };
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="overflow-hidden">
        <CardContent className="p-3">
          {isEditing ? (
            <div className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">🇫🇷 Francais</label>
                <Input
                  value={editValues.name}
                  onChange={(e) => setEditValues((prev: any) => ({ ...prev, name: e.target.value }))}
                  placeholder="Nom de l'article..."
                  data-testid={`input-name-${item.id}`}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Categorie</label>
                <Select
                  value={editValues.categoryId.toString()}
                  onValueChange={(value) => setEditValues((prev: any) => ({ ...prev, categoryId: parseInt(value) }))}
                >
                  <SelectTrigger className="w-full" data-testid={`select-category-${item.id}`}>
                    <SelectValue placeholder="Choisir une categorie" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories?.map(cat => (
                      <SelectItem key={cat.id} value={cat.id.toString()}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">🇻🇳 Vietnamien</label>
                  <div className="flex gap-2">
                    <Input
                      value={editValues.nameVi}
                      onChange={(e) => setEditValues((prev: any) => ({ ...prev, nameVi: e.target.value }))}
                      placeholder="Traduction vietnamienne..."
                      data-testid={`input-vi-${item.id}`}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onTranslate("vi")}
                      disabled={isTranslating.vi || !editValues.name}
                      title="Traduire automatiquement"
                      data-testid={`translate-vi-${item.id}`}
                    >
                      {isTranslating.vi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">🇹🇭 Thailandais</label>
                  <div className="flex gap-2">
                    <Input
                      value={editValues.nameTh}
                      onChange={(e) => setEditValues((prev: any) => ({ ...prev, nameTh: e.target.value }))}
                      placeholder="Traduction thailandaise..."
                      data-testid={`input-th-${item.id}`}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onTranslate("th")}
                      disabled={isTranslating.th || !editValues.name}
                      title="Traduire automatiquement"
                      data-testid={`translate-th-${item.id}`}
                    >
                      {isTranslating.th ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={onSave} 
                  disabled={saveStatus === "saving"}
                  data-testid={`save-${item.id}`}
                >
                  {saveStatus === "saving" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Enregistrer
                </Button>
                <Button variant="outline" onClick={onCancel}>
                  Annuler
                </Button>
                <Button 
                  variant="destructive" 
                  size="icon"
                  onClick={onDelete}
                  title="Supprimer l'article"
                  data-testid={`delete-${item.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded touch-none"
                data-testid={`drag-handle-${item.id}`}
              >
                <GripVertical className="h-5 w-5 text-muted-foreground" />
              </div>
              <div 
                className="flex-1 flex items-center gap-3 cursor-pointer hover:bg-muted/50 p-2 rounded transition-colors"
                onClick={onStartEdit}
                data-testid={`edit-item-${item.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">🇫🇷 {item.name}</div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                    <span>🇻🇳 {item.nameVi || <span className="italic opacity-50">--</span>}</span>
                    <span>🇹🇭 {item.nameTh || <span className="italic opacity-50">--</span>}</span>
                  </div>
                </div>
                {saveStatus === "saved" && (
                  <Badge className="bg-green-500 text-xs">OK</Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SuguvalAdmin() {
  usePageManifest({
    title: "Admin SUGUVal",
    manifestPath: "/manifest-suguval-edit.json",
    themeColor: "#b45309",
    appleTitle: "Admin"
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{ name: string; nameVi: string; nameTh: string; categoryId: number }>({ name: "", nameVi: "", nameTh: "", categoryId: 0 });
  const [saveStatus, setSaveStatus] = useState<Record<number, "saving" | "saved" | "error">>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTranslating, setIsTranslating] = useState<{ vi: boolean; th: boolean }>({ vi: false, th: false });
  
  // New category/item creation state
  const [showNewCategoryDialog, setShowNewCategoryDialog] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategorySheet, setNewCategorySheet] = useState<"Feuil1" | "Feuil2">("Feuil1");
  const [showNewItemDialog, setShowNewItemDialog] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategoryId, setNewItemCategoryId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const { data: categories, isLoading } = useQuery<SuguvalCategory[]>({
    queryKey: ["/api/suguval/categories"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ itemId, name, nameVi, nameTh, categoryId }: { itemId: number; name: string; nameVi: string; nameTh: string; categoryId: number }) => {
      const response = await fetch(`/api/suguval/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ name, nameVi: nameVi || null, nameTh: nameTh || null, categoryId }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/categories"] });
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
    }
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ categoryId, orderedIds }: { categoryId: number; orderedIds: number[] }) => {
      const response = await fetch("/api/suguval/items/reorder", {
        method: "POST",
        body: JSON.stringify({ categoryId, orderedIds }),
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) throw new Error("Reorder failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/categories"] });
    }
  });

  const createCategoryMutation = useMutation({
    mutationFn: async ({ name, sheet }: { name: string; sheet: "Feuil1" | "Feuil2" }) => {
      const response = await fetch("/api/suguval/categories", {
        method: "POST",
        body: JSON.stringify({ name, sheet }),
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) throw new Error("Create failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/categories"] });
      setShowNewCategoryDialog(false);
      setNewCategoryName("");
      toast({ title: "Categorie creee" });
    }
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (categoryId: number) => {
      const response = await fetch(`/api/suguval/categories/${categoryId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/categories"] });
      toast({ title: "Categorie supprimee" });
    }
  });

  const createItemMutation = useMutation({
    mutationFn: async ({ name, categoryId }: { name: string; categoryId: number }) => {
      const response = await fetch("/api/suguval/items", {
        method: "POST",
        body: JSON.stringify({ name, categoryId }),
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) throw new Error("Create failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/categories"] });
      setShowNewItemDialog(false);
      setNewItemName("");
      setNewItemCategoryId(null);
      toast({ title: "Article cree" });
    }
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const response = await fetch(`/api/suguval/items/${itemId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suguval/categories"] });
      toast({ title: "Article supprime" });
    }
  });

  const startEdit = (item: SuguvalItem, categoryId: number) => {
    setEditingItem(item.id);
    setEditValues({ name: item.name, nameVi: item.nameVi || "", nameTh: item.nameTh || "", categoryId });
  };

  const saveEdit = (itemId: number) => {
    updateMutation.mutate({ itemId, ...editValues });
  };

  const cancelEdit = () => {
    setEditingItem(null);
    setEditValues({ name: "", nameVi: "", nameTh: "", categoryId: 0 });
  };

  const translateName = async (targetLanguage: "vi" | "th") => {
    if (!editValues.name) return;
    
    setIsTranslating(prev => ({ ...prev, [targetLanguage]: true }));
    try {
      const response = await fetch("/api/suguval/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editValues.name, targetLanguage })
      });
      
      if (response.ok) {
        const { translation } = await response.json();
        if (targetLanguage === "vi") {
          setEditValues(prev => ({ ...prev, nameVi: translation }));
        } else {
          setEditValues(prev => ({ ...prev, nameTh: translation }));
        }
      } else {
        toast({
          title: "Erreur de traduction",
          description: "Impossible de traduire le texte",
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Erreur de connexion",
        variant: "destructive"
      });
    } finally {
      setIsTranslating(prev => ({ ...prev, [targetLanguage]: false }));
    }
  };

  const handleDragEnd = (event: DragEndEvent, category: SuguvalCategory) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      const oldIndex = category.items.findIndex(item => item.id === active.id);
      const newIndex = category.items.findIndex(item => item.id === over.id);
      
      const newItems = arrayMove(category.items, oldIndex, newIndex);
      const orderedIds = newItems.map(item => item.id);
      
      reorderMutation.mutate({ categoryId: category.id, orderedIds });
    }
  };

  const syncToMaillane = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch("/api/suguval/sync-to-maillane", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const result = await response.json();
      if (result.success) {
        toast({
          title: "Synchronisation reussie",
          description: `${result.categoriesSync} categories et ${result.itemsSync} articles synchronises vers SUGU Maillane`,
        });
      } else {
        toast({
          title: "Erreur de synchronisation",
          description: result.message,
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Impossible de synchroniser le catalogue",
        variant: "destructive"
      });
    } finally {
      setIsSyncing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-orange-50 to-amber-50 dark:from-zinc-900 dark:to-zinc-800 flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-amber-50 dark:from-zinc-900 dark:to-zinc-800">
      <header className="sticky top-0 z-50 bg-orange-600 dark:bg-orange-700 text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/courses/suguval">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <ChefHat className="h-8 w-8" />
            <div>
              <h1 className="text-xl font-bold">SUGU Valentine - Edition</h1>
              <p className="text-orange-100 text-sm">Maintenir pour deplacer</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <Card className="mb-4">
          <CardHeader className="py-3 bg-blue-50 dark:bg-blue-900/20">
            <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
              <span>🇫🇷 Francais | 🇻🇳 Vietnamien | 🇹🇭 Thailandais</span>
              <Button
                onClick={syncToMaillane}
                disabled={isSyncing}
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                data-testid="button-sync-maillane"
              >
                {isSyncing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Sync Maillane
              </Button>
            </CardTitle>
          </CardHeader>
        </Card>

        {/* Add category/item buttons */}
        <div className="flex gap-2 mb-4">
          <Button 
            onClick={() => setShowNewCategoryDialog(true)} 
            size="sm"
            data-testid="button-add-category"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle categorie
          </Button>
          <Button 
            onClick={() => {
              if (categories && categories.length > 0) {
                setNewItemCategoryId(categories[0].id);
                setShowNewItemDialog(true);
              }
            }} 
            size="sm"
            variant="outline"
            disabled={!categories || categories.length === 0}
            data-testid="button-add-item"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouvel article
          </Button>
        </div>

        <div className="space-y-6">
          {categories?.map(category => (
            <div key={category.id}>
              <div className="flex items-center justify-between mb-2 px-1">
                <h2 className="font-bold text-orange-700 dark:text-orange-400">{category.name}</h2>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setNewItemCategoryId(category.id);
                      setShowNewItemDialog(true);
                    }}
                    title="Ajouter un article"
                    data-testid={`add-item-${category.id}`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => {
                      if (confirm(`Supprimer la categorie "${category.name}" et tous ses articles ?`)) {
                        deleteCategoryMutation.mutate(category.id);
                      }
                    }}
                    title="Supprimer la categorie"
                    data-testid={`delete-category-${category.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => handleDragEnd(event, category)}
              >
                <SortableContext
                  items={category.items.map(item => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1">
                    {category.items.map((item) => (
                      <SortableItem
                        key={item.id}
                        item={item}
                        categoryId={category.id}
                        isEditing={editingItem === item.id}
                        onStartEdit={() => startEdit(item, category.id)}
                        onTranslate={translateName}
                        isTranslating={isTranslating}
                        onSave={() => saveEdit(item.id)}
                        onCancel={cancelEdit}
                        onDelete={() => deleteItemMutation.mutate(item.id)}
                        editValues={editValues}
                        setEditValues={setEditValues}
                        saveStatus={saveStatus[item.id]}
                        categories={categories}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          ))}
        </div>
      </main>

      {/* New Category Dialog */}
      <Dialog open={showNewCategoryDialog} onOpenChange={setShowNewCategoryDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nouvelle categorie</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Nom de la categorie"
              data-testid="input-new-category-name"
            />
            <Select
              value={newCategorySheet}
              onValueChange={(v) => setNewCategorySheet(v as "Feuil1" | "Feuil2")}
            >
              <SelectTrigger data-testid="select-category-sheet">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Feuil1">Reserve & Livraison</SelectItem>
                <SelectItem value="Feuil2">Cuisine & Frais</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCategoryDialog(false)}>
              Annuler
            </Button>
            <Button 
              onClick={() => createCategoryMutation.mutate({ name: newCategoryName, sheet: newCategorySheet })}
              disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
              data-testid="button-create-category"
            >
              {createCategoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Creer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Item Dialog */}
      <Dialog open={showNewItemDialog} onOpenChange={setShowNewItemDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nouvel article</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Nom de l'article (francais)"
              data-testid="input-new-item-name"
            />
            <Select
              value={newItemCategoryId?.toString() || ""}
              onValueChange={(v) => setNewItemCategoryId(parseInt(v))}
            >
              <SelectTrigger data-testid="select-item-category">
                <SelectValue placeholder="Choisir une categorie" />
              </SelectTrigger>
              <SelectContent>
                {categories?.map(cat => (
                  <SelectItem key={cat.id} value={cat.id.toString()}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewItemDialog(false)}>
              Annuler
            </Button>
            <Button 
              onClick={() => newItemCategoryId && createItemMutation.mutate({ name: newItemName, categoryId: newItemCategoryId })}
              disabled={!newItemName.trim() || !newItemCategoryId || createItemMutation.isPending}
              data-testid="button-create-item"
            >
              {createItemMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Creer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
