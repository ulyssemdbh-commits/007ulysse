import { describe, it, expect, vi, beforeEach } from "vitest";

interface Device {
  id: string;
  userId: number;
  name: string;
  platform: "ios" | "android" | "web";
  lastSeen: Date;
  isActive: boolean;
  pushToken?: string;
}

interface SyncMessage {
  type: string;
  deviceId: string;
  payload: any;
  timestamp: number;
}

function generateDeviceId(): string {
  return `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function isDeviceOnline(device: Device, timeoutMs: number = 300000): boolean {
  return Date.now() - device.lastSeen.getTime() < timeoutMs;
}

function getOnlineDevices(devices: Device[], timeoutMs: number = 300000): Device[] {
  return devices.filter(d => d.isActive && isDeviceOnline(d, timeoutMs));
}

function filterByPlatform(devices: Device[], platform: "ios" | "android" | "web"): Device[] {
  return devices.filter(d => d.platform === platform);
}

function createSyncMessage(type: string, deviceId: string, payload: any): SyncMessage {
  return {
    type,
    deviceId,
    payload,
    timestamp: Date.now(),
  };
}

function mergeSyncConflicts(local: any, remote: any, remoteTimestamp: number, localTimestamp: number): any {
  if (remoteTimestamp > localTimestamp) return remote;
  return local;
}

function groupDevicesByUser(devices: Device[]): Map<number, Device[]> {
  const groups = new Map<number, Device[]>();
  for (const device of devices) {
    const existing = groups.get(device.userId) || [];
    existing.push(device);
    groups.set(device.userId, existing);
  }
  return groups;
}

describe("Device Management", () => {
  describe("Device ID Generation", () => {
    it("generates unique device IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateDeviceId()));
      expect(ids.size).toBe(100);
    });

    it("generates IDs with correct prefix", () => {
      const id = generateDeviceId();
      expect(id.startsWith("dev_")).toBe(true);
    });
  });

  describe("Online Status", () => {
    it("detects online devices", () => {
      const device: Device = {
        id: "1", userId: 1, name: "Phone", platform: "ios",
        lastSeen: new Date(), isActive: true
      };
      expect(isDeviceOnline(device)).toBe(true);
    });

    it("detects offline devices", () => {
      const device: Device = {
        id: "1", userId: 1, name: "Phone", platform: "ios",
        lastSeen: new Date(Date.now() - 600000), isActive: true
      };
      expect(isDeviceOnline(device)).toBe(false);
    });

    it("respects custom timeout", () => {
      const device: Device = {
        id: "1", userId: 1, name: "Phone", platform: "ios",
        lastSeen: new Date(Date.now() - 400000), isActive: true
      };
      expect(isDeviceOnline(device, 600000)).toBe(true);
    });
  });

  describe("Device Filtering", () => {
    const devices: Device[] = [
      { id: "1", userId: 1, name: "iPhone", platform: "ios", lastSeen: new Date(), isActive: true },
      { id: "2", userId: 1, name: "Android", platform: "android", lastSeen: new Date(), isActive: true },
      { id: "3", userId: 1, name: "Browser", platform: "web", lastSeen: new Date(), isActive: false },
      { id: "4", userId: 2, name: "iPad", platform: "ios", lastSeen: new Date(Date.now() - 600000), isActive: true },
    ];

    it("filters online devices", () => {
      const online = getOnlineDevices(devices);
      expect(online.length).toBe(2);
    });

    it("filters by platform", () => {
      const ios = filterByPlatform(devices, "ios");
      expect(ios.length).toBe(2);
    });
  });

  describe("Sync Messages", () => {
    it("creates sync message with timestamp", () => {
      const msg = createSyncMessage("conversation_update", "dev_123", { id: 1 });
      expect(msg.type).toBe("conversation_update");
      expect(msg.deviceId).toBe("dev_123");
      expect(msg.timestamp).toBeGreaterThan(0);
    });
  });

  describe("Conflict Resolution", () => {
    it("prefers more recent remote data", () => {
      const local = { text: "old" };
      const remote = { text: "new" };
      const result = mergeSyncConflicts(local, remote, Date.now(), Date.now() - 1000);
      expect(result).toBe(remote);
    });

    it("keeps local data when more recent", () => {
      const local = { text: "new" };
      const remote = { text: "old" };
      const result = mergeSyncConflicts(local, remote, Date.now() - 1000, Date.now());
      expect(result).toBe(local);
    });
  });

  describe("User Grouping", () => {
    const devices: Device[] = [
      { id: "1", userId: 1, name: "Phone", platform: "ios", lastSeen: new Date(), isActive: true },
      { id: "2", userId: 1, name: "Tablet", platform: "ios", lastSeen: new Date(), isActive: true },
      { id: "3", userId: 2, name: "Phone", platform: "android", lastSeen: new Date(), isActive: true },
    ];

    it("groups devices by user", () => {
      const groups = groupDevicesByUser(devices);
      expect(groups.get(1)?.length).toBe(2);
      expect(groups.get(2)?.length).toBe(1);
    });
  });
});
