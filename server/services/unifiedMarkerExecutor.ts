/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * UNIFIED MARKER EXECUTOR V2 - CENTRALIZED ACTION EXECUTION
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This service centralizes the execution of ALL action markers from AI responses.
 * It provides:
 * - Single point of entry for all marker parsing and execution
 * - Consistent error handling and logging
 * - Action tracking for analytics
 * - Parallel execution where safe
 * - Result aggregation and reporting
 * 
 * Supported Marker Types:
 * - Email: EMAIL_ENVOYÉ, EMAIL_AVEC_PDF, EMAIL_AVEC_WORD, RÉPONSE_ENVOYÉE
 * - Todoist: TODOIST_CREER, TODOIST_FAIT, TODOIST_TACHES
 * - Kanban: KANBAN_CREER, KANBAN_MODIFIER, KANBAN_SUPPRIMER
 * - Images: RECHERCHE_IMAGES, RECHERCHE_VISAGE, GENERER_IMAGE
 * - Integration: SPOTIFY_*, DOMOTIQUE_*, NAVIGATION_*
 * - Drive/Notion/Calendar: Via respective action services
 */

import { emailActionService } from "./emailActionService";
import { parseTodoistActions, executeActions as executeTodoistActions } from "./todoistActionService";
import { parseKanbanActions, executeKanbanActions } from "./kanbanActionService";
import { imageActionService } from "./imageActionService";
import { faceRecognitionActionService } from "./faceRecognitionActionService";
import { integrationActionService } from "./integrationActionService";
import { driveActionService } from "./driveActionService";
import { notionActionService } from "./notionActionService";
import { actionFirstOrchestrator, PersonaType, ActionExecutionResult } from "./actionFirstOrchestrator";
import { broadcastToUser } from "./realtimeSync";

export interface MarkerExecutionConfig {
  userId: number;
  persona: PersonaType;
  isOwner: boolean;
  threadId?: number;
  enableParallelExecution?: boolean;
  broadcastResults?: boolean;
}

export interface MarkerParseResult {
  type: string;
  raw: string;
  parsed: any;
  valid: boolean;
  errors: string[];
}

export interface ExecutionSummary {
  totalMarkersDetected: number;
  totalExecuted: number;
  successful: number;
  failed: number;
  skipped: number;
  executionTimeMs: number;
  results: Array<{
    type: string;
    marker: string;
    success: boolean;
    result?: any;
    error?: string;
  }>;
}

type MarkerType = 
  | 'email' 
  | 'todoist' 
  | 'kanban' 
  | 'image_search' 
  | 'face_recognition'
  | 'image_generation'
  | 'integration'
  | 'drive'
  | 'notion'
  | 'domotique'
  | 'spotify'
  | 'matchendirect';

interface DetectedMarker {
  type: MarkerType;
  raw: string;
  startIndex: number;
  endIndex: number;
}

