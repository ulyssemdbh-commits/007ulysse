import { parseNavigationFromResponse, type NavigationDestination } from "@/hooks/useNavigationRequest";

export interface ResponseProcessorResult {
  imageShown: boolean;
  textShown: boolean;
  navigationSet: boolean;
  markers: string[];
}

export interface DisplayWindow {
  showImage: (url: string, title: string, meta?: { source?: string }) => void;
  showMarkdown: (content: string, title: string) => void;
}

export interface PanelManager {
  openPanel: (panel: string) => void;
}

interface ProcessorOptions {
  fullResponse: string;
  displayWindow: DisplayWindow;
  panels: PanelManager;
  setNavigationDestination: (dest: NavigationDestination | null) => void;
}

async function processImageMarker(
  opts: ProcessorOptions,
  result: ResponseProcessorResult
): Promise<void> {
  const match = opts.fullResponse.match(
    /\[AFFICHER_IMAGE:\s*fileId="([^"]+)"(?:,\s*title="([^"]*)")?\]/
  );
  if (!match) return;

  const fileIdOrName = match[1];
  const title = match[2] || "Image";
  console.log(`[ResponseProcessor] Image marker: fileId="${fileIdOrName}", title="${title}"`);

  const isNumericId = /^\d+$/.test(fileIdOrName);

  if (isNumericId) {
    console.log(`[ResponseProcessor] Using numeric ID: ${fileIdOrName}`);
    opts.displayWindow.showImage(`/api/files/${fileIdOrName}/download`, title, {
      source: "Email attachment",
    });
    result.imageShown = true;
    result.markers.push("AFFICHER_IMAGE");
  } else {
    console.log(`[ResponseProcessor] Filename detected, searching: ${fileIdOrName}`);
    try {
      const filesRes = await fetch("/api/files", { credentials: "include" });
      if (filesRes.ok) {
        const files = await filesRes.json();
        const matchingFile = files.find(
          (f: any) =>
            f.originalName === fileIdOrName ||
            f.filename === fileIdOrName ||
            f.originalName?.includes(fileIdOrName.replace(/\.[^.]+$/, ""))
        );
        if (matchingFile) {
          console.log(`[ResponseProcessor] Found file by name: ID=${matchingFile.id}`);
          opts.displayWindow.showImage(
            `/api/files/${matchingFile.id}/download`,
            title,
            { source: "Email attachment" }
          );
          result.imageShown = true;
          result.markers.push("AFFICHER_IMAGE");
        } else {
          console.warn(`[ResponseProcessor] No file found matching: ${fileIdOrName}`);
        }
      }
    } catch (err) {
      console.error("[ResponseProcessor] Error searching for file:", err);
    }
  }
}

function processTextMarker(
  opts: ProcessorOptions,
  result: ResponseProcessorResult
): void {
  const match = opts.fullResponse.match(
    /\[AFFICHER_TEXTE:\s*title="([^"]*)"(?:,\s*content="([^"]*)")?\]/
  );
  if (!match) return;

  const title = match[1] || "Analyse";
  const content = match[2] || "";
  console.log(`[ResponseProcessor] Text marker: title="${title}"`);
  opts.displayWindow.showMarkdown(content, title);
  result.textShown = true;
  result.markers.push("AFFICHER_TEXTE");
}

function processNavigationMarker(
  opts: ProcessorOptions,
  result: ResponseProcessorResult
): void {
  const navigationAddress = parseNavigationFromResponse(opts.fullResponse);
  if (!navigationAddress) return;

  console.log(`[ResponseProcessor] Navigation marker: ${navigationAddress}`);
  opts.setNavigationDestination({ address: navigationAddress });
  opts.panels.openPanel("geolocation");
  result.navigationSet = true;
  result.markers.push("NAVIGATION");
}

export async function processAssistantResponse(
  opts: ProcessorOptions
): Promise<ResponseProcessorResult> {
  const result: ResponseProcessorResult = {
    imageShown: false,
    textShown: false,
    navigationSet: false,
    markers: [],
  };

  if (!opts.fullResponse?.trim()) return result;

  const processors = [
    processImageMarker(opts, result),
    Promise.resolve(processTextMarker(opts, result)),
    Promise.resolve(processNavigationMarker(opts, result)),
  ];

  await Promise.allSettled(processors);

  if (result.markers.length > 0) {
    console.log(`[ResponseProcessor] Processed: ${result.markers.join(", ")}`);
  }

  return result;
}

export function cleanResponseForTTS(response: string): string {
  return response
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[AFFICHER_IMAGE:[^\]]*\]/g, "")
    .replace(/\[AFFICHER_TEXTE:[^\]]*\]/g, "")
    .replace(/\[NAVIGATION:[^\]]*\]/g, "")
    .replace(/[#*_`]/g, "")
    .replace(/\n+/g, " ")
    .trim();
}
