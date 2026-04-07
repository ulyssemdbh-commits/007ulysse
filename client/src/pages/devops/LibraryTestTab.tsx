import { type Dispatch, type SetStateAction, type RefObject } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Code, Search, File, Folder,
  ChevronRight, Loader2, Pencil, Save, X,
  FlaskConical, Rocket, CheckCircle,
} from "lucide-react";
import type { TreeItem, FileData } from "./types";

interface StagingFileData extends FileData {
  path: string;
}

interface LibraryTestTabProps {
  hasStagingBranch: boolean;
  stagingFile: StagingFileData | null;
  setStagingFile: Dispatch<SetStateAction<StagingFileData | null>>;
  stagingPath: string;
  setStagingPath: (v: string) => void;
  stagingSearch: string;
  setStagingSearch: (v: string) => void;
  stagingFileLoading: boolean;
  stagingEditMode: boolean;
  setStagingEditMode: (v: boolean) => void;
  stagingEditContent: string;
  setStagingEditContent: (v: string) => void;
  stagingEditMsg: string;
  setStagingEditMsg: (v: string) => void;
  stagingSaving: boolean;
  stagingModified: boolean;
  setStagingModified: (v: boolean) => void;
  stagingDeploying: boolean;
  stagingDeployStatus: string | null;
  stagingOriginalRef: RefObject<string>;
  stagingEditRef: RefObject<HTMLTextAreaElement>;
  stagingTree: { tree: TreeItem[]; sha: string; truncated: boolean } | undefined;
  stagingTreeLoading: boolean;
  loadStagingFile: (path: string) => void;
  saveStagingFile: () => void;
  deployStagingToProd: () => void;
  getSyntaxLang: (path: string) => string;
}

