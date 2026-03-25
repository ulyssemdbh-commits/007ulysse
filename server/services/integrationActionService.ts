// Integration Action Service - Detects and executes smart home/music actions from AI responses
import * as spotifyService from "./spotifyService";
import * as tuyaService from "./tuyaService";
import * as iftttService from "./iftttService";
import { smartHomeService, DeviceAction } from "./smartHomeService";
import { db } from "../db";
import { smartScenes } from "@shared/schema";
import { eq, and } from "drizzle-orm";

interface IntegrationAction {
  type: 'spotify' | 'spotify_search' | 'tuya' | 'tuya_color' | 'ifttt' | 'google_announce' | 'alexa_announce' | 'smart_device' | 'scene_activate' | 'room_control';
  action?: string;
  deviceId?: string;
  query?: string;
  searchType?: string;
  eventName?: string;
  message?: string;
  value1?: string;
  value2?: string;
  value3?: string;
  h?: number;
  s?: number;
  v?: number;
  sceneName?: string;
  room?: string;
  roomAction?: string;
}

interface ActionResult {
  success: boolean;
  action: IntegrationAction;
  data?: any;
  error?: string;
}

const INTEGRATION_PATTERNS = {
  // Spotify
  spotify: /\[SPOTIFY:\s*(\w+)(?:\s*,\s*deviceId="([^"]*)")?\]/i,
  spotifySearch: /\[SPOTIFY_SEARCH:\s*query="([^"]+)"\s*,\s*type="([^"]+)"\]/i,
  
  // Tuya
  tuya: /\[TUYA:\s*deviceId="([^"]+)"\s*,\s*action="([^"]+)"\]/i,
  tuyaColor: /\[TUYA_COLOR:\s*deviceId="([^"]+)"\s*,\s*h=(\d+)\s*,\s*s=(\d+)\s*,\s*v=(\d+)\]/i,
  
  // IFTTT
  ifttt: /\[IFTTT:\s*event="([^"]+)"(?:\s*,\s*value1="([^"]*)")?(?:\s*,\s*value2="([^"]*)")?(?:\s*,\s*value3="([^"]*)")?\]/i,
  googleAnnounce: /\[GOOGLE_ANNOUNCE:\s*message="([^"]+)"\]/i,
  alexaAnnounce: /\[ALEXA_ANNOUNCE:\s*message="([^"]+)"\]/i,
  iftttCustom: /\[IFTTT_CUSTOM:\s*event="([^"]+)"(?:\s*,\s*v1="([^"]*)")?(?:\s*,\s*v2="([^"]*)")?(?:\s*,\s*v3="([^"]*)")?\]/i,
  
  // Smart Home (internal)
  smartDevice: /\[SMART_DEVICE:\s*deviceId="([^"]+)"\s*,\s*action="([^"]+)"\]/i,
  sceneActivate: /\[SCENE_ACTIVATE:\s*name="([^"]+)"\]/i,
  roomControl: /\[ROOM_CONTROL:\s*room="([^"]+)"\s*,\s*action="([^"]+)"\]/i,
};

class IntegrationActionService {
  
