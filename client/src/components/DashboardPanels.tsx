import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, X, Eye } from "lucide-react";
import { ConversationHistory } from "@/components/ConversationHistory";
import { MemoryPanel } from "@/components/MemoryPanel";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";
import { GeneratedFilesModal } from "@/components/GeneratedFilesModal";
import { StudioPanel } from "@/components/StudioPanel";
import { HomeworkPanel } from "@/components/HomeworkPanel";
import { GeolocationPanel } from "@/components/GeolocationPanel";
import { EmailPanel } from "@/components/EmailPanel";
import { CameraCapture } from "@/components/CameraCapture";
import { LiveVision } from "@/components/LiveVision";
import IntegrationsPanel from "@/components/IntegrationsPanel";
import { ImageEditor } from "@/components/ImageEditor";
import { CodeSnapshotModal } from "@/components/CodeSnapshotModal";
import { motion, AnimatePresence } from "framer-motion";
import type { NavigationDestination } from "@/hooks/useNavigationRequest";

interface PanelManagerState {
  showHistory: boolean;
  showMemory: boolean;
  showDiagnostics: boolean;
  showFiles: boolean;
  showStudio: boolean;
  showHomework: boolean;
  showGeolocation: boolean;
  showEmail: boolean;
  showCamera: boolean;
  showLiveVision: boolean;
  showIntegrations: boolean;
  showCodeSnapshot: boolean;
  openPanel: (name: string) => void;
  closePanel: () => void;
}

interface DiagnosticsState {
  activeIssues: Array<{ id: string; message: string }>;
  clearActiveIssue: (id: string) => void;
}

interface GeoState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  error: string | null;
}

interface PendingFileAnalysis {
  imageDataUrl?: string;
  [key: string]: unknown;
}

interface DashboardPanelsProps {
  panels: PanelManagerState;
  diagnostics: DiagnosticsState;
  activeConversationId: number | null;
  setActiveConversationId: (id: number) => void;
  personaName: string;
  geo: GeoState;
  geoAccuracyMode: string;
  setGeoAccuracyMode: (mode: string) => void;
  navigationDestination: NavigationDestination | null;
  setNavigationDestination: (dest: NavigationDestination | null) => void;
  isOwner: boolean;
  showImageEditor: boolean;
  setShowImageEditor: (v: boolean) => void;
  pendingFileAnalysis: PendingFileAnalysis | null;
  setPendingFileAnalysis: (v: PendingFileAnalysis | null) => void;
}

export function DashboardPanels({
  panels,
  diagnostics,
  activeConversationId,
  setActiveConversationId,
  personaName,
  geo,
  geoAccuracyMode,
  setGeoAccuracyMode,
  navigationDestination,
  setNavigationDestination,
  isOwner,
  showImageEditor,
  setShowImageEditor,
  pendingFileAnalysis,
  setPendingFileAnalysis,
}: DashboardPanelsProps) {
  return (
    <>
      <AnimatePresence>
        {diagnostics.activeIssues.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-destructive/10 border-b border-destructive/20 px-4 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                <span className="text-sm text-destructive truncate">
                  {diagnostics.activeIssues[0]?.message}
                </span>
                {diagnostics.activeIssues.length > 1 && (
                  <Badge variant="destructive" className="shrink-0">
                    +{diagnostics.activeIssues.length - 1}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => panels.openPanel("diagnostics")} className="text-destructive" data-testid="button-view-issues">
                  Voir
                </Button>
                <Button size="icon" variant="ghost" onClick={() => diagnostics.clearActiveIssue(diagnostics.activeIssues[0]?.id)} className="text-destructive" data-testid="button-dismiss-issue">
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panels.showHistory && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-0 sm:inset-y-0 sm:left-0 sm:right-auto w-full sm:w-96 z-40 bg-background shadow-xl sm:top-[100px]"
          >
            <ConversationHistory
              onSelectConversation={(id) => { setActiveConversationId(id); panels.closePanel(); }}
              onClose={() => panels.closePanel()}
              activeConversationId={activeConversationId}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panels.showMemory && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/50" onClick={() => panels.closePanel()}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
              <MemoryPanel onClose={() => panels.closePanel()} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panels.showDiagnostics && (
          <motion.div initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }}>
            <DiagnosticsPanel onClose={() => panels.closePanel()} />
          </motion.div>
        )}
      </AnimatePresence>

      <GeneratedFilesModal isOpen={panels.showFiles} onClose={() => panels.closePanel()} personaName={personaName} />
      <StudioPanel isOpen={panels.showStudio} onClose={() => panels.closePanel()} />
      <HomeworkPanel isOpen={panels.showHomework} onClose={() => panels.closePanel()} />

      <AnimatePresence>
        {panels.showGeolocation && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <GeolocationPanel
              geo={geo}
              accuracyMode={geoAccuracyMode}
              setAccuracyMode={setGeoAccuracyMode}
              isMobile={false}
              onClose={() => panels.closePanel()}
              initialDestination={navigationDestination}
              onDestinationCleared={() => setNavigationDestination(null)}
              isOwner={isOwner}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panels.showEmail && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <EmailPanel onClose={() => panels.closePanel()} />
          </motion.div>
        )}
      </AnimatePresence>

      <CameraCapture open={panels.showCamera} onClose={() => panels.closePanel()} />

      <AnimatePresence>
        {panels.showLiveVision && (
          <motion.div
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-40 w-[420px] bg-background shadow-xl border-l overflow-y-auto"
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Eye className="w-5 h-5" /> Vision Live
                </h2>
                <Button variant="ghost" size="icon" onClick={() => panels.closePanel()} data-testid="button-close-vision">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <LiveVision />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panels.showIntegrations && (
          <motion.div
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-40 w-96 bg-background shadow-xl border-l"
          >
            <IntegrationsPanel />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImageEditor && pendingFileAnalysis?.imageDataUrl && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setShowImageEditor(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl"
            >
              <ImageEditor
                imageDataUrl={pendingFileAnalysis.imageDataUrl}
                onClose={() => setShowImageEditor(false)}
                onSave={(editedDataUrl) => {
                  setPendingFileAnalysis({ ...pendingFileAnalysis, imageDataUrl: editedDataUrl });
                  setShowImageEditor(false);
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isOwner && (
        <CodeSnapshotModal isOpen={panels.showCodeSnapshot} onClose={() => panels.closePanel()} />
      )}
    </>
  );
}
