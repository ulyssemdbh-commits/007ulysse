import { useState, useCallback } from "react";

export type PanelType = 
  | "homework" 
  | "diagnostics" 
  | "files" 
  | "memory" 
  | "camera" 
  | "liveVision"
  | "geolocation" 
  | "email" 
  | "history"
  | "codeSnapshot"
  | "voiceSettings"
  | "smartHome"
  | "integrations"
  | "studio"
  | "menu";

interface UsePanelManagerOptions {
  initialPanel?: PanelType | null;
}

export function usePanelManager(options: UsePanelManagerOptions = {}) {
  const { initialPanel = null } = options;
  
  const [activePanel, setActivePanel] = useState<PanelType | null>(initialPanel);

  const openPanel = useCallback((panel: PanelType) => {
    setActivePanel(panel);
  }, []);

  const closePanel = useCallback(() => {
    setActivePanel(null);
  }, []);

  const togglePanel = useCallback((panel: PanelType) => {
    setActivePanel(prev => prev === panel ? null : panel);
  }, []);

  const isOpen = useCallback((panel: PanelType) => {
    return activePanel === panel;
  }, [activePanel]);

  return {
    activePanel,
    openPanel,
    closePanel,
    togglePanel,
    isOpen,
    showHomework: activePanel === "homework",
    showDiagnostics: activePanel === "diagnostics",
    showFiles: activePanel === "files",
    showMemory: activePanel === "memory",
    showCamera: activePanel === "camera",
    showGeolocation: activePanel === "geolocation",
    showEmail: activePanel === "email",
    showHistory: activePanel === "history",
    showCodeSnapshot: activePanel === "codeSnapshot",
    showVoiceSettings: activePanel === "voiceSettings",
    showMenu: activePanel === "menu",
    showSmartHome: activePanel === "smartHome",
    showIntegrations: activePanel === "integrations",
    showStudio: activePanel === "studio",
    showLiveVision: activePanel === "liveVision",
    setShowHomework: (show: boolean) => show ? openPanel("homework") : closePanel(),
    setShowDiagnostics: (show: boolean) => show ? openPanel("diagnostics") : closePanel(),
    setShowFiles: (show: boolean) => show ? openPanel("files") : closePanel(),
    setShowMemory: (show: boolean) => show ? openPanel("memory") : closePanel(),
    setShowCamera: (show: boolean) => show ? openPanel("camera") : closePanel(),
    setShowGeolocation: (show: boolean) => show ? openPanel("geolocation") : closePanel(),
    setShowEmail: (show: boolean) => show ? openPanel("email") : closePanel(),
    setShowHistory: (show: boolean) => show ? openPanel("history") : closePanel(),
    setShowCodeSnapshot: (show: boolean) => show ? openPanel("codeSnapshot") : closePanel(),
    setShowVoiceSettings: (show: boolean) => show ? openPanel("voiceSettings") : closePanel(),
    setShowMenu: (show: boolean) => show ? openPanel("menu") : closePanel(),
    setShowSmartHome: (show: boolean) => show ? openPanel("smartHome") : closePanel(),
    setShowIntegrations: (show: boolean) => show ? openPanel("integrations") : closePanel(),
    setShowStudio: (show: boolean) => show ? openPanel("studio") : closePanel(),
  };
}