  parseActions(aiResponse: string): IntegrationAction[] {
    const actions: IntegrationAction[] = [];
    
    // Spotify play/pause/next/prev
    const spotifyMatch = aiResponse.match(INTEGRATION_PATTERNS.spotify);
    if (spotifyMatch) {
      actions.push({
        type: 'spotify',
        action: spotifyMatch[1].toLowerCase(),
        deviceId: spotifyMatch[2] || undefined
      });
    }
    
    // Spotify search
    const spotifySearchMatch = aiResponse.match(INTEGRATION_PATTERNS.spotifySearch);
    if (spotifySearchMatch) {
      actions.push({
        type: 'spotify_search',
        query: spotifySearchMatch[1],
        searchType: spotifySearchMatch[2]
      });
    }
    
    // Tuya device control
    const tuyaMatch = aiResponse.match(INTEGRATION_PATTERNS.tuya);
    if (tuyaMatch) {
      actions.push({
        type: 'tuya',
        deviceId: tuyaMatch[1],
        action: tuyaMatch[2]
      });
    }
    
    // Tuya color
    const tuyaColorMatch = aiResponse.match(INTEGRATION_PATTERNS.tuyaColor);
    if (tuyaColorMatch) {
      actions.push({
        type: 'tuya_color',
        deviceId: tuyaColorMatch[1],
        h: parseInt(tuyaColorMatch[2]),
        s: parseInt(tuyaColorMatch[3]),
        v: parseInt(tuyaColorMatch[4])
      });
    }
    
    // IFTTT trigger
    const iftttMatch = aiResponse.match(INTEGRATION_PATTERNS.ifttt);
    if (iftttMatch) {
      actions.push({
        type: 'ifttt',
        eventName: iftttMatch[1],
        value1: iftttMatch[2] || undefined,
        value2: iftttMatch[3] || undefined,
        value3: iftttMatch[4] || undefined
      });
    }
    
    // Google announce
    const googleMatch = aiResponse.match(INTEGRATION_PATTERNS.googleAnnounce);
    if (googleMatch) {
      actions.push({
        type: 'google_announce',
        message: googleMatch[1]
      });
    }
    
    // Alexa announce
    const alexaMatch = aiResponse.match(INTEGRATION_PATTERNS.alexaAnnounce);
    if (alexaMatch) {
      actions.push({
        type: 'alexa_announce',
        message: alexaMatch[1]
      });
    }
    
    // IFTTT custom
    const iftttCustomMatch = aiResponse.match(INTEGRATION_PATTERNS.iftttCustom);
    if (iftttCustomMatch) {
      actions.push({
        type: 'ifttt',
        eventName: iftttCustomMatch[1],
        value1: iftttCustomMatch[2] || undefined,
        value2: iftttCustomMatch[3] || undefined,
        value3: iftttCustomMatch[4] || undefined
      });
    }
    
    // Smart device
    const smartDeviceMatch = aiResponse.match(INTEGRATION_PATTERNS.smartDevice);
    if (smartDeviceMatch) {
      actions.push({
        type: 'smart_device',
        deviceId: smartDeviceMatch[1],
        action: smartDeviceMatch[2]
      });
    }
    
    // Scene activate
    const sceneMatch = aiResponse.match(INTEGRATION_PATTERNS.sceneActivate);
    if (sceneMatch) {
      actions.push({
        type: 'scene_activate',
        sceneName: sceneMatch[1]
      });
    }
    
    // Room control
    const roomMatch = aiResponse.match(INTEGRATION_PATTERNS.roomControl);
    if (roomMatch) {
      actions.push({
        type: 'room_control',
        room: roomMatch[1],
        roomAction: roomMatch[2]
      });
    }
    
    return actions;
  }
  
