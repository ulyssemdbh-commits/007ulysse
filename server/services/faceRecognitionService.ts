import { db } from "../db";
import { knownPersons, faceDescriptors, mediaFaces, mediaLibrary } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { KnownPerson, FaceDescriptor, MediaFace, InsertKnownPerson, InsertFaceDescriptor, InsertMediaFace } from "@shared/schema";

const MATCH_THRESHOLD = 0.45;
const HIGH_CONFIDENCE_THRESHOLD = 0.35;
const MINIMUM_QUALITY = 0.6;
const MAX_DESCRIPTORS_PER_PERSON = 10;

export interface MatchResult {
  personId: number;
  personName: string;
  distance: number;
  confidence: number;
  matchType: "exact" | "high" | "medium" | "low";
  descriptorCount: number;
}

export interface FaceRecognitionStats {
  totalPersons: number;
  totalDescriptors: number;
  averageDescriptorsPerPerson: number;
  personsWithMultipleDescriptors: number;
}

function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function computeAverageDescriptor(descriptors: number[][]): number[] {
  if (descriptors.length === 0) return [];
  if (descriptors.length === 1) return descriptors[0];
  
  const length = descriptors[0].length;
  const average = new Array(length).fill(0);
  
  for (const descriptor of descriptors) {
    for (let i = 0; i < length; i++) {
      average[i] += descriptor[i];
    }
  }
  
  for (let i = 0; i < length; i++) {
    average[i] /= descriptors.length;
  }
  
  return average;
}

function computeMinDistance(inputDescriptor: number[], storedDescriptors: number[][]): number {
  let minDistance = Infinity;
  for (const stored of storedDescriptors) {
    const distance = euclideanDistance(inputDescriptor, stored);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
}

function computeAverageDistance(inputDescriptor: number[], storedDescriptors: number[][]): number {
  if (storedDescriptors.length === 0) return Infinity;
  
  let totalDistance = 0;
  for (const stored of storedDescriptors) {
    totalDistance += euclideanDistance(inputDescriptor, stored);
  }
  
  return totalDistance / storedDescriptors.length;
}

function getMatchType(distance: number): "exact" | "high" | "medium" | "low" {
  if (distance < 0.3) return "exact";
  if (distance < HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (distance < 0.42) return "medium";
  return "low";
}

export async function getPersons(userId: number): Promise<KnownPerson[]> {
  return db.select().from(knownPersons).where(eq(knownPersons.userId, userId)).orderBy(desc(knownPersons.photoCount));
}

export async function getPerson(userId: number, personId: number): Promise<KnownPerson | undefined> {
  const [person] = await db.select().from(knownPersons).where(and(eq(knownPersons.id, personId), eq(knownPersons.userId, userId)));
  return person;
}

export async function createPerson(data: InsertKnownPerson): Promise<KnownPerson> {
  const [person] = await db.insert(knownPersons).values(data).returning();
  return person;
}

export async function updatePerson(userId: number, personId: number, updates: Partial<InsertKnownPerson>): Promise<KnownPerson | undefined> {
  const [person] = await db.update(knownPersons)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(knownPersons.id, personId), eq(knownPersons.userId, userId)))
    .returning();
  return person;
}

export async function deletePerson(userId: number, personId: number): Promise<boolean> {
  await db.delete(faceDescriptors).where(and(eq(faceDescriptors.personId, personId), eq(faceDescriptors.userId, userId)));
  await db.update(mediaFaces).set({ personId: null }).where(eq(mediaFaces.personId, personId));
  const result = await db.delete(knownPersons).where(and(eq(knownPersons.id, personId), eq(knownPersons.userId, userId)));
  return (result.rowCount ?? 0) > 0;
}

export async function getPersonDescriptors(userId: number, personId: number): Promise<FaceDescriptor[]> {
  return db.select().from(faceDescriptors)
    .where(and(eq(faceDescriptors.personId, personId), eq(faceDescriptors.userId, userId)));
}

export async function getAllDescriptorsWithPersons(userId: number): Promise<Array<{ person: KnownPerson; descriptors: number[][] }>> {
  const persons = await getPersons(userId);
  const result: Array<{ person: KnownPerson; descriptors: number[][] }> = [];
  
  for (const person of persons) {
    const descriptorRecords = await getPersonDescriptors(userId, person.id);
    if (descriptorRecords.length > 0) {
      result.push({
        person,
        descriptors: descriptorRecords.map(d => d.descriptor as number[]),
      });
    }
  }
  
  return result;
}

export async function addDescriptor(data: InsertFaceDescriptor): Promise<FaceDescriptor> {
  const [descriptor] = await db.insert(faceDescriptors).values(data).returning();
  
  if (data.personId) {
    await db.update(knownPersons)
      .set({ 
        photoCount: sql`${knownPersons.photoCount} + 1`,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knownPersons.id, data.personId));
  }
  
  return descriptor;
}

