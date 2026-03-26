import { describe, it, expect, vi, beforeEach } from "vitest";

interface FaceDescriptor {
  id: number;
  userId: number;
  personName: string;
  descriptor: number[];
  createdAt: Date;
}

interface FaceMatch {
  personName: string;
  distance: number;
  confidence: number;
}

function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.pow(a[i] - b[i], 2);
  }
  return Math.sqrt(sum);
}

function findBestMatch(descriptor: number[], knownFaces: FaceDescriptor[], threshold: number = 0.6): FaceMatch | null {
  let bestMatch: FaceMatch | null = null;
  let minDistance = Infinity;
  
  for (const face of knownFaces) {
    const distance = euclideanDistance(descriptor, face.descriptor);
    if (distance < minDistance && distance < threshold) {
      minDistance = distance;
      bestMatch = {
        personName: face.personName,
        distance: distance,
        confidence: Math.max(0, (1 - distance / threshold) * 100),
      };
    }
  }
  
  return bestMatch;
}

function normalizeDescriptor(descriptor: number[]): number[] {
  const magnitude = Math.sqrt(descriptor.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return descriptor;
  return descriptor.map(val => val / magnitude);
}

function averageDescriptors(descriptors: number[][]): number[] {
  if (descriptors.length === 0) return [];
  const length = descriptors[0].length;
  const avg = new Array(length).fill(0);
  
  for (const desc of descriptors) {
    for (let i = 0; i < length; i++) {
      avg[i] += desc[i] / descriptors.length;
    }
  }
  
  return avg;
}

function groupFacesByPerson(faces: FaceDescriptor[]): Map<string, FaceDescriptor[]> {
  const groups = new Map<string, FaceDescriptor[]>();
  
  for (const face of faces) {
    const existing = groups.get(face.personName) || [];
    existing.push(face);
    groups.set(face.personName, existing);
  }
  
  return groups;
}

describe("Face Recognition Service", () => {
  describe("Euclidean Distance", () => {
    it("calculates distance between identical descriptors", () => {
      const desc = [0.1, 0.2, 0.3, 0.4];
      expect(euclideanDistance(desc, desc)).toBe(0);
    });

    it("calculates distance between different descriptors", () => {
      const a = [0, 0, 0];
      const b = [3, 4, 0];
      expect(euclideanDistance(a, b)).toBe(5);
    });

    it("returns Infinity for different lengths", () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      expect(euclideanDistance(a, b)).toBe(Infinity);
    });
  });

  describe("Face Matching", () => {
    const knownFaces: FaceDescriptor[] = [
      { id: 1, userId: 1, personName: "Alice", descriptor: [0.1, 0.2, 0.3, 0.4], createdAt: new Date() },
      { id: 2, userId: 1, personName: "Bob", descriptor: [0.5, 0.6, 0.7, 0.8], createdAt: new Date() },
    ];

    it("finds best match for known face", () => {
      const descriptor = [0.11, 0.21, 0.31, 0.41];
      const match = findBestMatch(descriptor, knownFaces);
      expect(match?.personName).toBe("Alice");
      expect(match?.confidence).toBeGreaterThan(0);
    });

    it("returns null for unknown face", () => {
      const descriptor = [9, 9, 9, 9];
      const match = findBestMatch(descriptor, knownFaces);
      expect(match).toBeNull();
    });

    it("respects threshold", () => {
      const descriptor = [0.3, 0.4, 0.5, 0.6];
      const strictMatch = findBestMatch(descriptor, knownFaces, 0.1);
      expect(strictMatch).toBeNull();
    });
  });

  describe("Descriptor Normalization", () => {
    it("normalizes descriptor to unit length", () => {
      const descriptor = [3, 4, 0];
      const normalized = normalizeDescriptor(descriptor);
      const magnitude = Math.sqrt(normalized.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1, 5);
    });

    it("handles zero vector", () => {
      const descriptor = [0, 0, 0];
      const normalized = normalizeDescriptor(descriptor);
      expect(normalized).toEqual([0, 0, 0]);
    });
  });

  describe("Descriptor Averaging", () => {
    it("averages multiple descriptors", () => {
      const descriptors = [
        [1, 2, 3],
        [3, 4, 5],
      ];
      const avg = averageDescriptors(descriptors);
      expect(avg).toEqual([2, 3, 4]);
    });

    it("handles single descriptor", () => {
      const descriptors = [[1, 2, 3]];
      expect(averageDescriptors(descriptors)).toEqual([1, 2, 3]);
    });

    it("returns empty for no descriptors", () => {
      expect(averageDescriptors([])).toEqual([]);
    });
  });

  describe("Face Grouping", () => {
    it("groups faces by person name", () => {
      const faces: FaceDescriptor[] = [
        { id: 1, userId: 1, personName: "Alice", descriptor: [], createdAt: new Date() },
        { id: 2, userId: 1, personName: "Bob", descriptor: [], createdAt: new Date() },
        { id: 3, userId: 1, personName: "Alice", descriptor: [], createdAt: new Date() },
      ];
      const groups = groupFacesByPerson(faces);
      expect(groups.get("Alice")?.length).toBe(2);
      expect(groups.get("Bob")?.length).toBe(1);
    });
  });
});
