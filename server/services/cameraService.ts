/**
 * Camera Service - Surveillance camera management
 * 
 * Supports:
 * - IP cameras (HTTP/RTSP streams)
 * - ONVIF cameras (standard protocol)
 * - HomeKit cameras (future)
 * 
 * Features:
 * - Camera CRUD operations
 * - Snapshot capture
 * - Stream URL generation
 * - Health check / online status
 * - Integration with face recognition
 */

import { db } from "../db";
import { surveillanceCameras, cameraEvents } from "@shared/schema";
import type { SurveillanceCamera, InsertSurveillanceCamera, CameraEvent, InsertCameraEvent } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { encryptionService } from "./encryption";

class CameraService {
  
  /**
   * Get all cameras for a user
   */
  async getCameras(userId: number): Promise<SurveillanceCamera[]> {
    return db.select()
      .from(surveillanceCameras)
      .where(eq(surveillanceCameras.userId, userId))
      .orderBy(surveillanceCameras.name);
  }
  
  /**
   * Get a specific camera
   */
  async getCamera(userId: number, cameraId: number): Promise<SurveillanceCamera | null> {
    const [camera] = await db.select()
      .from(surveillanceCameras)
      .where(and(
        eq(surveillanceCameras.id, cameraId),
        eq(surveillanceCameras.userId, userId)
      ));
    return camera || null;
  }
  
  /**
   * Add a new camera
   * Note: password field is plaintext and will be encrypted before storage
   */
  async addCamera(userId: number, data: any): Promise<SurveillanceCamera> {
    // Encrypt password if provided (accept both 'password' and 'passwordEncrypted')
    const plainPassword = data.password || data.passwordEncrypted;
    const encryptedPassword = plainPassword ? encryptionService.encrypt(plainPassword) : undefined;
    
    const cameraData: InsertSurveillanceCamera = {
      userId,
      name: data.name || "Nouvelle caméra",
      location: data.location,
      cameraType: data.cameraType || "ip",
      streamUrl: data.streamUrl,
      snapshotUrl: data.snapshotUrl,
      username: data.username,
      passwordEncrypted: encryptedPassword,
      ipAddress: data.ipAddress,
      port: data.port || 554,
      protocol: data.protocol || "rtsp",
      resolution: data.resolution || "1080p",
      fps: data.fps || 15,
      hasMotionDetection: data.hasMotionDetection || false,
      motionSensitivity: data.motionSensitivity || 50,
      hasFaceRecognition: data.hasFaceRecognition || false,
      notifyOnMotion: data.notifyOnMotion ?? true,
      notifyOnPerson: data.notifyOnPerson ?? true,
      recordingEnabled: data.recordingEnabled || false,
      isActive: data.isActive ?? true,
    };
    
    const [camera] = await db.insert(surveillanceCameras)
      .values(cameraData)
      .returning();
    
    console.log(`[CameraService] Added camera: ${camera.name} (${camera.id})`);
    return camera;
  }
  
  /**
   * Update camera settings
   * Note: password field is plaintext and will be encrypted before storage
   */
  async updateCamera(
    userId: number,
    cameraId: number,
    updates: any
  ): Promise<SurveillanceCamera | null> {
    // Accept both 'password' and 'passwordEncrypted', encrypt if provided
    const plainPassword = updates.password || updates.passwordEncrypted;
    const processedUpdates = { ...updates };
    delete processedUpdates.password; // Remove plaintext field
    
    if (plainPassword) {
      processedUpdates.passwordEncrypted = encryptionService.encrypt(plainPassword);
    }
    
    const [camera] = await db.update(surveillanceCameras)
      .set({
        ...processedUpdates,
        updatedAt: new Date(),
      })
      .where(and(
        eq(surveillanceCameras.id, cameraId),
        eq(surveillanceCameras.userId, userId)
      ))
      .returning();
    
    if (camera) {
      console.log(`[CameraService] Updated camera: ${camera.name} (${camera.id})`);
    }
    return camera || null;
  }
  