export async function deleteDescriptor(userId: number, descriptorId: number): Promise<boolean> {
  const [descriptor] = await db.select().from(faceDescriptors)
    .where(and(eq(faceDescriptors.id, descriptorId), eq(faceDescriptors.userId, userId)));
  
  if (!descriptor) return false;
  
  if (descriptor.personId) {
    await db.update(knownPersons)
      .set({ 
        photoCount: sql`GREATEST(${knownPersons.photoCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(knownPersons.id, descriptor.personId));
  }
  
  const result = await db.delete(faceDescriptors)
    .where(and(eq(faceDescriptors.id, descriptorId), eq(faceDescriptors.userId, userId)));
  
  return (result.rowCount ?? 0) > 0;
}

export async function matchFace(
  userId: number,
  descriptor: number[]
): Promise<MatchResult | null> {
  const personsWithDescriptors = await getAllDescriptorsWithPersons(userId);
  
  let bestMatch: MatchResult | null = null;
  let bestScore = 0;
  
  for (const { person, descriptors } of personsWithDescriptors) {
    const minDistance = computeMinDistance(descriptor, descriptors);
    const avgDistance = computeAverageDistance(descriptor, descriptors);
    
    const weightedDistance = minDistance * 0.7 + avgDistance * 0.3;
    
    if (weightedDistance >= MATCH_THRESHOLD) continue;
    
    const descriptorBonus = Math.min(descriptors.length, 5) * 0.02;
    const effectiveDistance = Math.max(0, weightedDistance - descriptorBonus);
    const confidence = Math.max(0, Math.min(1, 1 - effectiveDistance));
    const score = confidence + (descriptors.length > 3 ? 0.1 : 0);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        personId: person.id,
        personName: person.name,
        distance: effectiveDistance,
        confidence,
        matchType: getMatchType(effectiveDistance),
        descriptorCount: descriptors.length,
      };
    }
  }
  
  return bestMatch;
}

export async function matchFaceMultiple(
  userId: number,
  descriptor: number[],
  limit: number = 3
): Promise<MatchResult[]> {
  const personsWithDescriptors = await getAllDescriptorsWithPersons(userId);
  const matches: MatchResult[] = [];
  
  for (const { person, descriptors } of personsWithDescriptors) {
    const minDistance = computeMinDistance(descriptor, descriptors);
    const avgDistance = computeAverageDistance(descriptor, descriptors);
    const weightedDistance = minDistance * 0.7 + avgDistance * 0.3;
    
    if (weightedDistance >= MATCH_THRESHOLD + 0.1) continue;
    
    const descriptorBonus = Math.min(descriptors.length, 5) * 0.02;
    const effectiveDistance = Math.max(0, weightedDistance - descriptorBonus);
    const confidence = Math.max(0, Math.min(1, 1 - effectiveDistance));
    
    matches.push({
      personId: person.id,
      personName: person.name,
      distance: effectiveDistance,
      confidence,
      matchType: getMatchType(effectiveDistance),
      descriptorCount: descriptors.length,
    });
  }
  
  return matches
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

export async function getStats(userId: number): Promise<FaceRecognitionStats> {
  const persons = await getPersons(userId);
  let totalDescriptors = 0;
  let personsWithMultiple = 0;
  
  for (const person of persons) {
    const descriptors = await getPersonDescriptors(userId, person.id);
    totalDescriptors += descriptors.length;
    if (descriptors.length > 1) personsWithMultiple++;
  }
  
  return {
    totalPersons: persons.length,
    totalDescriptors,
    averageDescriptorsPerPerson: persons.length > 0 ? totalDescriptors / persons.length : 0,
    personsWithMultipleDescriptors: personsWithMultiple,
  };
}

export async function optimizeDescriptors(userId: number, personId: number): Promise<number> {
  const descriptorRecords = await getPersonDescriptors(userId, personId);
  
  if (descriptorRecords.length <= MAX_DESCRIPTORS_PER_PERSON) {
    return 0;
  }
  
  const sortedByQuality = [...descriptorRecords].sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
  const toRemove = sortedByQuality.slice(MAX_DESCRIPTORS_PER_PERSON);
  
  for (const descriptor of toRemove) {
    await deleteDescriptor(userId, descriptor.id);
  }
  
  console.log(`[FaceRecognition] Optimized person ${personId}: removed ${toRemove.length} low-quality descriptors`);
  return toRemove.length;
}

export async function getMediaFaces(mediaId: number): Promise<MediaFace[]> {
  return db.select().from(mediaFaces).where(eq(mediaFaces.mediaId, mediaId));
}

export async function addMediaFace(data: InsertMediaFace): Promise<MediaFace> {
  const [face] = await db.insert(mediaFaces).values(data).returning();
  return face;
}

export async function updateMediaFace(faceId: number, updates: Partial<InsertMediaFace>): Promise<MediaFace | undefined> {
  const [face] = await db.update(mediaFaces).set(updates).where(eq(mediaFaces.id, faceId)).returning();
  return face;
}

export async function confirmMediaFace(faceId: number, personId: number): Promise<MediaFace | undefined> {
  const [face] = await db.update(mediaFaces)
    .set({ personId, isConfirmed: true })
    .where(eq(mediaFaces.id, faceId))
    .returning();
  
  if (face) {
    await db.update(knownPersons)
      .set({ 
        photoCount: sql`${knownPersons.photoCount} + 1`,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knownPersons.id, personId));
  }
  
  return face;
}

export async function getMediaByPerson(userId: number, personId: number): Promise<Array<{ mediaId: number; confidence: number }>> {
  const faces = await db.select({
    mediaId: mediaFaces.mediaId,
    confidence: mediaFaces.confidence,
  })
  .from(mediaFaces)
  .innerJoin(mediaLibrary, eq(mediaFaces.mediaId, mediaLibrary.id))
  .where(and(eq(mediaFaces.personId, personId), eq(mediaLibrary.userId, userId)))
  .orderBy(desc(mediaFaces.confidence));
  
  return faces;
}

export async function getMediaByPersonWithDetails(userId: number, personId: number): Promise<Array<{
  media: {
    id: number;
    type: string;
    filename: string;
    originalName: string;
    storagePath: string;
    thumbnailPath: string | null;
    description: string | null;
    capturedAt: Date | null;
  };
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
}>> {
  const results = await db.select({
    mediaId: mediaFaces.mediaId,
    confidence: mediaFaces.confidence,
    boxX: mediaFaces.boxX,
    boxY: mediaFaces.boxY,
    boxWidth: mediaFaces.boxWidth,
    boxHeight: mediaFaces.boxHeight,
    mediaType: mediaLibrary.type,
    filename: mediaLibrary.filename,
    originalName: mediaLibrary.originalName,
    storagePath: mediaLibrary.storagePath,
    thumbnailPath: mediaLibrary.thumbnailPath,
    description: mediaLibrary.description,
    capturedAt: mediaLibrary.capturedAt,
  })
  .from(mediaFaces)
  .innerJoin(mediaLibrary, eq(mediaFaces.mediaId, mediaLibrary.id))
  .where(and(eq(mediaFaces.personId, personId), eq(mediaLibrary.userId, userId)))
  .orderBy(desc(mediaFaces.confidence));
  
  return results.map(r => ({
    media: {
      id: r.mediaId,
      type: r.mediaType,
      filename: r.filename,
      originalName: r.originalName,
      storagePath: r.storagePath,
      thumbnailPath: r.thumbnailPath,
      description: r.description,
      capturedAt: r.capturedAt,
    },
    confidence: r.confidence,
    box: { x: r.boxX, y: r.boxY, width: r.boxWidth, height: r.boxHeight },
  }));
}

export async function searchPersonByName(userId: number, name: string): Promise<KnownPerson | undefined> {
  const nameLower = name.toLowerCase().trim();
  const persons = await getPersons(userId);
  
  // Exact match first
  const exact = persons.find(p => p.name.toLowerCase() === nameLower);
  if (exact) return exact;
  
  // Partial match
  const partial = persons.find(p => p.name.toLowerCase().includes(nameLower) || nameLower.includes(p.name.toLowerCase()));
  return partial;
}

export async function getPersonsInMedia(mediaId: number): Promise<Array<{ person: KnownPerson; confidence: number; box: { x: number; y: number; width: number; height: number } }>> {
  const faces = await db.select()
    .from(mediaFaces)
    .where(eq(mediaFaces.mediaId, mediaId));
  
  const result: Array<{ person: KnownPerson; confidence: number; box: { x: number; y: number; width: number; height: number } }> = [];
  
  for (const face of faces) {
    if (face.personId) {
      const [person] = await db.select().from(knownPersons).where(eq(knownPersons.id, face.personId));
      if (person) {
        result.push({
          person,
          confidence: face.confidence,
          box: { x: face.boxX, y: face.boxY, width: face.boxWidth, height: face.boxHeight },
        });
      }
    }
  }
  
  return result;
}

export async function analyzeMediaForFaces(
  userId: number,
  mediaId: number,
  detectedFaces: Array<{
    descriptor: number[];
    box: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>
): Promise<MediaFace[]> {
  const results: MediaFace[] = [];
  
  for (const face of detectedFaces) {
    const match = await matchFace(userId, face.descriptor);
    
    const [descriptor] = await db.insert(faceDescriptors).values({
      userId,
      personId: match?.personId ?? null,
      descriptor: face.descriptor,
      sourceMediaId: mediaId,
      quality: face.confidence,
    }).returning();
    
    const mediaFace = await addMediaFace({
      mediaId,
      personId: match?.personId ?? null,
      descriptorId: descriptor.id,
      boxX: face.box.x,
      boxY: face.box.y,
      boxWidth: face.box.width,
      boxHeight: face.box.height,
      confidence: match?.confidence ?? 0,
      isConfirmed: false,
    });
    
    results.push(mediaFace);
  }
  
  return results;
}
