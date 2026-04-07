import { type Dispatch, type SetStateAction } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Lock, Code, Search, FileCode, Folder,
  ChevronRight, Loader2, Plus, FilePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Repo, TreeItem, FileData } from "./types";

interface SelectedFile extends FileData {
  path: string;
}

interface LibraryTabProps {
  selectedFile: SelectedFile | null;
  setSelectedFile: Dispatch<SetStateAction<SelectedFile | null>>;
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  editCommitMsg: string;
  setEditCommitMsg: (v: string) => void;
  isFileModified: boolean;
  setIsFileModified: (v: boolean) => void;
  currentPath: string;
  setCurrentPath: (v: string) => void;
  fileSearchQuery: string;
  setFileSearchQuery: (v: string) => void;
  fileTree: { tree: TreeItem[]; sha: string; truncated: boolean } | undefined;
  treeLoading: boolean;
  fileLoading: boolean;
  filteredTreeItems: TreeItem[] | null;
  selectedRepo: Repo | null;
  loadFileContent: (path: string) => void;
  getSyntaxLang: (path: string) => string;
  getFileIcon: (name: string) => string;
  createNewFile: () => void;
  showNewFileDialog: boolean;
  setShowNewFileDialog: (v: boolean) => void;
  newFileName: string;
  setNewFileName: (v: string) => void;
  newFileContent: string;
  setNewFileContent: (v: string) => void;
  creatingFile: boolean;
}