class UnifiedMarkerExecutor {
  private readonly MARKER_PATTERNS: Record<MarkerType, RegExp[]> = {
    email: [
      /\[EMAIL_ENVOYÉ\s*:[^\]]+\]/gi,
      /\[EMAIL_AVEC_PDF\s*:[^\]]*(?:\][^\]]*)*\]/gi,
      /\[EMAIL_AVEC_WORD\s*:[^\]]*(?:\][^\]]*)*\]/gi,
      /\[RÉPONSE_ENVOYÉE\s*:[^\]]+\]/gi,
      /\[ACTUALISER_EMAILS\]/gi,
      /\[LIRE_BOITE_MAIL[^\]]*\]/gi,
    ],
    todoist: [
      /\[TODOIST_CREER\s*:[^\]]+\]/gi,
      /\[TODOIST_FAIT\s*:[^\]]+\]/gi,
      /\[TODOIST_TACHES[^\]]*\]/gi,
      /\[TODOIST_AUJOURD'?HUI\]/gi,
      /\[TODOIST_RETARD\]/gi,
      /\[TODOIST_PROJETS\]/gi,
      /\[TODOIST_RESUME\]/gi,
    ],
    kanban: [
      /\[KANBAN_CREER\s*:[^\]]+\]/gi,
      /\[KANBAN_MODIFIER\s*:[^\]]+\]/gi,
      /\[KANBAN_SUPPRIMER\s*:[^\]]+\]/gi,
      /\[KANBAN_TACHES[^\]]*\]/gi,
    ],
    image_search: [
      /\[RECHERCHE_IMAGES\s*:[^\]]+\]/gi,
    ],
    face_recognition: [
      /\[RECHERCHE_VISAGE\s*:[^\]]+\]/gi,
      /\[LISTE_PERSONNES_CONNUES\]/gi,
    ],
    image_generation: [
      /\[GENERER_IMAGE\s*:[^\]]+\]/gi,
    ],
    integration: [
      /\[IFTTT\s*:[^\]]+\]/gi,
      /\[WEBHOOK\s*:[^\]]+\]/gi,
    ],
    drive: [
      /\[DRIVE_UPLOAD\s*:[^\]]+\]/gi,
      /\[DRIVE_CREATE\s*:[^\]]+\]/gi,
      /\[DRIVE_LIST[^\]]*\]/gi,
    ],
    notion: [
      /\[NOTION_QUERY\s*:[^\]]+\]/gi,
      /\[NOTION_CREATE\s*:[^\]]+\]/gi,
      /\[NOTION_UPDATE\s*:[^\]]+\]/gi,
    ],
    domotique: [
      /\[DOMOTIQUE\s*:[^\]]+\]/gi,
      /\[LUMIERE\s*:[^\]]+\]/gi,
      /\[SCENE\s*:[^\]]+\]/gi,
    ],
    spotify: [
      /\[SPOTIFY_PLAY\s*:[^\]]*\]/gi,
      /\[SPOTIFY_PAUSE\]/gi,
      /\[SPOTIFY_NEXT\]/gi,
      /\[SPOTIFY_PREVIOUS\]/gi,
      /\[SPOTIFY_VOLUME\s*:[^\]]+\]/gi,
      /\[SPOTIFY_SEARCH\s*:[^\]]+\]/gi,
    ],
    matchendirect: [
      /\[MATCHENDIRECT\s*:[^\]]+\]/gi,
      /\[MATCHS_DU_JOUR[^\]]*\]/gi,
      /\[CALENDRIER_FOOT\s*:[^\]]+\]/gi,
      /\[RESULTATS_FOOT\s*:[^\]]+\]/gi,
    ],
  };

  detectAllMarkers(response: string): DetectedMarker[] {
    const markers: DetectedMarker[] = [];
    
    for (const [type, patterns] of Object.entries(this.MARKER_PATTERNS) as [MarkerType, RegExp[]][]) {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(response)) !== null) {
          markers.push({
            type,
            raw: match[0],
            startIndex: match.index,
            endIndex: match.index + match[0].length
          });
        }
      }
    }

    markers.sort((a, b) => a.startIndex - b.startIndex);
    
    return markers;
  }

  async executeAllMarkers(
    response: string, 
    config: MarkerExecutionConfig
  ): Promise<ExecutionSummary> {
    const startTime = Date.now();
    const detectedMarkers = this.detectAllMarkers(response);
    
    const summary: ExecutionSummary = {
      totalMarkersDetected: detectedMarkers.length,
      totalExecuted: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      executionTimeMs: 0,
      results: []
    };

    if (detectedMarkers.length === 0) {
      summary.executionTimeMs = Date.now() - startTime;
      return summary;
    }

    console.log(`[UnifiedMarker] Detected ${detectedMarkers.length} markers in response for user ${config.userId}`);

    const markersByType = new Map<MarkerType, DetectedMarker[]>();
    for (const marker of detectedMarkers) {
      if (!markersByType.has(marker.type)) {
        markersByType.set(marker.type, []);
      }
      markersByType.get(marker.type)!.push(marker);
    }

    const executionPromises: Promise<void>[] = [];

    for (const [type, markers] of Array.from(markersByType.entries())) {
      const executeType = async () => {
        for (const marker of markers) {
          const markerStartTime = Date.now();
          try {
            const result = await this.executeMarkerByType(type, marker.raw, config);
            const executionTimeMs = Date.now() - markerStartTime;
            
            summary.totalExecuted++;
            if (result.success) {
              summary.successful++;
            } else {
              summary.failed++;
            }
            
            summary.results.push({
              type,
              marker: marker.raw.substring(0, 100),
              success: result.success,
              result: result.data,
              error: result.error
            });

            actionFirstOrchestrator.recordActionExecution({
              success: result.success,
              actionType: type,
              marker: marker.raw,
              executedAt: new Date(),
              executionTimeMs,
              error: result.error,
              resultData: result.data
            });

          } catch (error: any) {
            summary.totalExecuted++;
            summary.failed++;
            summary.results.push({
              type,
              marker: marker.raw.substring(0, 100),
              success: false,
              error: error.message
            });
            console.error(`[UnifiedMarker] Error executing ${type} marker:`, error.message);
          }
        }
      };

      if (config.enableParallelExecution) {
        executionPromises.push(executeType());
      } else {
        await executeType();
      }
    }

    if (config.enableParallelExecution && executionPromises.length > 0) {
      await Promise.all(executionPromises);
    }

    summary.executionTimeMs = Date.now() - startTime;

    if (config.broadcastResults && summary.totalExecuted > 0) {
      broadcastToUser(config.userId, {
        type: 'action.execution.summary',
        userId: config.userId,
        data: {
          totalExecuted: summary.totalExecuted,
          successful: summary.successful,
          failed: summary.failed,
          results: summary.results.slice(0, 10)
        },
        timestamp: Date.now()
      });
    }

    console.log(`[UnifiedMarker] Execution complete: ${summary.successful}/${summary.totalExecuted} successful in ${summary.executionTimeMs}ms`);

    return summary;
  }

  private async executeMarkerByType(
    type: MarkerType, 
    marker: string, 
    config: MarkerExecutionConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    // ═══════════════════════════════════════════════════════════════════════════
    // PERSONA/OWNER GATING - Enforce access restrictions based on persona
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Alfred (external) - BLOCK ALL action markers (external users require confirmation)
    // Alfred can only receive read-only responses, never execute actions automatically
    if (config.persona === 'alfred') {
      console.log(`[UnifiedMarker] BLOCKED ${type} for Alfred - external users cannot execute actions without confirmation`);
      return { success: false, error: `External users cannot execute actions automatically. Confirmation required.` };
    }
    
    // Owner-only actions - includes all sensitive data access
    const ownerOnlyActions: MarkerType[] = [
      'kanban',           // Personal task management
      'drive',            // Google Drive file management
      'notion',           // Notion knowledge base
      'domotique',        // Smart home control
      'integration',      // IFTTT/webhooks
      'face_recognition', // Personal face recognition
      'image_generation'  // Image generation (costly)
    ];
    if (ownerOnlyActions.includes(type) && !config.isOwner) {
      console.log(`[UnifiedMarker] Skipping ${type} for non-owner (owner-only action)`);
      return { success: false, error: `Action ${type} requires owner privileges` };
    }
    
    // Family actions - allowed for Ulysse (owner) and Iris (family)
    // Includes: email, todoist, spotify, image_search

    switch (type) {
      case 'email':
        return this.executeEmailMarker(marker, config);
      
      case 'todoist':
        return this.executeTodoistMarker(marker, config);
      
      case 'kanban':
        return this.executeKanbanMarker(marker, config);
      
      case 'image_search':
      case 'face_recognition':
      case 'image_generation':
        return this.executeImageMarker(type, marker, config);
      
      case 'integration':
      case 'domotique':
      case 'spotify':
        return this.executeIntegrationMarker(marker, config);
      
      case 'drive':
        return this.executeDriveMarker(marker, config);
      
      case 'notion':
        return this.executeNotionMarker(marker, config);
      
      case 'matchendirect':
        return this.executeMatchEndirectMarker(marker, config);
      
      default:
        return { success: false, error: `Unknown marker type: ${type}` };
    }
  }

  private async executeEmailMarker(
    marker: string, 
    config: MarkerExecutionConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const actions = emailActionService.parseEmailActions(marker);
      if (actions.length === 0) {
        return { success: false, error: 'No valid email action parsed' };
      }

      const persona = config.persona === 'alfred' ? 'alfred' : config.isOwner ? 'ulysse' : 'iris';
      
      // Separate preview actions from send actions (restore preview behavior)
      const previewActions = actions.filter((a: any) => a.type === 'previewPdf' || a.type === 'previewWord');
      const sendActions = actions.filter((a: any) => a.type !== 'previewPdf' && a.type !== 'previewWord');
      
      // Handle preview actions - format for user display and broadcast
      const previewResults: any[] = [];
      for (const previewAction of previewActions) {
        try {
          const preview = emailActionService.formatPreviewForUser(previewAction);
          console.log(`[UnifiedMarker] Generated preview for ${previewAction.type}: ${previewAction.pdfTitle || previewAction.wordTitle}`);
          previewResults.push({ success: true, action: previewAction, preview });
          
          // Broadcast preview to user via WebSocket
          broadcastToUser(config.userId, {
            type: 'email.preview',
            userId: config.userId,
            data: {
              previewType: previewAction.type,
              title: previewAction.pdfTitle || previewAction.wordTitle,
              preview
            },
            timestamp: Date.now()
          });
        } catch (err: any) {
          previewResults.push({ success: false, action: previewAction, error: err.message });
        }
      }
      
      // Execute actual send actions
      let sendResults: any[] = [];
      if (sendActions.length > 0) {
        sendResults = await emailActionService.executeActions(sendActions, persona as any, config.userId);
      }
      
      const allResults = [...previewResults, ...sendResults];
      const allSuccess = allResults.every((r: any) => r.success);
      return {
        success: allSuccess,
        data: allResults,
        error: allSuccess ? undefined : allResults.find((r: any) => !r.success)?.error
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeTodoistMarker(
    marker: string, 
    config: MarkerExecutionConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const actions = parseTodoistActions(marker);
      if (actions.length === 0) {
        return { success: false, error: 'No valid Todoist action parsed' };
      }

      const results = await executeTodoistActions(actions);
      const allSuccess = results.every(r => r.success);
      return {
        success: allSuccess,
        data: results,
        error: allSuccess ? undefined : results.find(r => !r.success)?.error
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeKanbanMarker(
    marker: string, 
    config: MarkerExecutionConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const actions = parseKanbanActions(marker);
      if (actions.length === 0) {
        return { success: false, error: 'No valid Kanban action parsed' };
      }

      const results = await executeKanbanActions(actions, config.userId);
      const allSuccess = results.every(r => r.success);
      return {
        success: allSuccess,
        data: results,
        error: allSuccess ? undefined : results.find(r => !r.success)?.error
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeImageMarker(
    type: MarkerType,
    marker: string, 
    config: MarkerExecutionConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      if (type === 'face_recognition') {
        const actions = faceRecognitionActionService.parseFaceActions(marker);
        if (actions.length === 0) {
          return { success: false, error: 'No valid face recognition action parsed' };
        }
        const results = await faceRecognitionActionService.executeActions(actions, config.userId);
        return { success: true, data: results };
      }

      const actions = imageActionService.parseImageActions(marker);
      if (actions.length === 0) {
        return { success: false, error: 'No valid image action parsed' };
      }
      const results = await imageActionService.executeActions(actions, config.userId);
      return { success: true, data: results };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeIntegrationMarker(
    marker: string, 
    config: MarkerExecutionConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const actions = integrationActionService.parseActions(marker);
      if (actions.length === 0) {
        return { success: false, error: 'No valid integration action parsed' };
      }

      const results = await integrationActionService.executeActions(actions, config.userId, config.isOwner);
      const allSuccess = results.every(r => r.success);
      return {
        success: allSuccess,
        data: results,
        error: allSuccess ? undefined : results.find(r => !r.success)?.error
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeDriveMarker(
    marker: string, 
    config: MarkerExecutionConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const actions = driveActionService.parseDriveActions(marker);
      if (actions.length === 0) {
        return { success: false, error: 'No valid Drive action parsed' };
      }

      const results = await driveActionService.executeActions(actions);
      return { success: true, data: results };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeNotionMarker(
    marker: string, 
    config: MarkerExecutionConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const actions = notionActionService.parseNotionActions(marker);
      if (actions.length === 0) {
        return { success: false, error: 'No valid Notion action parsed' };
      }

      const results = await notionActionService.executeActions(actions);
      return { success: true, data: results };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeMatchEndirectMarker(
    marker: string,
    config: MarkerExecutionConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const matchEndirectService = await import('./matchEndirectService');
      
      let date: string | undefined;
      let league: string = 'all';
      
      const dateMatch = marker.match(/date\s*[:=]\s*(\d{2}-\d{2}-\d{4})/i);
      if (dateMatch) date = dateMatch[1];
      
      const leagueMatch = marker.match(/league\s*[:=]\s*(ligue1|laliga|premierLeague|bundesliga|serieA|all)/i);
      if (leagueMatch) league = leagueMatch[1];
      
      if (marker.includes('MATCHS_DU_JOUR') && !date) {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        date = `${day}-${month}-${year}`;
      }
      
      const result = await matchEndirectService.fetchMatchEndirect(date || '');
      
      let matches = result.big5Matches;
      if (league !== 'all' && league in result.byLeague) {
        matches = result.byLeague[league as keyof typeof result.byLeague];
      }
      
      console.log(`[UnifiedMarker] MatchEnDirect: ${matches.length} Big 5 matches for ${date || 'today'}`);
      
      return {
        success: true,
        data: {
          date: result.date,
          totalMatches: result.totalMatches,
          big5Matches: matches.length,
          byLeague: {
            ligue1: result.byLeague.ligue1.length,
            laliga: result.byLeague.laliga.length,
            premierLeague: result.byLeague.premierLeague.length,
            bundesliga: result.byLeague.bundesliga.length,
            serieA: result.byLeague.serieA.length,
          },
          matches: matches.slice(0, 20).map(m => ({
            competition: m.competition,
            home: m.homeTeam,
            away: m.awayTeam,
            score: m.homeScore !== null && m.awayScore !== null 
              ? `${m.homeScore}-${m.awayScore}` 
              : null,
            status: m.status,
            time: m.time,
          }))
        }
      };
    } catch (error: any) {
      console.error('[UnifiedMarker] MatchEnDirect error:', error);
      return { success: false, error: error.message };
    }
  }

  getMarkerStats(): { byType: Record<string, number>; total: number } {
    const history = actionFirstOrchestrator.getExecutionHistory(500);
    const byType: Record<string, number> = {};
    
    for (const action of history) {
      byType[action.actionType] = (byType[action.actionType] || 0) + 1;
    }

    return {
      byType,
      total: history.length
    };
  }
}

export const unifiedMarkerExecutor = new UnifiedMarkerExecutor();

export default unifiedMarkerExecutor;
