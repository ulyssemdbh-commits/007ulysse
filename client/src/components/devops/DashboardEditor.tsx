import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  LayoutTemplate, Shapes, Type, Image, Upload, Settings2,
  Plus, Trash2, Copy, Layers, ChevronUp, ChevronDown,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  Undo2, Redo2, Download, Sparkles, Move, Eye, EyeOff,
  Square, Circle, Minus, Star, ArrowRight, Code2, Palette,
  GripVertical, Lock, Unlock, Send, Wand2
} from "lucide-react";

interface EditorElement {
  id: string;
  type: "text" | "image" | "button" | "container" | "divider" | "shape" | "hero" | "card" | "navbar" | "footer" | "grid" | "icon";
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  src?: string;
  styles: Record<string, string>;
  locked?: boolean;
  visible?: boolean;
  name?: string;
  children?: string[];
}

interface EditorTemplate {
  id: string;
  name: string;
  thumbnail: string;
  category: string;
  elements: EditorElement[];
  canvasWidth: number;
  canvasHeight: number;
}

interface DashboardEditorProps {
  repoName?: string;
  onExportHtml?: (html: string, css: string) => void;
  onRequestAI?: (prompt: string, elements: EditorElement[]) => void;
}

const TEMPLATES: EditorTemplate[] = [
  {
    id: "blank",
    name: "Page vide",
    thumbnail: "⬜",
    category: "base",
    elements: [],
    canvasWidth: 1200,
    canvasHeight: 800,
  },
  {
    id: "landing-hero",
    name: "Landing Page",
    thumbnail: "🏠",
    category: "landing",
    canvasWidth: 1200,
    canvasHeight: 900,
    elements: [
      { id: "nav-1", type: "navbar", x: 0, y: 0, width: 1200, height: 60, content: "Mon Site", styles: { backgroundColor: "#1a1a2e", color: "#ffffff", display: "flex", alignItems: "center", padding: "0 40px", fontSize: "18px", fontWeight: "bold" }, name: "Navbar" },
      { id: "hero-1", type: "hero", x: 0, y: 60, width: 1200, height: 500, content: "Bienvenue", styles: { background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", color: "#ffffff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: "48px", fontWeight: "bold" }, name: "Hero" },
      { id: "hero-sub", type: "text", x: 350, y: 380, width: 500, height: 40, content: "Créez quelque chose d'extraordinaire", styles: { color: "#ffffff", fontSize: "20px", textAlign: "center", opacity: "0.9" }, name: "Sous-titre" },
      { id: "hero-btn", type: "button", x: 500, y: 440, width: 200, height: 50, content: "Commencer", styles: { backgroundColor: "#ffffff", color: "#764ba2", borderRadius: "25px", fontSize: "16px", fontWeight: "600", border: "none", cursor: "pointer" }, name: "CTA" },
      { id: "section-1", type: "container", x: 0, y: 560, width: 1200, height: 340, styles: { backgroundColor: "#f8f9fa", padding: "60px 40px" }, name: "Section Features", children: [] },
      { id: "card-1", type: "card", x: 40, y: 620, width: 350, height: 220, content: "Feature 1", styles: { backgroundColor: "#ffffff", borderRadius: "12px", padding: "30px", boxShadow: "0 2px 10px rgba(0,0,0,0.08)", fontSize: "20px", fontWeight: "600" }, name: "Card 1" },
      { id: "card-2", type: "card", x: 425, y: 620, width: 350, height: 220, content: "Feature 2", styles: { backgroundColor: "#ffffff", borderRadius: "12px", padding: "30px", boxShadow: "0 2px 10px rgba(0,0,0,0.08)", fontSize: "20px", fontWeight: "600" }, name: "Card 2" },
      { id: "card-3", type: "card", x: 810, y: 620, width: 350, height: 220, content: "Feature 3", styles: { backgroundColor: "#ffffff", borderRadius: "12px", padding: "30px", boxShadow: "0 2px 10px rgba(0,0,0,0.08)", fontSize: "20px", fontWeight: "600" }, name: "Card 3" },
    ],
  },
  {
    id: "dashboard",
    name: "Dashboard",
    thumbnail: "📊",
    category: "app",
    canvasWidth: 1200,
    canvasHeight: 800,
    elements: [
      { id: "sidebar", type: "container", x: 0, y: 0, width: 240, height: 800, styles: { backgroundColor: "#1e293b", padding: "20px" }, name: "Sidebar" },
      { id: "sidebar-title", type: "text", x: 20, y: 20, width: 200, height: 30, content: "Dashboard", styles: { color: "#ffffff", fontSize: "20px", fontWeight: "bold" }, name: "Logo" },
      { id: "topbar", type: "container", x: 240, y: 0, width: 960, height: 60, styles: { backgroundColor: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "0 30px", display: "flex", alignItems: "center" }, name: "Top Bar" },
      { id: "stat-1", type: "card", x: 270, y: 90, width: 210, height: 120, content: "12,450", styles: { backgroundColor: "#ffffff", borderRadius: "12px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", fontSize: "28px", fontWeight: "bold", color: "#1e293b" }, name: "Stat 1" },
      { id: "stat-2", type: "card", x: 500, y: 90, width: 210, height: 120, content: "+24.5%", styles: { backgroundColor: "#ffffff", borderRadius: "12px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", fontSize: "28px", fontWeight: "bold", color: "#22c55e" }, name: "Stat 2" },
      { id: "stat-3", type: "card", x: 730, y: 90, width: 210, height: 120, content: "1,234", styles: { backgroundColor: "#ffffff", borderRadius: "12px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", fontSize: "28px", fontWeight: "bold", color: "#1e293b" }, name: "Stat 3" },
      { id: "stat-4", type: "card", x: 960, y: 90, width: 210, height: 120, content: "98.5%", styles: { backgroundColor: "#ffffff", borderRadius: "12px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", fontSize: "28px", fontWeight: "bold", color: "#3b82f6" }, name: "Stat 4" },
      { id: "chart-area", type: "container", x: 270, y: 230, width: 600, height: 350, styles: { backgroundColor: "#ffffff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: "20px" }, name: "Chart Area" },
      { id: "chart-title", type: "text", x: 290, y: 240, width: 300, height: 25, content: "Revenus mensuels", styles: { fontSize: "16px", fontWeight: "600", color: "#334155" }, name: "Chart Title" },
      { id: "activity", type: "container", x: 890, y: 230, width: 280, height: 350, styles: { backgroundColor: "#ffffff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: "20px" }, name: "Activity Feed" },
      { id: "activity-title", type: "text", x: 910, y: 240, width: 200, height: 25, content: "Activité récente", styles: { fontSize: "16px", fontWeight: "600", color: "#334155" }, name: "Activity Title" },
      { id: "table-area", type: "container", x: 270, y: 600, width: 900, height: 180, styles: { backgroundColor: "#ffffff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: "20px" }, name: "Table" },
      { id: "table-title", type: "text", x: 290, y: 610, width: 300, height: 25, content: "Dernières transactions", styles: { fontSize: "16px", fontWeight: "600", color: "#334155" }, name: "Table Title" },
    ],
  },
  {
    id: "portfolio",
    name: "Portfolio",
    thumbnail: "🎨",
    category: "landing",
    canvasWidth: 1200,
    canvasHeight: 900,
    elements: [
      { id: "port-nav", type: "navbar", x: 0, y: 0, width: 1200, height: 60, content: "Portfolio", styles: { backgroundColor: "#000000", color: "#ffffff", display: "flex", alignItems: "center", padding: "0 40px", fontSize: "18px", fontWeight: "bold" }, name: "Navbar" },
      { id: "port-hero", type: "hero", x: 0, y: 60, width: 1200, height: 400, content: "John Doe", styles: { background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)", color: "#ffffff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: "56px", fontWeight: "bold" }, name: "Hero" },
      { id: "port-subtitle", type: "text", x: 350, y: 320, width: 500, height: 40, content: "Développeur Full-Stack & Designer", styles: { color: "#a78bfa", fontSize: "22px", textAlign: "center" }, name: "Titre" },
      { id: "port-grid", type: "grid", x: 40, y: 500, width: 1120, height: 360, styles: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px", padding: "20px" }, name: "Grid Projets" },
      { id: "port-p1", type: "card", x: 40, y: 500, width: 350, height: 250, content: "Projet 1", styles: { backgroundColor: "#1e1e2e", borderRadius: "16px", padding: "0", overflow: "hidden", color: "#ffffff", fontSize: "18px" }, name: "Projet 1" },
      { id: "port-p2", type: "card", x: 410, y: 500, width: 350, height: 250, content: "Projet 2", styles: { backgroundColor: "#1e1e2e", borderRadius: "16px", padding: "0", overflow: "hidden", color: "#ffffff", fontSize: "18px" }, name: "Projet 2" },
      { id: "port-p3", type: "card", x: 780, y: 500, width: 350, height: 250, content: "Projet 3", styles: { backgroundColor: "#1e1e2e", borderRadius: "16px", padding: "0", overflow: "hidden", color: "#ffffff", fontSize: "18px" }, name: "Projet 3" },
    ],
  },
  {
    id: "restaurant",
    name: "Restaurant",
    thumbnail: "🍽️",
    category: "landing",
    canvasWidth: 1200,
    canvasHeight: 900,
    elements: [
      { id: "rest-nav", type: "navbar", x: 0, y: 0, width: 1200, height: 60, content: "SUGU Restaurant", styles: { backgroundColor: "rgba(0,0,0,0.8)", color: "#d4af37", display: "flex", alignItems: "center", padding: "0 40px", fontSize: "20px", fontWeight: "bold", fontFamily: "serif" }, name: "Navbar" },
      { id: "rest-hero", type: "hero", x: 0, y: 60, width: 1200, height: 500, content: "Bienvenue chez SUGU", styles: { background: "linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.7)), url('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200') center/cover", color: "#ffffff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: "52px", fontWeight: "bold", fontFamily: "serif" }, name: "Hero" },
      { id: "rest-sub", type: "text", x: 300, y: 390, width: 600, height: 40, content: "Cuisine française traditionnelle à Marseille", styles: { color: "#d4af37", fontSize: "20px", textAlign: "center", fontFamily: "serif" }, name: "Sous-titre" },
      { id: "rest-btn", type: "button", x: 480, y: 450, width: 240, height: 50, content: "Réserver une table", styles: { backgroundColor: "#d4af37", color: "#1a1a1a", borderRadius: "0", fontSize: "16px", fontWeight: "600", border: "2px solid #d4af37", fontFamily: "serif", letterSpacing: "2px", textTransform: "uppercase" }, name: "CTA" },
      { id: "rest-menu", type: "container", x: 0, y: 560, width: 1200, height: 340, styles: { backgroundColor: "#1a1a1a", padding: "60px 40px" }, name: "Menu Section" },
      { id: "rest-menu-title", type: "text", x: 400, y: 580, width: 400, height: 40, content: "Notre Menu", styles: { color: "#d4af37", fontSize: "32px", fontWeight: "bold", textAlign: "center", fontFamily: "serif" }, name: "Menu Title" },
    ],
  },
];

const ELEMENT_PRESETS: { type: EditorElement["type"]; label: string; icon: string; defaults: Partial<EditorElement> }[] = [
  { type: "text", label: "Titre", icon: "H", defaults: { width: 300, height: 40, content: "Titre", styles: { fontSize: "32px", fontWeight: "bold", color: "#1a1a2e" } } },
  { type: "text", label: "Paragraphe", icon: "P", defaults: { width: 400, height: 80, content: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.", styles: { fontSize: "16px", color: "#475569", lineHeight: "1.6" } } },
  { type: "button", label: "Bouton", icon: "▣", defaults: { width: 180, height: 45, content: "Cliquer", styles: { backgroundColor: "#3b82f6", color: "#ffffff", borderRadius: "8px", fontSize: "14px", fontWeight: "600", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" } } },
  { type: "container", label: "Section", icon: "▭", defaults: { width: 1200, height: 300, styles: { backgroundColor: "#f8f9fa", padding: "40px" } } },
  { type: "card", label: "Carte", icon: "▢", defaults: { width: 300, height: 200, content: "Carte", styles: { backgroundColor: "#ffffff", borderRadius: "12px", padding: "24px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", fontSize: "18px", fontWeight: "600" } } },
  { type: "image", label: "Image", icon: "🖼", defaults: { width: 400, height: 250, src: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&h=250&fit=crop", styles: { borderRadius: "8px", objectFit: "cover" } } },
  { type: "divider", label: "Séparateur", icon: "—", defaults: { width: 800, height: 2, styles: { backgroundColor: "#e2e8f0" } } },
  { type: "hero", label: "Hero Banner", icon: "🌅", defaults: { width: 1200, height: 400, content: "Hero Section", styles: { background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "42px", fontWeight: "bold" } } },
  { type: "navbar", label: "Barre de nav", icon: "☰", defaults: { width: 1200, height: 60, content: "Site", styles: { backgroundColor: "#1a1a2e", color: "#ffffff", display: "flex", alignItems: "center", padding: "0 30px", fontSize: "16px", fontWeight: "600" } } },
  { type: "footer", label: "Footer", icon: "▬", defaults: { width: 1200, height: 100, content: "© 2026 - Tous droits réservés", styles: { backgroundColor: "#1a1a2e", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" } } },
];

const COLOR_PRESETS = [
  "#000000", "#ffffff", "#1a1a2e", "#16213e", "#0f3460",
  "#e94560", "#533483", "#3b82f6", "#22c55e", "#eab308",
  "#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#d4af37",
  "#f8f9fa", "#e2e8f0", "#94a3b8", "#475569", "#1e293b",
];

const FONT_OPTIONS = [
  "Inter", "Arial", "Georgia", "serif", "sans-serif", "monospace",
  "Playfair Display", "Roboto", "Poppins", "Montserrat", "Lato",
];

let idCounter = 0;
function genId() {
  return `el-${Date.now()}-${idCounter++}`;
}

export default function DashboardEditor({ repoName, onExportHtml, onRequestAI }: DashboardEditorProps) {
  const [elements, setElements] = useState<EditorElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState("templates");
  const [canvasWidth, setCanvasWidth] = useState(1200);
  const [canvasHeight, setCanvasHeight] = useState(900);
  const [zoom, setZoom] = useState(0.55);
  const [history, setHistory] = useState<EditorElement[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [dragState, setDragState] = useState<{ id: string; offsetX: number; offsetY: number; resizing?: string } | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [showGrid, setShowGrid] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);

  const selectedElement = useMemo(() => elements.find((e) => e.id === selectedId), [elements, selectedId]);

  const pushHistory = useCallback((newElements: EditorElement[]) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, JSON.parse(JSON.stringify(newElements))];
    });
    setHistoryIndex((prev) => prev + 1);
  }, [historyIndex]);

  const updateElements = useCallback((newElements: EditorElement[]) => {
    setElements(newElements);
    pushHistory(newElements);
  }, [pushHistory]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setElements(JSON.parse(JSON.stringify(history[newIndex])));
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setElements(JSON.parse(JSON.stringify(history[newIndex])));
    }
  }, [history, historyIndex]);

  const applyTemplate = useCallback((template: EditorTemplate) => {
    const newElements = template.elements.map((el) => ({ ...el, id: genId(), styles: { ...el.styles } }));
    setCanvasWidth(template.canvasWidth);
    setCanvasHeight(template.canvasHeight);
    setElements(newElements);
    pushHistory(newElements);
    setSelectedId(null);
  }, [pushHistory]);

  const addElement = useCallback((preset: (typeof ELEMENT_PRESETS)[0]) => {
    const newEl: EditorElement = {
      id: genId(),
      type: preset.type,
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 200,
      width: preset.defaults.width || 200,
      height: preset.defaults.height || 100,
      content: preset.defaults.content,
      src: preset.defaults.src,
      styles: { ...preset.defaults.styles } as Record<string, string>,
      visible: true,
      name: preset.label + " " + (elements.length + 1),
    };
    const newElements = [...elements, newEl];
    updateElements(newElements);
    setSelectedId(newEl.id);
  }, [elements, updateElements]);

  const deleteElement = useCallback((id: string) => {
    const newElements = elements.filter((e) => e.id !== id);
    updateElements(newElements);
    if (selectedId === id) setSelectedId(null);
  }, [elements, selectedId, updateElements]);

  const duplicateElement = useCallback((id: string) => {
    const el = elements.find((e) => e.id === id);
    if (!el) return;
    const newEl: EditorElement = { ...el, id: genId(), x: el.x + 20, y: el.y + 20, styles: { ...el.styles }, name: (el.name || "Element") + " (copie)" };
    const newElements = [...elements, newEl];
    updateElements(newElements);
    setSelectedId(newEl.id);
  }, [elements, updateElements]);

  const updateElementStyle = useCallback((id: string, key: string, value: string) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, styles: { ...el.styles, [key]: value } } : el)));
  }, []);

  const updateElementProp = useCallback((id: string, key: string, value: any) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, [key]: value } : el)));
  }, []);

  const commitStyles = useCallback(() => {
    pushHistory(elements);
  }, [elements, pushHistory]);

  const moveLayer = useCallback((id: string, direction: "up" | "down") => {
    const idx = elements.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const newElements = [...elements];
    if (direction === "up" && idx < newElements.length - 1) {
      [newElements[idx], newElements[idx + 1]] = [newElements[idx + 1], newElements[idx]];
    } else if (direction === "down" && idx > 0) {
      [newElements[idx], newElements[idx - 1]] = [newElements[idx - 1], newElements[idx]];
    }
    updateElements(newElements);
  }, [elements, updateElements]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent, id: string, type?: string) => {
    e.stopPropagation();
    const el = elements.find((el) => el.id === id);
    if (!el || el.locked) return;
    setSelectedId(id);
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    const mouseX = (e.clientX - canvasRect.left) / zoom;
    const mouseY = (e.clientY - canvasRect.top) / zoom;
    setDragState({
      id,
      offsetX: mouseX - el.x,
      offsetY: mouseY - el.y,
      resizing: type === "resize" ? "se" : undefined,
    });
  }, [elements, zoom]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState) return;
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    const mouseX = (e.clientX - canvasRect.left) / zoom;
    const mouseY = (e.clientY - canvasRect.top) / zoom;

    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== dragState.id) return el;
        if (dragState.resizing) {
          const newW = Math.max(40, mouseX - el.x);
          const newH = Math.max(20, mouseY - el.y);
          return { ...el, width: Math.round(newW), height: Math.round(newH) };
        }
        return { ...el, x: Math.round(mouseX - dragState.offsetX), y: Math.round(mouseY - dragState.offsetY) };
      })
    );
  }, [dragState, zoom]);

  const handleCanvasMouseUp = useCallback(() => {
    if (dragState) {
      pushHistory(elements);
      setDragState(null);
    }
  }, [dragState, elements, pushHistory]);

  const exportToHtml = useCallback(() => {
    let css = `* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: 'Inter', -apple-system, sans-serif; }\n`;
    let html = `<!DOCTYPE html>\n<html lang="fr">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${repoName || "Dashboard"}</title>\n  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n  <style>\n`;

    elements.forEach((el) => {
      const styleStr = Object.entries(el.styles).map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v}`).join("; ");
      css += `.${el.id} { position: absolute; left: ${el.x}px; top: ${el.y}px; width: ${el.width}px; height: ${el.height}px; ${styleStr}; }\n`;
    });

    html += css;
    html += `  </style>\n</head>\n<body>\n  <div style="position: relative; width: ${canvasWidth}px; min-height: ${canvasHeight}px; margin: 0 auto;">\n`;

    elements.forEach((el) => {
      if (el.visible === false) return;
      switch (el.type) {
        case "image":
          html += `    <img class="${el.id}" src="${el.src || ""}" alt="${el.name || ""}" />\n`;
          break;
        case "button":
          html += `    <button class="${el.id}">${el.content || ""}</button>\n`;
          break;
        default:
          html += `    <div class="${el.id}">${el.content || ""}</div>\n`;
      }
    });

    html += `  </div>\n</body>\n</html>`;
    onExportHtml?.(html, css);
    return html;
  }, [elements, canvasWidth, canvasHeight, repoName, onExportHtml]);

  const renderElement = useCallback((el: EditorElement) => {
    if (el.visible === false) return null;
    const isSelected = el.id === selectedId;
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      left: el.x,
      top: el.y,
      width: el.width,
      height: el.height,
      ...Object.fromEntries(Object.entries(el.styles).map(([k, v]) => [k, v])),
      outline: isSelected ? "2px solid #3b82f6" : undefined,
      outlineOffset: isSelected ? "1px" : undefined,
      cursor: el.locked ? "not-allowed" : (dragState?.id === el.id ? "grabbing" : "grab"),
      userSelect: "none" as const,
      overflow: "hidden",
    };

    return (
      <div
        key={el.id}
        style={baseStyle}
        data-testid={`editor-element-${el.id}`}
        onMouseDown={(e) => handleCanvasMouseDown(e, el.id)}
      >
        {el.type === "image" && el.src ? (
          <img src={el.src} alt={el.name} style={{ width: "100%", height: "100%", objectFit: (el.styles.objectFit as any) || "cover", borderRadius: el.styles.borderRadius }} />
        ) : (
          el.content && <span>{el.content}</span>
        )}
        {isSelected && !el.locked && (
          <div
            style={{ position: "absolute", right: -4, bottom: -4, width: 12, height: 12, backgroundColor: "#3b82f6", borderRadius: 2, cursor: "se-resize" }}
            onMouseDown={(e) => handleCanvasMouseDown(e, el.id, "resize")}
            data-testid={`resize-handle-${el.id}`}
          />
        )}
      </div>
    );
  }, [selectedId, dragState, handleCanvasMouseDown]);

  return (
    <div className="flex h-full bg-gray-100 dark:bg-gray-900 overflow-hidden" style={{ height: "calc(100vh - 200px)", minHeight: 500 }}>
      {/* Sidebar */}
      <div className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden" data-testid="editor-sidebar">
        <Tabs value={sidebarTab} onValueChange={setSidebarTab} className="flex flex-col h-full">
          <div className="border-b border-gray-200 dark:border-gray-700">
            <TabsList className="grid grid-cols-5 h-auto p-1 bg-transparent">
              <TabsTrigger value="templates" className="flex flex-col items-center gap-0.5 py-1.5 px-1 text-[10px]" data-testid="tab-templates">
                <LayoutTemplate className="w-4 h-4" />
                Modèles
              </TabsTrigger>
              <TabsTrigger value="elements" className="flex flex-col items-center gap-0.5 py-1.5 px-1 text-[10px]" data-testid="tab-elements">
                <Shapes className="w-4 h-4" />
                Éléments
              </TabsTrigger>
              <TabsTrigger value="text" className="flex flex-col items-center gap-0.5 py-1.5 px-1 text-[10px]" data-testid="tab-text">
                <Type className="w-4 h-4" />
                Texte
              </TabsTrigger>
              <TabsTrigger value="styles" className="flex flex-col items-center gap-0.5 py-1.5 px-1 text-[10px]" data-testid="tab-styles">
                <Palette className="w-4 h-4" />
                Styles
              </TabsTrigger>
              <TabsTrigger value="layers" className="flex flex-col items-center gap-0.5 py-1.5 px-1 text-[10px]" data-testid="tab-layers">
                <Layers className="w-4 h-4" />
                Calques
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <TabsContent value="templates" className="mt-0 space-y-3">
              <div className="relative">
                <Input placeholder="Décrivez votre design de rêve" className="pr-10 text-xs" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} data-testid="input-ai-prompt" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                  onClick={() => { if (aiPrompt.trim() && onRequestAI) { onRequestAI(aiPrompt, elements); setAiPrompt(""); } }}
                  data-testid="btn-ai-generate"
                >
                  <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                </Button>
              </div>
              <Button
                variant="outline"
                className="w-full text-xs gap-2"
                onClick={() => { if (onRequestAI) onRequestAI("Génère le design complet", elements); }}
                data-testid="btn-generate-design"
              >
                <Wand2 className="w-3.5 h-3.5" /> Générer le design
              </Button>
              <div className="text-xs font-semibold text-gray-500 mt-2">Modèles</div>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => applyTemplate(t)}
                    className="flex flex-col items-center gap-1 p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-xs"
                    data-testid={`template-${t.id}`}
                  >
                    <span className="text-2xl">{t.thumbnail}</span>
                    <span className="text-[10px] font-medium">{t.name}</span>
                  </button>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="elements" className="mt-0 space-y-2">
              <div className="text-xs font-semibold text-gray-500 mb-2">Ajouter un élément</div>
              {ELEMENT_PRESETS.map((p) => (
                <button
                  key={p.type + p.label}
                  onClick={() => addElement(p)}
                  className="flex items-center gap-2 w-full p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-xs"
                  data-testid={`add-element-${p.type}`}
                >
                  <span className="w-6 h-6 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center text-xs font-bold">{p.icon}</span>
                  <span>{p.label}</span>
                  <Plus className="w-3 h-3 ml-auto text-gray-400" />
                </button>
              ))}
            </TabsContent>

            <TabsContent value="text" className="mt-0 space-y-3">
              {selectedElement ? (
                <>
                  <div className="text-xs font-semibold text-gray-500">Contenu</div>
                  <Textarea
                    value={selectedElement.content || ""}
                    onChange={(e) => updateElementProp(selectedId!, "content", e.target.value)}
                    onBlur={commitStyles}
                    className="text-xs min-h-[60px]"
                    data-testid="input-content"
                  />
                  <div className="text-xs font-semibold text-gray-500">Typographie</div>
                  <div className="flex gap-1">
                    <Select value={selectedElement.styles.fontFamily || "Inter"} onValueChange={(v) => { updateElementStyle(selectedId!, "fontFamily", v); commitStyles(); }}>
                      <SelectTrigger className="text-xs h-8 flex-1" data-testid="select-font"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FONT_OPTIONS.map((f) => <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      value={parseInt(selectedElement.styles.fontSize || "16")}
                      onChange={(e) => updateElementStyle(selectedId!, "fontSize", e.target.value + "px")}
                      onBlur={commitStyles}
                      className="text-xs h-8 w-16"
                      data-testid="input-font-size"
                    />
                    <Button variant={selectedElement.styles.fontWeight === "bold" ? "default" : "outline"} size="sm" className="h-8 w-8 p-0" onClick={() => { updateElementStyle(selectedId!, "fontWeight", selectedElement.styles.fontWeight === "bold" ? "normal" : "bold"); commitStyles(); }} data-testid="btn-bold"><Bold className="w-3 h-3" /></Button>
                    <Button variant={selectedElement.styles.fontStyle === "italic" ? "default" : "outline"} size="sm" className="h-8 w-8 p-0" onClick={() => { updateElementStyle(selectedId!, "fontStyle", selectedElement.styles.fontStyle === "italic" ? "normal" : "italic"); commitStyles(); }} data-testid="btn-italic"><Italic className="w-3 h-3" /></Button>
                    <Button variant={selectedElement.styles.textDecoration === "underline" ? "default" : "outline"} size="sm" className="h-8 w-8 p-0" onClick={() => { updateElementStyle(selectedId!, "textDecoration", selectedElement.styles.textDecoration === "underline" ? "none" : "underline"); commitStyles(); }} data-testid="btn-underline"><Underline className="w-3 h-3" /></Button>
                  </div>
                  <div className="flex gap-1">
                    <Button variant={selectedElement.styles.textAlign === "left" ? "default" : "outline"} size="sm" className="h-8 w-8 p-0" onClick={() => { updateElementStyle(selectedId!, "textAlign", "left"); commitStyles(); }}><AlignLeft className="w-3 h-3" /></Button>
                    <Button variant={selectedElement.styles.textAlign === "center" ? "default" : "outline"} size="sm" className="h-8 w-8 p-0" onClick={() => { updateElementStyle(selectedId!, "textAlign", "center"); commitStyles(); }}><AlignCenter className="w-3 h-3" /></Button>
                    <Button variant={selectedElement.styles.textAlign === "right" ? "default" : "outline"} size="sm" className="h-8 w-8 p-0" onClick={() => { updateElementStyle(selectedId!, "textAlign", "right"); commitStyles(); }}><AlignRight className="w-3 h-3" /></Button>
                  </div>
                </>
              ) : (
                <div className="text-xs text-gray-400 text-center py-8">Sélectionne un élément pour modifier le texte</div>
              )}
            </TabsContent>

            <TabsContent value="styles" className="mt-0 space-y-3">
              {selectedElement ? (
                <>
                  <div className="text-xs font-semibold text-gray-500">Couleurs</div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-12">Fond</span>
                      <input type="color" value={selectedElement.styles.backgroundColor || "#ffffff"} onChange={(e) => updateElementStyle(selectedId!, "backgroundColor", e.target.value)} onBlur={commitStyles} className="w-6 h-6 rounded cursor-pointer border-0" data-testid="input-bg-color" />
                      <Input value={selectedElement.styles.backgroundColor || ""} onChange={(e) => updateElementStyle(selectedId!, "backgroundColor", e.target.value)} onBlur={commitStyles} className="text-xs h-7 flex-1" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-12">Texte</span>
                      <input type="color" value={selectedElement.styles.color || "#000000"} onChange={(e) => updateElementStyle(selectedId!, "color", e.target.value)} onBlur={commitStyles} className="w-6 h-6 rounded cursor-pointer border-0" data-testid="input-text-color" />
                      <Input value={selectedElement.styles.color || ""} onChange={(e) => updateElementStyle(selectedId!, "color", e.target.value)} onBlur={commitStyles} className="text-xs h-7 flex-1" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        onClick={() => { updateElementStyle(selectedId!, "backgroundColor", c); commitStyles(); }}
                        className="w-5 h-5 rounded border border-gray-300 hover:scale-110 transition-transform"
                        style={{ backgroundColor: c }}
                        data-testid={`color-preset-${c.replace("#", "")}`}
                      />
                    ))}
                  </div>
                  <div className="text-xs font-semibold text-gray-500">Bordure & Ombre</div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-12">Rayon</span>
                      <Input value={selectedElement.styles.borderRadius || "0"} onChange={(e) => updateElementStyle(selectedId!, "borderRadius", e.target.value)} onBlur={commitStyles} className="text-xs h-7 flex-1" data-testid="input-border-radius" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-12">Bordure</span>
                      <Input value={selectedElement.styles.border || ""} onChange={(e) => updateElementStyle(selectedId!, "border", e.target.value)} onBlur={commitStyles} className="text-xs h-7 flex-1" placeholder="1px solid #ccc" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-12">Ombre</span>
                      <Input value={selectedElement.styles.boxShadow || ""} onChange={(e) => updateElementStyle(selectedId!, "boxShadow", e.target.value)} onBlur={commitStyles} className="text-xs h-7 flex-1" placeholder="0 2px 8px rgba(0,0,0,0.1)" />
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-gray-500">Espacement</div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-12">Padding</span>
                      <Input value={selectedElement.styles.padding || ""} onChange={(e) => updateElementStyle(selectedId!, "padding", e.target.value)} onBlur={commitStyles} className="text-xs h-7 flex-1" placeholder="20px" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-12">Opacité</span>
                      <Input type="number" min="0" max="1" step="0.1" value={selectedElement.styles.opacity || "1"} onChange={(e) => updateElementStyle(selectedId!, "opacity", e.target.value)} onBlur={commitStyles} className="text-xs h-7 flex-1" />
                    </div>
                  </div>
                  {selectedElement.type === "image" && (
                    <>
                      <div className="text-xs font-semibold text-gray-500">Image</div>
                      <Input value={selectedElement.src || ""} onChange={(e) => updateElementProp(selectedId!, "src", e.target.value)} onBlur={commitStyles} className="text-xs h-7" placeholder="URL de l'image" data-testid="input-img-src" />
                    </>
                  )}
                  {(selectedElement.type === "hero" || selectedElement.type === "container") && (
                    <>
                      <div className="text-xs font-semibold text-gray-500">Fond avancé</div>
                      <Input value={selectedElement.styles.background || ""} onChange={(e) => updateElementStyle(selectedId!, "background", e.target.value)} onBlur={commitStyles} className="text-xs h-7" placeholder="linear-gradient(...) or url(...)" data-testid="input-background" />
                    </>
                  )}
                </>
              ) : (
                <div className="text-xs text-gray-400 text-center py-8">Sélectionne un élément pour modifier les styles</div>
              )}
            </TabsContent>

            <TabsContent value="layers" className="mt-0 space-y-1">
              <div className="text-xs font-semibold text-gray-500 mb-2">Calques ({elements.length})</div>
              {[...elements].reverse().map((el, i) => (
                <div
                  key={el.id}
                  onClick={() => setSelectedId(el.id)}
                  className={`flex items-center gap-1.5 p-1.5 rounded text-xs cursor-pointer transition-colors ${el.id === selectedId ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-300" : "hover:bg-gray-50 dark:hover:bg-gray-700 border border-transparent"}`}
                  data-testid={`layer-${el.id}`}
                >
                  <GripVertical className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  <span className="flex-1 truncate text-[11px]">{el.name || el.type}</span>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={(e) => { e.stopPropagation(); updateElementProp(el.id, "visible", el.visible !== false ? false : true); }}>
                    {el.visible !== false ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5 text-gray-400" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={(e) => { e.stopPropagation(); updateElementProp(el.id, "locked", !el.locked); }}>
                    {el.locked ? <Lock className="w-2.5 h-2.5 text-orange-400" /> : <Unlock className="w-2.5 h-2.5 text-gray-400" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={(e) => { e.stopPropagation(); moveLayer(el.id, "up"); }} data-testid={`layer-up-${el.id}`}><ChevronUp className="w-2.5 h-2.5" /></Button>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={(e) => { e.stopPropagation(); moveLayer(el.id, "down"); }} data-testid={`layer-down-${el.id}`}><ChevronDown className="w-2.5 h-2.5" /></Button>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400 hover:text-red-600" onClick={(e) => { e.stopPropagation(); deleteElement(el.id); }} data-testid={`layer-delete-${el.id}`}><Trash2 className="w-2.5 h-2.5" /></Button>
                </div>
              ))}
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Canvas + Toolbar */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top toolbar */}
        <div className="h-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-3 gap-2" data-testid="editor-toolbar">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={undo} disabled={historyIndex <= 0} data-testid="btn-undo"><Undo2 className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={redo} disabled={historyIndex >= history.length - 1} data-testid="btn-redo"><Redo2 className="w-3.5 h-3.5" /></Button>
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />
          {selectedId && (
            <>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => duplicateElement(selectedId)} data-testid="btn-duplicate"><Copy className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400" onClick={() => deleteElement(selectedId)} data-testid="btn-delete"><Trash2 className="w-3.5 h-3.5" /></Button>
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />
            </>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[10px] text-gray-500">{Math.round(zoom * 100)}%</span>
            <input type="range" min="20" max="150" value={zoom * 100} onChange={(e) => setZoom(Number(e.target.value) / 100)} className="w-20 h-1 accent-blue-500" data-testid="zoom-slider" />
          </div>
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={exportToHtml} data-testid="btn-export">
            <Code2 className="w-3 h-3" /> Export HTML
          </Button>
          {onRequestAI && (
            <Button variant="default" size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700" onClick={() => onRequestAI("Génère le code pour ce design", elements)} data-testid="btn-send-to-ulysse">
              <Send className="w-3 h-3" /> Envoyer à Ulysse
            </Button>
          )}
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-auto bg-gray-200 dark:bg-gray-900 relative" onMouseMove={handleCanvasMouseMove} onMouseUp={handleCanvasMouseUp} onMouseLeave={handleCanvasMouseUp} onClick={() => setSelectedId(null)}>
          <div className="p-8 flex justify-center" style={{ minWidth: canvasWidth * zoom + 80 }}>
            <div
              ref={canvasRef}
              className="relative bg-white shadow-xl"
              style={{
                width: canvasWidth,
                height: canvasHeight,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                backgroundImage: showGrid ? "radial-gradient(circle, #ddd 1px, transparent 1px)" : "none",
                backgroundSize: showGrid ? "20px 20px" : "none",
              }}
              data-testid="editor-canvas"
              onClick={(e) => e.stopPropagation()}
            >
              {elements.map(renderElement)}
            </div>
          </div>
        </div>

        {/* Properties bar at bottom */}
        {selectedElement && (
          <div className="h-9 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center px-3 gap-3 text-xs text-gray-500" data-testid="editor-properties-bar">
            <span className="font-medium text-gray-700 dark:text-gray-300">{selectedElement.name || selectedElement.type}</span>
            <span>X: <input type="number" value={selectedElement.x} onChange={(e) => updateElementProp(selectedId!, "x", Number(e.target.value))} onBlur={commitStyles} className="w-12 bg-transparent border-b border-gray-300 text-center text-xs" /></span>
            <span>Y: <input type="number" value={selectedElement.y} onChange={(e) => updateElementProp(selectedId!, "y", Number(e.target.value))} onBlur={commitStyles} className="w-12 bg-transparent border-b border-gray-300 text-center text-xs" /></span>
            <span>W: <input type="number" value={selectedElement.width} onChange={(e) => updateElementProp(selectedId!, "width", Number(e.target.value))} onBlur={commitStyles} className="w-12 bg-transparent border-b border-gray-300 text-center text-xs" /></span>
            <span>H: <input type="number" value={selectedElement.height} onChange={(e) => updateElementProp(selectedId!, "height", Number(e.target.value))} onBlur={commitStyles} className="w-12 bg-transparent border-b border-gray-300 text-center text-xs" /></span>
            <Badge variant="outline" className="text-[10px] ml-auto">{selectedElement.type}</Badge>
          </div>
        )}
      </div>
    </div>
  );
}