  async executeActions(actions: IntegrationAction[], userId: number, isOwner: boolean): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    
    for (const action of actions) {
      try {
        // All integration actions require owner permission
        if (!isOwner) {
          results.push({
            success: false,
            action,
            error: "Seul le propriétaire peut contrôler les appareils connectés"
          });
          continue;
        }
        
        const result = await this.executeAction(action, userId);
        results.push(result);
      } catch (error) {
        console.error(`[INTEGRATION_ACTION] Error executing ${action.type}:`, error);
        results.push({
          success: false,
          action,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    return results;
  }
  
  private async executeAction(action: IntegrationAction, userId: number): Promise<ActionResult> {
    switch (action.type) {
      case 'spotify':
        return this.executeSpotifyAction(action);
        
      case 'spotify_search':
        return this.executeSpotifySearch(action);
        
      case 'tuya':
        return this.executeTuyaAction(action);
        
      case 'tuya_color':
        return this.executeTuyaColor(action);
        
      case 'ifttt':
        return this.executeIftttTrigger(action);
        
      case 'google_announce':
        return this.executeGoogleAnnounce(action);
        
      case 'alexa_announce':
        return this.executeAlexaAnnounce(action);
        
      case 'smart_device':
        return this.executeSmartDevice(action, userId);
        
      case 'scene_activate':
        return this.executeSceneActivate(action, userId);
        
      case 'room_control':
        return this.executeRoomControl(action, userId);
        
      default:
        return { success: false, action, error: `Unknown action type: ${action.type}` };
    }
  }
  
  private async executeSpotifyAction(action: IntegrationAction): Promise<ActionResult> {
    const spotifyAction = action.action?.toLowerCase();
    let success = false;
    
    try {
      switch (spotifyAction) {
        case 'play':
          success = await spotifyService.play({ deviceId: action.deviceId });
          break;
        case 'pause':
          success = await spotifyService.pause(action.deviceId);
          break;
        case 'next':
          success = await spotifyService.nextTrack(action.deviceId);
          break;
        case 'prev':
        case 'previous':
          success = await spotifyService.previousTrack(action.deviceId);
          break;
        case 'shuffle':
          success = await spotifyService.setShuffle(true, action.deviceId);
          break;
        case 'shuffle_off':
          success = await spotifyService.setShuffle(false, action.deviceId);
          break;
        default:
          return { success: false, action, error: `Unknown Spotify action: ${spotifyAction}` };
      }
      
      return { success, action };
    } catch (error) {
      return { success: false, action, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  private async executeSpotifySearch(action: IntegrationAction): Promise<ActionResult> {
    if (!action.query) {
      return { success: false, action, error: "Missing search query" };
    }
    
    try {
      const searchTypes: ('track' | 'album' | 'artist' | 'playlist')[] = 
        action.searchType === 'album' ? ['album'] :
        action.searchType === 'artist' ? ['artist'] :
        action.searchType === 'playlist' ? ['playlist'] : ['track'];
      
      const result = await spotifyService.search(action.query, searchTypes, 5);
      return { success: !!result, action, data: result };
    } catch (error) {
      return { success: false, action, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  private async executeTuyaAction(action: IntegrationAction): Promise<ActionResult> {
    if (!action.deviceId || !action.action) {
      return { success: false, action, error: "Missing deviceId or action" };
    }
    
    try {
      const tuyaAction = action.action.toLowerCase();
      let success = false;
      
      if (tuyaAction === 'on') {
        success = await tuyaService.turnOn(action.deviceId);
      } else if (tuyaAction === 'off') {
        success = await tuyaService.turnOff(action.deviceId);
      } else if (tuyaAction.startsWith('brightness_')) {
        const brightness = parseInt(tuyaAction.replace('brightness_', ''));
        success = await tuyaService.setBrightness(action.deviceId, brightness);
      } else {
        return { success: false, action, error: `Unknown Tuya action: ${tuyaAction}` };
      }
      
      return { success, action };
    } catch (error) {
      return { success: false, action, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  private async executeTuyaColor(action: IntegrationAction): Promise<ActionResult> {
    if (!action.deviceId || action.h === undefined) {
      return { success: false, action, error: "Missing deviceId or color values" };
    }
    
    try {
      const success = await tuyaService.setColor(action.deviceId, action.h, action.s || 100, action.v || 100);
      return { success, action };
    } catch (error) {
      return { success: false, action, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  private async executeIftttTrigger(action: IntegrationAction): Promise<ActionResult> {
    if (!action.eventName) {
      return { success: false, action, error: "Missing event name" };
    }
    
    const result = await iftttService.trigger(action.eventName, action.value1, action.value2, action.value3);
    return { success: result.success, action, error: result.success ? undefined : "IFTTT trigger failed" };
  }
  
  private async executeGoogleAnnounce(action: IntegrationAction): Promise<ActionResult> {
    if (!action.message) {
      return { success: false, action, error: "Missing message" };
    }
    
    // Use IFTTT preset for Google announce
    const result = await iftttService.trigger('google_assistant_say', action.message);
    return { success: result.success, action, error: result.success ? undefined : "Google announce failed" };
  }
  
  private async executeAlexaAnnounce(action: IntegrationAction): Promise<ActionResult> {
    if (!action.message) {
      return { success: false, action, error: "Missing message" };
    }
    
    // Use IFTTT preset for Alexa announce
    const result = await iftttService.trigger('alexa_announce', action.message);
    return { success: result.success, action, error: result.success ? undefined : "Alexa announce failed" };
  }
  
  private async executeSmartDevice(action: IntegrationAction, userId: number): Promise<ActionResult> {
    if (!action.deviceId || !action.action) {
      return { success: false, action, error: "Missing deviceId or action" };
    }
    
    try {
      const deviceAction = action.action.toLowerCase();
      let actionObj: DeviceAction;
      
      if (deviceAction === 'on') {
        actionObj = { type: 'toggle', on: true };
      } else if (deviceAction === 'off') {
        actionObj = { type: 'toggle', on: false };
      } else if (deviceAction.startsWith('brightness_')) {
        const value = parseInt(deviceAction.replace('brightness_', ''));
        actionObj = { type: 'brightness', value };
      } else if (deviceAction.startsWith('temperature_')) {
        const value = parseInt(deviceAction.replace('temperature_', ''));
        actionObj = { type: 'temperature', value };
      } else {
        return { success: false, action, error: `Unknown smart device action: ${deviceAction}` };
      }
      
      const result = await smartHomeService.executeAction(userId, parseInt(action.deviceId), actionObj, 'ai');
      return { success: result.success, action, error: result.error };
    } catch (error) {
      return { success: false, action, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  private async executeSceneActivate(action: IntegrationAction, userId: number): Promise<ActionResult> {
    if (!action.sceneName) {
      return { success: false, action, error: "Missing scene name" };
    }
    
    try {
      // Find scene by name
      const [scene] = await db.select()
        .from(smartScenes)
        .where(and(
          eq(smartScenes.userId, userId),
          eq(smartScenes.name, action.sceneName)
        ))
        .limit(1);
      
      if (!scene) {
        return { success: false, action, error: `Scene "${action.sceneName}" not found` };
      }
      
      const result = await smartHomeService.activateScene(userId, scene.id, 'ai');
      return { success: result.success, action };
    } catch (error) {
      return { success: false, action, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  private async executeRoomControl(action: IntegrationAction, userId: number): Promise<ActionResult> {
    if (!action.room || !action.roomAction) {
      return { success: false, action, error: "Missing room or action" };
    }
    
    try {
      // Room control: find all devices in the room and apply action
      const devices = await smartHomeService.getDevices(userId);
      const roomDevices = devices.filter(d => d.room?.toLowerCase() === action.room?.toLowerCase());
      
      if (roomDevices.length === 0) {
        return { success: false, action, error: `No devices found in room "${action.room}"` };
      }
      
      let actionObj: DeviceAction;
      const roomAction = action.roomAction.toLowerCase();
      
      if (roomAction === 'on' || roomAction === 'allume') {
        actionObj = { type: 'toggle', on: true };
      } else if (roomAction === 'off' || roomAction === 'éteins') {
        actionObj = { type: 'toggle', on: false };
      } else {
        return { success: false, action, error: `Unknown room action: ${roomAction}` };
      }
      
      let successCount = 0;
      for (const device of roomDevices) {
        const result = await smartHomeService.executeAction(userId, device.id, actionObj, 'ai');
        if (result.success) successCount++;
      }
      
      return { 
        success: successCount > 0, 
        action, 
        data: { controlled: successCount, total: roomDevices.length }
      };
    } catch (error) {
      return { success: false, action, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  formatResult(result: ActionResult): string {
    if (!result.success) {
      return `\n\n⚠️ **Erreur ${result.action.type}:** ${result.error}`;
    }
    
    switch (result.action.type) {
      case 'spotify':
        return `\n\n🎵 **Spotify:** ${result.action.action} exécuté`;
      case 'spotify_search':
        const tracks = result.data?.tracks?.items || [];
        if (tracks.length > 0) {
          const list = tracks.slice(0, 3).map((t: any) => `- ${t.name} - ${t.artists?.[0]?.name}`).join('\n');
          return `\n\n🔍 **Résultats Spotify:**\n${list}`;
        }
        return `\n\n🔍 **Spotify:** Aucun résultat trouvé`;
      case 'tuya':
      case 'tuya_color':
        return `\n\n💡 **Tuya:** Appareil ${result.action.deviceId} - ${result.action.action || 'couleur'} appliqué`;
      case 'ifttt':
        return `\n\n⚡ **IFTTT:** Événement "${result.action.eventName}" déclenché`;
      case 'google_announce':
        return `\n\n🔊 **Google Home:** Annonce envoyée`;
      case 'alexa_announce':
        return `\n\n🔊 **Alexa:** Annonce envoyée`;
      case 'smart_device':
        return `\n\n🏠 **Smart Home:** Appareil contrôlé`;
      case 'scene_activate':
        return `\n\n🎭 **Scène:** "${result.action.sceneName}" activée`;
      case 'room_control':
        const roomData = result.data as { controlled: number; total: number } | undefined;
        return `\n\n🏠 **Pièce:** ${result.action.room} - ${roomData?.controlled}/${roomData?.total} appareils contrôlés`;
      default:
        return `\n\n✅ **Action exécutée**`;
    }
  }
}

export const integrationActionService = new IntegrationActionService();
