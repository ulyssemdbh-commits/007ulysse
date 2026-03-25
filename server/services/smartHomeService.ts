/**
 * Smart Home Service - Phase 1 Domotique
 * 
 * Supports:
 * - Philips Hue lights
 * - HomeKit devices (future)
 * - Netatmo thermostats (future)
 * - Custom devices via HTTP/REST
 * 
 * Features:
 * - Device CRUD operations
 * - Scene management
 * - Action execution (toggle, brightness, color, temperature)
 * - Behavior event logging (for Phase 3 ML)
 */

import { db } from "../db";
import { smartDevices, smartScenes, userBehaviorEvents } from "@shared/schema";
import type { 
  SmartDevice, InsertSmartDevice, 
  SmartScene, InsertSmartScene,
  InsertUserBehaviorEvent 
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { encryptionService } from "./encryption";
import crypto from "crypto";
import { globalOptimizerService } from "./globalOptimizerService";

// Device action types
export type DeviceAction = 
  | { type: "toggle"; on: boolean }
  | { type: "brightness"; value: number } // 0-100
  | { type: "color"; value: string } // hex color
  | { type: "temperature"; value: number } // celsius
  | { type: "scene"; sceneId: number };

// Scene action definition
export interface SceneAction {
  deviceId: number;
  action: string; // "toggle", "brightness", "color", "temperature"
  params: Record<string, any>;
}

class SmartHomeService {
  
  // ============================================================================
  // DEVICES CRUD (cached via globalOptimizerService)
  // ============================================================================
  
  async getDevices(userId: number): Promise<SmartDevice[]> {
    return globalOptimizerService.getOrFetch(
      `devices:${userId}`,
      "default",
      async () => {
        return db.select()
          .from(smartDevices)
          .where(eq(smartDevices.userId, userId))
          .orderBy(smartDevices.room, smartDevices.name);
      },
      { customTTL: 30 * 1000 } // 30s TTL for device states
    );
  }
  
  invalidateDeviceCache(userId: number) {
    globalOptimizerService.invalidate("default", `devices:${userId}`);
  }
  
  async getDevice(userId: number, deviceId: number): Promise<SmartDevice | null> {
    const [device] = await db.select()
      .from(smartDevices)
      .where(and(
        eq(smartDevices.id, deviceId),
        eq(smartDevices.userId, userId)
      ));
    return device || null;
  }
  
  async getDevicesByRoom(userId: number, room: string): Promise<SmartDevice[]> {
    return db.select()
      .from(smartDevices)
      .where(and(
        eq(smartDevices.userId, userId),
        eq(smartDevices.room, room)
      ))
      .orderBy(smartDevices.name);
  }
  
  async addDevice(userId: number, data: Partial<InsertSmartDevice>): Promise<SmartDevice> {
    const encryptedToken = data.accessToken 
      ? encryptionService.encrypt(data.accessToken) 
      : undefined;
    
    const deviceData: InsertSmartDevice = {
      userId,
      name: data.name || "Nouvel appareil",
      type: data.type || "light",
      room: data.room,
      vendor: data.vendor,
      externalId: data.externalId,
      capabilities: data.capabilities || ["toggle"],
      state: data.state || { on: false },
      ipAddress: data.ipAddress,
      macAddress: data.macAddress,
      accessToken: encryptedToken,
      isOnline: data.isOnline ?? false,
      isActive: data.isActive ?? true,
    };
    
    const [device] = await db.insert(smartDevices)
      .values(deviceData)
      .returning();
    
    console.log(`[SmartHome] Added device: ${device.name} (${device.type}) in ${device.room}`);
    return device;
  }
  
  async updateDevice(
    userId: number, 
    deviceId: number, 
    updates: Partial<SmartDevice>
  ): Promise<SmartDevice | null> {
    const processedUpdates = { ...updates };
    
    if (updates.accessToken) {
      processedUpdates.accessToken = encryptionService.encrypt(updates.accessToken);
    }
    
    processedUpdates.updatedAt = new Date();
    
    const [device] = await db.update(smartDevices)
      .set(processedUpdates)
      .where(and(
        eq(smartDevices.id, deviceId),
        eq(smartDevices.userId, userId)
      ))
      .returning();
    
    return device || null;
  }
  
  async deleteDevice(userId: number, deviceId: number): Promise<boolean> {
    const result = await db.delete(smartDevices)
      .where(and(
        eq(smartDevices.id, deviceId),
        eq(smartDevices.userId, userId)
      ))
      .returning();
    
    return result.length > 0;
  }
  
  // ============================================================================
  // SCENES CRUD
  // ============================================================================
  
  async getScenes(userId: number): Promise<SmartScene[]> {
    return db.select()
      .from(smartScenes)
      .where(eq(smartScenes.userId, userId))
      .orderBy(smartScenes.name);
  }
  
  async getScene(userId: number, sceneId: number): Promise<SmartScene | null> {
    const [scene] = await db.select()
      .from(smartScenes)
      .where(and(
        eq(smartScenes.id, sceneId),
        eq(smartScenes.userId, userId)
      ));
    return scene || null;
  }
  
  async addScene(userId: number, data: Partial<InsertSmartScene>): Promise<SmartScene> {
    const sceneData: InsertSmartScene = {
      userId,
      name: data.name || "Nouvelle scène",
      description: data.description,
      icon: data.icon || "home",
      color: data.color || "#3B82F6",
      actions: data.actions || [],
      trigger: data.trigger || "manual",
      triggerConfig: data.triggerConfig || {},
      isActive: data.isActive ?? true,
    };
    
    const [scene] = await db.insert(smartScenes)
      .values(sceneData)
      .returning();
    
    console.log(`[SmartHome] Added scene: ${scene.name}`);
    return scene;
  }
  
  async updateScene(
    userId: number, 
    sceneId: number, 
    updates: Partial<SmartScene>
  ): Promise<SmartScene | null> {
    const processedUpdates = { ...updates, updatedAt: new Date() };
    
    const [scene] = await db.update(smartScenes)
      .set(processedUpdates)
      .where(and(
        eq(smartScenes.id, sceneId),
        eq(smartScenes.userId, userId)
      ))
      .returning();
    
    return scene || null;
  }
  
  async deleteScene(userId: number, sceneId: number): Promise<boolean> {
    const result = await db.delete(smartScenes)
      .where(and(
        eq(smartScenes.id, sceneId),
        eq(smartScenes.userId, userId)
      ))
      .returning();
    
    return result.length > 0;
  }
  
  // ============================================================================
  // ACTION EXECUTION
  // ============================================================================
  
  async executeAction(
    userId: number,
    deviceId: number,
    action: DeviceAction,
    source: string = "manual"
  ): Promise<{ success: boolean; newState?: Record<string, any>; error?: string }> {
    const device = await this.getDevice(userId, deviceId);
    if (!device) {
      return { success: false, error: "Appareil non trouvé" };
    }
    
    const previousState = device.state as Record<string, any>;
    let newState = { ...previousState };
    
    try {
      switch (action.type) {
        case "toggle":
          newState.on = action.on;
          break;
        case "brightness":
          newState.brightness = Math.max(0, Math.min(100, action.value));
          break;
        case "color":
          newState.color = action.value;
          break;
        case "temperature":
          newState.temperature = action.value;
          break;
        default:
          return { success: false, error: "Action non supportée" };
      }
      
      // Update device state in database
      await db.update(smartDevices)
        .set({ 
          state: newState, 
          lastStateAt: new Date(),
          updatedAt: new Date() 
        })
        .where(eq(smartDevices.id, deviceId));
      
      // Log behavior event for Phase 3 ML
      await this.logBehaviorEvent(userId, {
        eventType: "device_action",
        eventSource: source,
        targetType: "device",
        targetId: deviceId,
        targetName: device.name,
        context: this.buildContext(),
        previousState,
        newState,
      });
      
      console.log(`[SmartHome] Executed ${action.type} on ${device.name}: ${JSON.stringify(newState)}`);
      return { success: true, newState };
      
    } catch (error: any) {
      console.error(`[SmartHome] Action failed:`, error);
      return { success: false, error: error.message };
    }
  }
  
  async activateScene(
    userId: number,
    sceneId: number,
    source: string = "manual"
  ): Promise<{ success: boolean; results: Array<{ deviceId: number; success: boolean; error?: string }> }> {
    const scene = await this.getScene(userId, sceneId);
    if (!scene) {
      return { success: false, results: [] };
    }
    
    const actions = scene.actions as SceneAction[];
    const results: Array<{ deviceId: number; success: boolean; error?: string }> = [];
    
    for (const sceneAction of actions) {
      const actionObj = this.parseSceneAction(sceneAction);
      if (actionObj) {
        const result = await this.executeAction(userId, sceneAction.deviceId, actionObj, source);
        results.push({ 
          deviceId: sceneAction.deviceId, 
          success: result.success, 
          error: result.error 
        });
      }
    }
    
    // Update scene activation stats
    await db.update(smartScenes)
      .set({ 
        lastActivatedAt: new Date(),
        activationCount: (scene.activationCount || 0) + 1 
      })
      .where(eq(smartScenes.id, sceneId));
    
    // Log behavior event
    await this.logBehaviorEvent(userId, {
      eventType: "scene_activation",
      eventSource: source,
      targetType: "scene",
      targetId: sceneId,
      targetName: scene.name,
      context: this.buildContext(),
      previousState: {},
      newState: { activated: true },
    });
    
    const allSuccess = results.every(r => r.success);
    console.log(`[SmartHome] Scene "${scene.name}" activated: ${allSuccess ? "OK" : "partial"}`);
    
    return { success: allSuccess, results };
  }
  
  // ============================================================================
  // BEHAVIOR LOGGING (Phase 3 preparation)
  // ============================================================================
  
  private async logBehaviorEvent(userId: number, event: Omit<InsertUserBehaviorEvent, 'userId'>): Promise<void> {
    try {
      await db.insert(userBehaviorEvents).values({
        userId,
        ...event,
      });
    } catch (error) {
      console.error(`[SmartHome] Failed to log behavior event:`, error);
    }
  }
  
  private buildContext(): Record<string, any> {
    const now = new Date();
    return {
      dayOfWeek: now.getDay(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      isWeekend: now.getDay() === 0 || now.getDay() === 6,
      timeOfDay: this.getTimeOfDay(now.getHours()),
    };
  }
  
  private getTimeOfDay(hour: number): string {
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    if (hour >= 17 && hour < 21) return "evening";
    return "night";
  }
  
  private parseSceneAction(sceneAction: SceneAction): DeviceAction | null {
    switch (sceneAction.action) {
      case "toggle":
        return { type: "toggle", on: sceneAction.params.on ?? true };
      case "brightness":
        return { type: "brightness", value: sceneAction.params.value ?? 100 };
      case "color":
        return { type: "color", value: sceneAction.params.value ?? "#FFFFFF" };
      case "temperature":
        return { type: "temperature", value: sceneAction.params.value ?? 20 };
      default:
        return null;
    }
  }
  
  // ============================================================================
  // VENDOR INTEGRATIONS (Stubs for future implementation)
  // ============================================================================
  
  async discoverPhilipsHue(bridgeIp: string, apiKey: string): Promise<SmartDevice[]> {
    console.log(`[SmartHome] Discovering Philips Hue devices at ${bridgeIp}...`);
    return [];
  }
  
  async syncHomeKit(): Promise<SmartDevice[]> {
    console.log(`[SmartHome] HomeKit sync not yet implemented`);
    return [];
  }
  
  async syncNetatmo(accessToken: string): Promise<SmartDevice[]> {
    console.log(`[SmartHome] Netatmo sync not yet implemented`);
    return [];
  }
}

export const smartHomeService = new SmartHomeService();
