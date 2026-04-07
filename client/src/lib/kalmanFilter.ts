export interface KalmanState {
  lat: number;
  lng: number;
  vLat: number;
  vLng: number;
  accuracy: number;
  timestamp: number;
}

export class GPSKalmanFilter {
  private state: KalmanState | null = null;
  private processNoise = 3;
  private measurementNoise = 10;
  private pLat = 1;
  private pLng = 1;
  private pVLat = 1;
  private pVLng = 1;

  reset(): void {
    this.state = null;
    this.pLat = 1;
    this.pLng = 1;
    this.pVLat = 1;
    this.pVLng = 1;
  }

  filter(lat: number, lng: number, accuracy: number, timestamp: number): KalmanState {
    if (!this.state) {
      this.state = {
        lat,
        lng,
        vLat: 0,
        vLng: 0,
        accuracy,
        timestamp,
      };
      return { ...this.state };
    }

    const dt = Math.max(0.1, Math.min(30, (timestamp - this.state.timestamp) / 1000));

    const predictedLat = this.state.lat + this.state.vLat * dt;
    const predictedLng = this.state.lng + this.state.vLng * dt;

    this.pLat += this.processNoise * dt;
    this.pLng += this.processNoise * dt;
    this.pVLat += this.processNoise * dt * 0.5;
    this.pVLng += this.processNoise * dt * 0.5;

    const adaptiveMeasurementNoise = Math.max(1, accuracy * 0.1);
    const kLat = this.pLat / (this.pLat + adaptiveMeasurementNoise);
    const kLng = this.pLng / (this.pLng + adaptiveMeasurementNoise);

    const innovationLat = lat - predictedLat;
    const innovationLng = lng - predictedLng;

    this.state = {
      lat: predictedLat + kLat * innovationLat,
      lng: predictedLng + kLng * innovationLng,
      vLat: this.state.vLat + (kLat * innovationLat) / dt * 0.5,
      vLng: this.state.vLng + (kLng * innovationLng) / dt * 0.5,
      accuracy: Math.sqrt((1 - kLat) * this.pLat * (1 - kLat) * this.pLat + adaptiveMeasurementNoise * kLat * kLat),
      timestamp,
    };

    this.pLat = (1 - kLat) * this.pLat;
    this.pLng = (1 - kLng) * this.pLng;

    const maxVelocity = 50 / 111000;
    this.state.vLat = Math.max(-maxVelocity, Math.min(maxVelocity, this.state.vLat));
    this.state.vLng = Math.max(-maxVelocity, Math.min(maxVelocity, this.state.vLng));

    return { ...this.state };
  }

  getEstimatedAccuracy(): number {
    return this.state?.accuracy ?? 100;
  }

  getVelocity(): { lat: number; lng: number } | null {
    if (!this.state) return null;
    return { lat: this.state.vLat, lng: this.state.vLng };
  }

  getSpeed(): number {
    if (!this.state) return 0;
    const vLat = this.state.vLat * 111000;
    const vLng = this.state.vLng * 111000 * Math.cos(this.state.lat * Math.PI / 180);
    return Math.sqrt(vLat * vLat + vLng * vLng) * 3.6;
  }
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function pointToLineDistance(
  pointLat: number,
  pointLng: number,
  lineLat1: number,
  lineLng1: number,
  lineLat2: number,
  lineLng2: number
): number {
  const A = haversineDistance(pointLat, pointLng, lineLat1, lineLng1);
  const B = haversineDistance(pointLat, pointLng, lineLat2, lineLng2);
  const C = haversineDistance(lineLat1, lineLng1, lineLat2, lineLng2);

  if (C === 0) return A;

  const cosA = (B * B + C * C - A * A) / (2 * B * C);
  const cosB = (A * A + C * C - B * B) / (2 * A * C);

  if (cosA > 1 || cosB > 1) {
    return Math.min(A, B);
  }

  const s = (A + B + C) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - A) * (s - B) * (s - C)));
  return (2 * area) / C;
}

export function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;

  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}
