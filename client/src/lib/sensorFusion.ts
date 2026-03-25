export interface SensorData {
  acceleration: { x: number; y: number; z: number } | null;
  rotationRate: { alpha: number; beta: number; gamma: number } | null;
  orientation: { alpha: number; beta: number; gamma: number } | null;
  timestamp: number;
}

export interface FusedPosition {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  accuracy: number;
  source: 'gps' | 'fused' | 'dead_reckoning';
}

export class SensorFusionEngine {
  private lastGpsPosition: { lat: number; lng: number; time: number } | null = null;
  private lastGpsSpeed: number = 0;
  private lastGpsHeading: number = 0;
  private velocityX: number = 0;
  private velocityY: number = 0;
  private heading: number = 0;
  private gpsLostTime: number = 0;
  private readonly maxDeadReckoningTime = 30000;
  private readonly earthRadius = 6371000;
  private calibrationSamples: { x: number; y: number; z: number }[] = [];
  private accelerometerBias = { x: 0, y: 0, z: 0 };
  private isCalibrated = false;

  updateGps(lat: number, lng: number, speed: number, heading: number, accuracy: number): FusedPosition {
    const now = Date.now();
    
    if (this.lastGpsPosition) {
      const dt = (now - this.lastGpsPosition.time) / 1000;
      if (dt > 0 && dt < 10) {
        const dLat = lat - this.lastGpsPosition.lat;
        const dLng = lng - this.lastGpsPosition.lng;
        const latRad = lat * Math.PI / 180;
        const dX = dLng * Math.cos(latRad) * this.earthRadius * Math.PI / 180;
        const dY = dLat * this.earthRadius * Math.PI / 180;
        this.velocityX = dX / dt;
        this.velocityY = dY / dt;
      }
    }
    
    this.lastGpsPosition = { lat, lng, time: now };
    this.lastGpsSpeed = speed;
    this.lastGpsHeading = heading;
    this.heading = heading;
    this.gpsLostTime = 0;
    
    return {
      lat,
      lng,
      speed,
      heading,
      accuracy,
      source: 'gps'
    };
  }

  updateSensors(data: SensorData): void {
    if (!data.acceleration) return;
    
    if (!this.isCalibrated && this.calibrationSamples.length < 50) {
      this.calibrationSamples.push(data.acceleration);
      if (this.calibrationSamples.length === 50) {
        this.calibrateAccelerometer();
      }
      return;
    }
    
    const ax = data.acceleration.x - this.accelerometerBias.x;
    const ay = data.acceleration.y - this.accelerometerBias.y;

    if (data.orientation) {
      this.heading = data.orientation.alpha || this.heading;
    }
    
    if (this.lastGpsPosition) {
      const dt = (data.timestamp - this.lastGpsPosition.time) / 1000;
      if (dt > 0 && dt < 0.5) {
        this.velocityX += ax * dt * 0.3;
        this.velocityY += ay * dt * 0.3;
      }
    }
  }

  private calibrateAccelerometer(): void {
    if (this.calibrationSamples.length === 0) return;
    
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const sample of this.calibrationSamples) {
      sumX += sample.x;
      sumY += sample.y;
      sumZ += sample.z;
    }
    
    this.accelerometerBias = {
      x: sumX / this.calibrationSamples.length,
      y: sumY / this.calibrationSamples.length,
      z: (sumZ / this.calibrationSamples.length) - 9.81
    };
    this.isCalibrated = true;
    console.log('[SensorFusion] Calibrated accelerometer bias:', this.accelerometerBias);
  }

  predictPosition(timeSinceLastGps: number): FusedPosition | null {
    if (!this.lastGpsPosition) return null;
    
    this.gpsLostTime = timeSinceLastGps;
    
    if (timeSinceLastGps > this.maxDeadReckoningTime) {
      return null;
    }
    
    const dt = timeSinceLastGps / 1000;
    const speedDecay = Math.exp(-dt * 0.1);
    const currentSpeed = this.lastGpsSpeed * speedDecay;
    
    const headingRad = this.heading * Math.PI / 180;
    const distance = currentSpeed * dt / 3.6;
    
    const dLat = (distance * Math.cos(headingRad)) / this.earthRadius * (180 / Math.PI);
    const dLng = (distance * Math.sin(headingRad)) / (this.earthRadius * Math.cos(this.lastGpsPosition.lat * Math.PI / 180)) * (180 / Math.PI);
    
    const predictedLat = this.lastGpsPosition.lat + dLat;
    const predictedLng = this.lastGpsPosition.lng + dLng;
    
    const baseAccuracy = 10;
    const degradedAccuracy = baseAccuracy + (timeSinceLastGps / 1000) * 5;
    
    return {
      lat: predictedLat,
      lng: predictedLng,
      speed: currentSpeed,
      heading: this.heading,
      accuracy: degradedAccuracy,
      source: timeSinceLastGps > 2000 ? 'dead_reckoning' : 'fused'
    };
  }

  isGpsLost(): boolean {
    return this.gpsLostTime > 2000;
  }

  getGpsLostDuration(): number {
    return this.gpsLostTime;
  }

  reset(): void {
    this.lastGpsPosition = null;
    this.lastGpsSpeed = 0;
    this.lastGpsHeading = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.heading = 0;
    this.gpsLostTime = 0;
  }
}

export function calculateTurnAnnouncementDistance(speedKmh: number): number {
  if (speedKmh < 20) return 50;
  if (speedKmh < 50) return 100;
  if (speedKmh < 80) return 200;
  if (speedKmh < 110) return 400;
  return 600;
}

export function formatTurnAnnouncement(
  instruction: string,
  distanceMeters: number,
  speedKmh: number,
  roadName?: string | null
): string {
  const announceDist = calculateTurnAnnouncementDistance(speedKmh);
  
  if (distanceMeters <= 30) {
    return instruction;
  }
  
  let distanceText: string;
  if (distanceMeters > 1000) {
    distanceText = `dans ${(distanceMeters / 1000).toFixed(1)} kilomètres`;
  } else if (distanceMeters > 100) {
    distanceText = `dans ${Math.round(distanceMeters / 50) * 50} mètres`;
  } else {
    distanceText = `dans ${Math.round(distanceMeters / 10) * 10} mètres`;
  }
  
  let announcement = `${distanceText}, ${instruction}`;
  
  if (roadName && distanceMeters < announceDist * 2) {
    announcement += ` sur ${roadName}`;
  }
  
  return announcement;
}

export function shouldAnnounce(
  distanceToTurn: number,
  speedKmh: number,
  lastAnnouncedDistance: number | null
): boolean {
  const announceDist = calculateTurnAnnouncementDistance(speedKmh);
  
  const thresholds = [
    announceDist * 3,
    announceDist,
    30
  ];
  
  for (const threshold of thresholds) {
    if (distanceToTurn <= threshold) {
      if (lastAnnouncedDistance === null || lastAnnouncedDistance > threshold * 1.5) {
        return true;
      }
    }
  }
  
  return false;
}
