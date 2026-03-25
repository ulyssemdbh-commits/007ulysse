import { PageContainer } from "@/components/layout/PageContainer";
import { useNotes, useCreateNote, useDeleteNote, useUpdateNote } from "@/hooks/use-notes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Save, Trash2, FileText } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export default function Notes() {
  const { toast } = useToast();
  const { data: notes, isLoading } = useNotes();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // When note selection changes, load data
  useEffect(() => {
    if (selectedNoteId && notes) {
      const note = notes.find(n => n.id === selectedNoteId);
      if (note) {
        setTitle(note.title);
        setContent(note.content);
        setIsDirty(false);
      }
    } else {
      setTitle("");
      setContent("");
      setIsDirty(false);
    }
  }, [selectedNoteId, notes]);

  const handleCreate = () => {
    createNote.mutate({
      title: "Untitled Note",
      content: "# New Note\n\nStart writing...",
    }, {
      onSuccess: (newNote) => {
        setSelectedNoteId(newNote.id);
      }
    });
  };

  const handleSave = () => {
    if (!selectedNoteId) return;
    updateNote.mutate({ id: selectedNoteId, title, content }, {
      onSuccess: () => setIsDirty(false),
      onError: () => toast({ title: "Erreur", description: "La note n'a pas pu être sauvegardée", variant: "destructive" }),
    });
  };

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete this note?")) {
      deleteNote.mutate(id, {
        onSuccess: () => {
          if (selectedNoteId === id) setSelectedNoteId(null);
        }
      });
    }
  };

  return (
    <PageContainer title="Notes" action={
      <Button onClick={handleCreate} disabled={createNote.isPending}>
        <Plus className="mr-2 h-4 w-4" /> New Note
      </Button>
    }>
      <div className="grid md:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
        {/* Sidebar List */}
        <Card className="col-span-1 bg-card border-border flex flex-col overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {isLoading ? (
                <div className="text-center p-4 text-muted-foreground">Loading notes...</div>
              ) : notes?.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground">No notes yet.</div>
              ) : (
                notes?.map((note) => (
                  <div
                    key={note.id}
                    onClick={() => setSelectedNoteId(note.id)}
                    className={cn(
                      "p-3 rounded-lg cursor-pointer transition-all border group relative",
                      selectedNoteId === note.id
                        ? "bg-primary/10 border-primary/50 text-foreground"
                        : "bg-secondary/30 border-transparent hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="w-4 h-4 shrink-0" />
                      <span className="font-medium truncate">{note.title}</span>
                    </div>
                    <div className="text-xs opacity-70 truncate pl-6">
                      {format(new Date(note.createdAt || new Date()), 'MMM d, h:mm a')}
                    </div>
                    <button 
                      onClick={(e) => handleDelete(note.id, e)}
                      className="absolute right-2 top-3 opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Editor Area */}
        <Card className="col-span-2 bg-card border-border flex flex-col overflow-hidden relative">
          {selectedNoteId ? (
            <>
              <div className="p-4 border-b border-border flex items-center gap-4">
                <Input 
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); setIsDirty(true); }}
                  className="text-lg font-bold bg-transparent border-none focus-visible:ring-0 px-0"
                  placeholder="Note Title"
                />
                <div className="flex items-center gap-2">
                  <div className="flex bg-secondary rounded-lg p-1">
                    <button 
                      onClick={() => setEditorMode("edit")}
                      className={cn("px-3 py-1 rounded text-sm transition-colors", editorMode === "edit" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => setEditorMode("preview")}
                      className={cn("px-3 py-1 rounded text-sm transition-colors", editorMode === "preview" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                    >
                      Preview
                    </button>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={handleSave} 
                    disabled={!isDirty || updateNote.isPending}
                    className={cn(isDirty && "animate-pulse")}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save
                  </Button>
                </div>
              </div>
              
              <div className="flex-1 overflow-hidden relative">
                {editorMode === "edit" ? (
                  <Textarea
                    value={content}
                    onChange={(e) => { setContent(e.target.value); setIsDirty(true); }}
                    className="w-full h-full resize-none p-6 border-none focus-visible:ring-0 bg-transparent font-mono text-sm leading-relaxed"
                    placeholder="Start typing your note (Markdown supported)..."
                  />
                ) : (
                  <ScrollArea className="h-full p-6">
                    <div className="prose prose-invert max-w-none [&_*]:text-white [&_a]:text-blue-400 [&_a]:underline [&_p]:text-white [&_li]:text-white">
                      <ReactMarkdown>{content}</ReactMarkdown>
                    </div>
                  </ScrollArea>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <FileText className="w-16 h-16 mb-4 opacity-20" />
              <p>Select a note to view or edit</p>
            </div>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