  /**
   * Delete a camera
   */
  async deleteCamera(userId: number, cameraId: number): Promise<boolean> {
    // Delete associated events first
    await db.delete(cameraEvents)
      .where(and(
        eq(cameraEvents.cameraId, cameraId),
        eq(cameraEvents.userId, userId)
      ));
    
    const result = await db.delete(surveillanceCameras)
      .where(and(
        eq(surveillanceCameras.id, cameraId),
        eq(surveillanceCameras.userId, userId)
      ));
    
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
      console.log(`[CameraService] Deleted camera: ${cameraId}`);
    }
    return deleted;
  }
  
  /**
   * Build authenticated stream URL
   */
  buildStreamUrl(camera: SurveillanceCamera): string | null {
    if (camera.streamUrl) {
      // If credentials provided, embed them in URL
      if (camera.username && camera.passwordEncrypted) {
        try {
          const password = encryptionService.decrypt(camera.passwordEncrypted);
          const url = new URL(camera.streamUrl);
          url.username = camera.username;
          url.password = password;
          return url.toString();
        } catch {
          return camera.streamUrl;
        }
      }
      return camera.streamUrl;
    }
    
    // Build URL from components
    if (camera.ipAddress) {
      const protocol = camera.protocol || "rtsp";
      const port = camera.port || (protocol === "rtsp" ? 554 : 80);
      let url = `${protocol}://`;
      
      if (camera.username && camera.passwordEncrypted) {
        try {
          const password = encryptionService.decrypt(camera.passwordEncrypted);
          url += `${encodeURIComponent(camera.username)}:${encodeURIComponent(password)}@`;
        } catch {
          // Skip auth if decryption fails
        }
      }
      
      url += `${camera.ipAddress}:${port}/stream`;
      return url;
    }
    
    return null;
  }
  
  /**
   * Build snapshot URL
   */
  buildSnapshotUrl(camera: SurveillanceCamera): string | null {
    if (camera.snapshotUrl) {
      return camera.snapshotUrl;
    }
    
    if (camera.ipAddress) {
      const protocol = camera.protocol === "rtsp" ? "http" : camera.protocol;
      const port = camera.port || 80;
      return `${protocol}://${camera.ipAddress}:${port}/snapshot.jpg`;
    }
    
    return null;
  }
  
  /**
   * Check if camera is online
   */
  async checkCameraStatus(camera: SurveillanceCamera): Promise<boolean> {
    const snapshotUrl = this.buildSnapshotUrl(camera);
    if (!snapshotUrl) return false;
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(snapshotUrl, {
        method: "HEAD",
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      
      const isOnline = response.ok;
      
      // Update status in database
      await db.update(surveillanceCameras)
        .set({
          isOnline,
          lastSeenAt: isOnline ? new Date() : undefined,
        })
        .where(eq(surveillanceCameras.id, camera.id));
      
      return isOnline;
    } catch {
      // Camera is offline
      await db.update(surveillanceCameras)
        .set({ isOnline: false })
        .where(eq(surveillanceCameras.id, camera.id));
      
      return false;
    }
  }
  
  /**
   * Log a camera event
   */
  async logEvent(data: InsertCameraEvent): Promise<CameraEvent> {
    const [event] = await db.insert(cameraEvents)
      .values(data)
      .returning();
    
    console.log(`[CameraService] Event logged: ${data.eventType} for camera ${data.cameraId}`);
    return event;
  }
  
  /**
   * Get recent events for a camera
   */
  async getEvents(userId: number, cameraId?: number, limit: number = 20): Promise<CameraEvent[]> {
    if (cameraId) {
      return db.select()
        .from(cameraEvents)
        .where(and(
          eq(cameraEvents.cameraId, cameraId),
          eq(cameraEvents.userId, userId)
        ))
        .orderBy(desc(cameraEvents.createdAt))
        .limit(limit);
    }
    
    return db.select()
      .from(cameraEvents)
      .where(eq(cameraEvents.userId, userId))
      .orderBy(desc(cameraEvents.createdAt))
      .limit(limit);
  }
  
  /**
   * Format cameras for AI context
   */
  formatForAI(cameras: SurveillanceCamera[]): string {
    if (cameras.length === 0) {
      return "Aucune caméra configurée.";
    }
    
    let output = `### CAMÉRAS DE SURVEILLANCE (${cameras.length}):\n`;
    
    for (const cam of cameras) {
      const status = cam.isOnline ? "En ligne" : "Hors ligne";
      output += `- **${cam.name}** (${cam.location || "non spécifié"}): ${status}`;
      if (cam.hasMotionDetection) output += " [Détection mouvement]";
      if (cam.hasFaceRecognition) output += " [Reconnaissance faciale]";
      output += "\n";
    }
    
    return output;
  }
}

export const cameraService = new CameraService();