export function LibraryTab({
  selectedFile, setSelectedFile,
  editMode, setEditMode, editCommitMsg, setEditCommitMsg,
  isFileModified, setIsFileModified,
  currentPath, setCurrentPath,
  fileSearchQuery, setFileSearchQuery,
  fileTree, treeLoading, fileLoading, filteredTreeItems,
  selectedRepo, loadFileContent, getSyntaxLang, getFileIcon,
  createNewFile, showNewFileDialog, setShowNewFileDialog,
  newFileName, setNewFileName, newFileContent, setNewFileContent,
  creatingFile,
}: LibraryTabProps) {
  if (selectedFile) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                if (editMode && isFileModified) {
                  if (!confirm("Modifications non sauvegardees. Quitter quand meme ?")) return;
                }
                setSelectedFile(null);
                setEditMode(false);
                setEditCommitMsg("");
                setIsFileModified(false);
              }}
              data-testid="button-back-library"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Retour
            </Button>
            <Badge variant="outline" className="text-[10px] h-4 border-green-400 text-green-600">
              <Lock className="w-2.5 h-2.5 mr-0.5" /> prod · lecture seule
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {selectedFile.path}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[9px] h-4">
              {selectedRepo?.default_branch}
            </Badge>
          </div>
        </div>
        <Card className="p-0 overflow-hidden">
          {selectedFile.isImage && selectedFile.rawBase64 ? (
            <div
              className="flex items-center justify-center p-4"
              data-testid="image-file-preview"
            >
              <img
                src={selectedFile.rawBase64}
                alt={selectedFile.path}
                className="max-w-full max-h-[450px] object-contain rounded"
              />
            </div>
          ) : (
            <div>
              <div className="flex border-b bg-muted/30 px-2.5 py-1 items-center gap-2">
                <Code className="w-3 h-3 text-muted-foreground" />
                <span className="text-[11px] font-mono text-muted-foreground">
                  {selectedFile.path}
                </span>
                <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                  {getSyntaxLang(selectedFile.path)}
                </Badge>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {selectedFile.content.split("\n").length}L
                </span>
              </div>
              <div className="flex max-h-[500px] overflow-y-auto">
                <div className="select-none text-right pr-2 pl-2 pt-3 pb-3 bg-muted/20 border-r text-muted-foreground font-mono text-xs leading-[1.35rem] min-w-[2.5rem]" aria-hidden="true">
                  {selectedFile.content.split("\n").map((_: string, i: number) => (
                    <div key={i} className="text-[10px]">{i + 1}</div>
                  ))}
                </div>
                <pre
                  className="flex-1 text-xs font-mono whitespace-pre-wrap overflow-x-auto p-3 leading-[1.35rem]"
                  data-testid="text-file-content"
                >
                  {selectedFile.content}
                </pre>
              </div>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-[11px] text-muted-foreground shrink-0 font-mono">
              {currentPath ? `/${currentPath}` : "/"}
            </span>
            <div className="relative flex-1 max-w-[220px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                placeholder="Rechercher..."
                className="h-7 text-xs pl-7"
                value={fileSearchQuery}
                onChange={(e) => setFileSearchQuery(e.target.value)}
                data-testid="input-search-library"
              />
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] h-5 border-green-400 text-green-600 shrink-0">
            <Lock className="w-2.5 h-2.5 mr-0.5" /> Prod · lecture seule
          </Badge>
        </div>
        {treeLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-3 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
          </div>
        )}
        {fileLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-3 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Lecture...
          </div>
        )}

        {filteredTreeItems ? (
          <div className="space-y-0.5">
            <p className="text-[10px] text-muted-foreground mb-1">
              {filteredTreeItems.length} resultat
              {filteredTreeItems.length > 1 ? "s" : ""}
            </p>
            {filteredTreeItems.map((item) => (
              <div
                key={item.path}
                className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted cursor-pointer text-sm group"
                onClick={() => {
                  loadFileContent(item.path);
                  setFileSearchQuery("");
                }}
                data-testid={`search-result-${item.path.replace(/\//g, "-")}`}
              >
                <FileCode className={cn("w-3 h-3 shrink-0", getFileIcon(item.path.split("/").pop() || item.path))} />
                <span className="font-mono text-xs truncate">
                  {item.path}
                </span>
                {item.size != null && (
                  <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                    {item.size > 1024
                      ? `${(item.size / 1024).toFixed(1)}K`
                      : `${item.size}B`}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            {currentPath && (
              <>
                <div
                  className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted cursor-pointer text-sm text-muted-foreground"
                  onClick={() => {
                    const parts = currentPath.split("/");
                    parts.pop();
                    setCurrentPath(parts.join("/"));
                  }}
                  data-testid="button-folder-up"
                >
                  <ArrowLeft className="w-3 h-3" />
                  <span className="text-xs">.. (remonter)</span>
                </div>
                <div className="flex items-center gap-1 px-2 py-0.5 mb-0.5">
                  <span
                    className="text-[11px] text-primary cursor-pointer hover:underline"
                    onClick={() => setCurrentPath("")}
                  >
                    /
                  </span>
                  {currentPath.split("/").map((part, i, arr) => (
                    <span key={i} className="flex items-center gap-0.5">
                      <ChevronRight className="w-2.5 h-2.5 text-muted-foreground" />
                      <span
                        className={cn(
                          "text-[11px]",
                          i === arr.length - 1
                            ? "font-medium"
                            : "text-primary cursor-pointer hover:underline",
                        )}
                        onClick={() =>
                          i < arr.length - 1 &&
                          setCurrentPath(arr.slice(0, i + 1).join("/"))
                        }
                      >
                        {part}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}

            {(() => {
              if (!fileTree?.tree) return null;

              const foldersInDir = new Set<string>();
              const filesInDir: TreeItem[] = [];
              const prefix = currentPath ? currentPath + "/" : "";

              for (const item of fileTree.tree) {
                if (!item.path.startsWith(prefix) && currentPath)
                  continue;
                if (item.path === currentPath) continue;

                const relativePath = currentPath
                  ? item.path.slice(prefix.length)
                  : item.path;
                if (!relativePath) continue;

                const slashIndex = relativePath.indexOf("/");
                if (slashIndex !== -1) {
                  foldersInDir.add(
                    relativePath.substring(0, slashIndex),
                  );
                } else if (item.type === "blob") {
                  filesInDir.push(item);
                }
              }

              const sortedFolders = Array.from(foldersInDir).sort(
                (a, b) => a.localeCompare(b),
              );
              const sortedFiles = filesInDir.sort((a, b) => {
                const nameA = a.path.split("/").pop() || a.path;
                const nameB = b.path.split("/").pop() || b.path;
                return nameA.localeCompare(nameB);
              });

              return (
                <>
                  {sortedFolders.map((folderName) => (
                    <div
                      key={folderName}
                      className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted cursor-pointer text-sm"
                      onClick={() =>
                        setCurrentPath(prefix + folderName)
                      }
                      data-testid={`folder-${folderName}`}
                    >
                      <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="font-mono text-xs font-medium">
                        {folderName}
                      </span>
                      <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto" />
                    </div>
                  ))}
                  {sortedFiles.map((item) => {
                    const fileName =
                      item.path.split("/").pop() || item.path;
                    return (
                      <div
                        key={item.path}
                        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted cursor-pointer text-sm group"
                        onClick={() => loadFileContent(item.path)}
                        data-testid={`file-${item.path.replace(/\//g, "-")}`}
                      >
                        <FileCode className={cn("w-3.5 h-3.5 shrink-0", getFileIcon(fileName))} />
                        <span className="font-mono text-xs truncate group-hover:text-primary transition-colors">
                          {fileName}
                        </span>
                        {item.size != null && (
                          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                            {item.size > 1024
                              ? `${(item.size / 1024).toFixed(1)}K`
                              : `${item.size}B`}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {sortedFolders.length === 0 &&
                    sortedFiles.length === 0 &&
                    !treeLoading && (
                      <p className="text-muted-foreground text-sm py-2">
                        Dossier vide
                      </p>
                    )}
                </>
              );
            })()}
          </>
        )}

        {!treeLoading && !fileTree?.tree?.length && (
          <p className="text-muted-foreground text-sm">Aucun fichier</p>
        )}
        {fileTree?.truncated && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Arborescence tronquee
          </p>
        )}
      </div>

      <Dialog open={showNewFileDialog} onOpenChange={setShowNewFileDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FilePlus className="w-4 h-4" />
              Nouveau fichier
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Chemin du fichier {currentPath && <span className="font-mono">({currentPath}/)</span>}
              </label>
              <Input
                placeholder="ex: script.js, components/Header.tsx, styles/main.css"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="font-mono text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFileName.trim()) createNewFile();
                }}
                data-testid="input-new-filename"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Inclure un / pour creer dans un sous-dossier
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Contenu (optionnel)
              </label>
              <div className="relative border rounded-md overflow-hidden">
                <div className="flex min-h-[200px] max-h-[350px] overflow-y-auto">
                  <div className="select-none text-right pr-2 pl-2 pt-2 pb-2 bg-muted/20 border-r text-muted-foreground font-mono text-xs leading-[1.35rem] min-w-[2.5rem]" aria-hidden="true">
                    {(newFileContent || "\n").split("\n").map((_: string, i: number) => (
                      <div key={i} className="text-[10px]">{i + 1}</div>
                    ))}
                  </div>
                  <textarea
                    value={newFileContent}
                    onChange={(e) => setNewFileContent(e.target.value)}
                    placeholder="// Votre code ici..."
                    spellCheck={false}
                    className="flex-1 p-2 font-mono text-xs bg-background resize-none focus:outline-none border-0 leading-[1.35rem]"
                    style={{ tabSize: 2 }}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const start = e.currentTarget.selectionStart;
                        const end = e.currentTarget.selectionEnd;
                        const val = newFileContent;
                        setNewFileContent(val.substring(0, start) + "  " + val.substring(end));
                        setTimeout(() => {
                          e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2;
                        }, 0);
                      }
                    }}
                    data-testid="textarea-new-file-content"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNewFileDialog(false)}
                data-testid="button-cancel-new-file"
              >
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={createNewFile}
                disabled={!newFileName.trim() || creatingFile}
                data-testid="button-create-file"
              >
                {creatingFile ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Plus className="w-3 h-3 mr-1" />
                )}
                Creer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