export function LibraryTestTab({
  hasStagingBranch,
  stagingFile, setStagingFile,
  stagingPath, setStagingPath,
  stagingSearch, setStagingSearch,
  stagingFileLoading,
  stagingEditMode, setStagingEditMode,
  stagingEditContent, setStagingEditContent,
  stagingEditMsg, setStagingEditMsg,
  stagingSaving,
  stagingModified, setStagingModified,
  stagingDeploying, stagingDeployStatus,
  stagingOriginalRef, stagingEditRef,
  stagingTree, stagingTreeLoading,
  loadStagingFile, saveStagingFile, deployStagingToProd,
  getSyntaxLang,
}: LibraryTestTabProps) {
  if (!hasStagingBranch) {
    return (
      <Card className="p-6 text-center">
        <FlaskConical className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-3">
          Ce repo n'a pas de branche <code className="font-mono bg-muted px-1 rounded">staging</code>.
        </p>
        <p className="text-xs text-muted-foreground">
          Créez-la depuis l'onglet Branches pour activer la Librairie-Test.
        </p>
      </Card>
    );
  }

  if (stagingFile) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                if (stagingEditMode && stagingModified) {
                  if (!confirm("Modifications non sauvegardées. Quitter quand même ?")) return;
                }
                setStagingFile(null);
                setStagingEditMode(false);
                setStagingEditMsg("");
                setStagingModified(false);
              }}
              data-testid="button-back-staging"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Retour
            </Button>
            <Badge variant="outline" className="text-[10px] h-4 border-amber-400 text-amber-600">
              staging
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {stagingFile.path}
            </span>
            {stagingEditMode && (
              <Badge variant="secondary" className="text-[10px] h-4">
                Édition
              </Badge>
            )}
            {stagingEditMode && stagingModified && (
              <Badge variant="outline" className="text-[10px] h-4 border-orange-400 text-orange-500">
                Modifié
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {!stagingFile.isImage &&
              !stagingFile.content.startsWith("[Fichier binaire") &&
              (stagingEditMode ? (
                <>
                  <Input
                    placeholder="Commit msg..."
                    value={stagingEditMsg}
                    onChange={(e) => setStagingEditMsg(e.target.value)}
                    className="h-7 text-xs w-36"
                    data-testid="input-staging-commit-msg"
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={saveStagingFile}
                    disabled={stagingSaving}
                    data-testid="button-save-staging"
                  >
                    {stagingSaving ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <Save className="w-3 h-3 mr-1" />
                    )}
                    Commit staging
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => setStagingEditMode(false)}
                    data-testid="button-cancel-staging-edit"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    setStagingEditMode(true);
                    setStagingEditContent(stagingFile.content);
                    stagingOriginalRef.current = stagingFile.content;
                    setStagingModified(false);
                    setStagingEditMsg("");
                  }}
                  data-testid="button-edit-staging"
                >
                  <Pencil className="w-3 h-3 mr-1" /> Modifier
                </Button>
              ))}
          </div>
        </div>
        <Card className="p-0 overflow-hidden">
          {stagingFile.isImage && stagingFile.rawBase64 ? (
            <div className="flex items-center justify-center p-4" data-testid="staging-image-preview">
              <img
                src={stagingFile.rawBase64}
                alt={stagingFile.path}
                className="max-w-full max-h-[450px] object-contain rounded"
              />
            </div>
          ) : stagingEditMode ? (
            <div className="relative" data-testid="staging-code-editor">
              <div className="flex border-b bg-muted/30 px-2.5 py-1 items-center gap-2">
                <Code className="w-3 h-3 text-muted-foreground" />
                <span className="text-[11px] font-mono text-muted-foreground">{stagingFile.path}</span>
                <Badge variant="outline" className="text-[9px] h-3.5 px-1">{getSyntaxLang(stagingFile.path)}</Badge>
                <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-amber-400 text-amber-600">staging</Badge>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {stagingEditContent.split("\n").length}L · Ctrl+S save
                </span>
              </div>
              <div className="flex min-h-[450px] max-h-[600px] overflow-y-auto">
                <div className="select-none text-right pr-2 pl-2 pt-3 pb-3 bg-muted/20 border-r text-muted-foreground font-mono text-xs leading-[1.35rem] min-w-[2.5rem]" aria-hidden="true">
                  {stagingEditContent.split("\n").map((_: string, i: number) => (
                    <div key={i} className="text-[10px]">{i + 1}</div>
                  ))}
                </div>
                <textarea
                  ref={stagingEditRef}
                  value={stagingEditContent}
                  onChange={(e) => {
                    setStagingEditContent(e.target.value);
                    setStagingModified(e.target.value !== stagingOriginalRef.current);
                  }}
                  spellCheck={false}
                  className="flex-1 p-3 font-mono text-xs bg-background resize-none focus:outline-none border-0 leading-[1.35rem]"
                  style={{ tabSize: 2 }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const start = e.currentTarget.selectionStart;
                      const end = e.currentTarget.selectionEnd;
                      const val = stagingEditContent;
                      const newVal = val.substring(0, start) + "  " + val.substring(end);
                      setStagingEditContent(newVal);
                      setStagingModified(newVal !== stagingOriginalRef.current);
                      setTimeout(() => {
                        if (stagingEditRef.current) {
                          stagingEditRef.current.selectionStart = stagingEditRef.current.selectionEnd = start + 2;
                        }
                      }, 0);
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                      e.preventDefault();
                      saveStagingFile();
                    }
                  }}
                  data-testid="textarea-staging-editor"
                />
              </div>
            </div>
          ) : (
            <div>
              <div className="flex border-b bg-muted/30 px-2.5 py-1 items-center gap-2">
                <Code className="w-3 h-3 text-muted-foreground" />
                <span className="text-[11px] font-mono text-muted-foreground">{stagingFile.path}</span>
                <Badge variant="outline" className="text-[9px] h-3.5 px-1">{getSyntaxLang(stagingFile.path)}</Badge>
                <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-amber-400 text-amber-600">staging</Badge>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {stagingFile.content.split("\n").length}L
                </span>
              </div>
              <div className="flex max-h-[500px] overflow-y-auto">
                <div className="select-none text-right pr-2 pl-2 pt-3 pb-3 bg-muted/20 border-r text-muted-foreground font-mono text-xs leading-[1.35rem] min-w-[2.5rem]" aria-hidden="true">
                  {stagingFile.content.split("\n").map((_: string, i: number) => (
                    <div key={i} className="text-[10px]">{i + 1}</div>
                  ))}
                </div>
                <pre
                  className="flex-1 text-xs font-mono whitespace-pre-wrap overflow-x-auto p-3 leading-[1.35rem]"
                  data-testid="text-staging-content"
                >
                  {stagingFile.content}
                </pre>
              </div>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1">
          <Badge variant="outline" className="text-[10px] h-5 border-amber-400 text-amber-600 shrink-0">
            <FlaskConical className="w-3 h-3 mr-1" /> staging
          </Badge>
          <span className="text-[11px] text-muted-foreground shrink-0 font-mono">
            {stagingPath ? `/${stagingPath}` : "/"}
          </span>
          <div className="relative flex-1 max-w-[220px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              placeholder="Rechercher..."
              className="h-7 text-xs pl-7"
              value={stagingSearch}
              onChange={(e) => setStagingSearch(e.target.value)}
              data-testid="input-search-staging"
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs bg-green-600 hover:bg-green-700"
            disabled={stagingDeploying}
            onClick={() => {
              if (confirm("Déployer staging vers production ?\n\nCela va créer une PR et la merger dans la branche principale.")) {
                deployStagingToProd();
              }
            }}
            data-testid="button-deploy-staging"
          >
            {stagingDeploying ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <Rocket className="w-3 h-3 mr-1" />
            )}
            Déployer en Prod
          </Button>
        </div>
      </div>

      {stagingDeployStatus && (
        <div className="flex items-center gap-2 text-xs p-2 rounded bg-muted/50 border">
          {stagingDeploying ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
          ) : (
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
          )}
          <span className="text-muted-foreground">{stagingDeployStatus}</span>
        </div>
      )}

      {stagingTreeLoading && (
        <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement staging...
        </div>
      )}

      {stagingFileLoading && (
        <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement du fichier...
        </div>
      )}

      <div className="space-y-0.5">
        {(() => {
          if (!stagingTree?.tree) return null;
          const tree = stagingTree.tree;
          const searchQ = stagingSearch.trim().toLowerCase();

          if (searchQ) {
            const results = tree
              .filter((f) => f.type === "blob" && f.path.toLowerCase().includes(searchQ))
              .slice(0, 50);
            return results.map((item) => (
              <div
                key={item.path}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                onClick={() => loadStagingFile(item.path)}
                data-testid={`staging-file-${item.path}`}
              >
                <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="font-mono truncate">{item.path}</span>
              </div>
            ));
          }

          const dirs = new Set<string>();
          const files: TreeItem[] = [];
          for (const item of tree) {
            if (!stagingPath) {
              const parts = item.path.split("/");
              if (parts.length > 1) dirs.add(parts[0]);
              else if (item.type === "blob") files.push(item);
            } else {
              if (!item.path.startsWith(stagingPath + "/")) continue;
              const rest = item.path.slice(stagingPath.length + 1);
              const parts = rest.split("/");
              if (parts.length > 1) dirs.add(parts[0]);
              else if (item.type === "blob") files.push(item);
            }
          }

          const sortedDirs = Array.from(dirs).sort();
          return (
            <>
              {stagingPath && (
                <div
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs text-muted-foreground"
                  onClick={() => {
                    const parts = stagingPath.split("/");
                    parts.pop();
                    setStagingPath(parts.join("/"));
                  }}
                  data-testid="staging-nav-up"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>..</span>
                </div>
              )}
              {sortedDirs.map((dir) => (
                <div
                  key={dir}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                  onClick={() => setStagingPath(stagingPath ? `${stagingPath}/${dir}` : dir)}
                  data-testid={`staging-dir-${dir}`}
                >
                  <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="font-mono">{dir}</span>
                  <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto" />
                </div>
              ))}
              {files.map((item) => (
                <div
                  key={item.path}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                  onClick={() => loadStagingFile(item.path)}
                  data-testid={`staging-file-${item.path}`}
                >
                  <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-mono">{item.path.split("/").pop()}</span>
                </div>
              ))}
            </>
          );
        })()}
      </div>

      {!stagingTreeLoading && !stagingTree?.tree?.length && (
        <p className="text-xs text-muted-foreground text-center py-4">Aucun fichier sur staging</p>
      )}
    </div>
  );
}
