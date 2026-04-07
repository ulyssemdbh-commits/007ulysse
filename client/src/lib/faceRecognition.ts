import * as faceapi from "@vladmandic/face-api";

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

const MODEL_URL = "/models/face-api";
const MATCH_THRESHOLD = 0.5;

export interface DetectedFace {
  detection: faceapi.FaceDetection;
  landmarks?: faceapi.FaceLandmarks68;
  descriptor?: Float32Array;
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface FaceMatch {
  personId: number;
  personName: string;
  distance: number;
  confidence: number;
}

export interface Person {
  id: number;
  name: string;
  descriptors: number[][];
  photoCount: number;
  createdAt: string;
}

export async function loadModels(): Promise<void> {
  if (modelsLoaded) return;
  
  if (loadingPromise) {
    await loadingPromise;
    return;
  }
  
  loadingPromise = (async () => {
    try {
      console.log("[FaceRecognition] Loading models...");
      
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      
      modelsLoaded = true;
      console.log("[FaceRecognition] Models loaded successfully");
    } catch (error) {
      console.error("[FaceRecognition] Failed to load models:", error);
      throw error;
    }
  })();
  
  await loadingPromise;
}

export function isModelsLoaded(): boolean {
  return modelsLoaded;
}

export async function detectFaces(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<DetectedFace[]> {
  if (!modelsLoaded) {
    await loadModels();
  }
  
  const options = new faceapi.TinyFaceDetectorOptions({ 
    inputSize: 416,
    scoreThreshold: 0.5 
  });
  
  const detections = await faceapi
    .detectAllFaces(input, options)
    .withFaceLandmarks()
    .withFaceDescriptors();
  
  return detections.map((d) => ({
    detection: d.detection,
    landmarks: d.landmarks,
    descriptor: d.descriptor,
    box: {
      x: d.detection.box.x,
      y: d.detection.box.y,
      width: d.detection.box.width,
      height: d.detection.box.height,
    },
    confidence: d.detection.score,
  }));
}

export async function detectSingleFace(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<DetectedFace | null> {
  if (!modelsLoaded) {
    await loadModels();
  }
  
  const options = new faceapi.TinyFaceDetectorOptions({ 
    inputSize: 416,
    scoreThreshold: 0.5 
  });
  
  const detection = await faceapi
    .detectSingleFace(input, options)
    .withFaceLandmarks()
    .withFaceDescriptor();
  
  if (!detection) return null;
  
  return {
    detection: detection.detection,
    landmarks: detection.landmarks,
    descriptor: detection.descriptor,
    box: {
      x: detection.detection.box.x,
      y: detection.detection.box.y,
      width: detection.detection.box.width,
      height: detection.detection.box.height,
    },
    confidence: detection.detection.score,
  };
}

export function computeDistance(
  descriptor1: Float32Array | number[],
  descriptor2: Float32Array | number[]
): number {
  const d1 = descriptor1 instanceof Float32Array ? descriptor1 : new Float32Array(descriptor1);
  const d2 = descriptor2 instanceof Float32Array ? descriptor2 : new Float32Array(descriptor2);
  return faceapi.euclideanDistance(d1, d2);
}

export function findBestMatch(
  descriptor: Float32Array | number[],
  persons: Person[]
): FaceMatch | null {
  let bestMatch: FaceMatch | null = null;
  let bestDistance = MATCH_THRESHOLD;
  
  for (const person of persons) {
    for (const storedDescriptor of person.descriptors) {
      const distance = computeDistance(descriptor, storedDescriptor);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = {
          personId: person.id,
          personName: person.name,
          distance,
          confidence: 1 - distance,
        };
      }
    }
  }
  
  return bestMatch;
}

export function createFaceMatcher(persons: Person[]): faceapi.FaceMatcher | null {
  if (persons.length === 0) return null;
  
  const labeledDescriptors = persons
    .filter(p => p.descriptors.length > 0)
    .map(person => {
      const descriptors = person.descriptors.map(d => new Float32Array(d));
      return new faceapi.LabeledFaceDescriptors(
        `${person.id}:${person.name}`,
        descriptors
      );
    });
  
  if (labeledDescriptors.length === 0) return null;
  
  return new faceapi.FaceMatcher(labeledDescriptors, MATCH_THRESHOLD);
}

export function matchFaceWithMatcher(
  descriptor: Float32Array,
  matcher: faceapi.FaceMatcher
): FaceMatch | null {
  const match = matcher.findBestMatch(descriptor);
  
  if (match.label === "unknown") return null;
  
  const [personId, personName] = match.label.split(":");
  
  return {
    personId: parseInt(personId),
    personName,
    distance: match.distance,
    confidence: 1 - match.distance,
  };
}

export async function extractFaceImage(
  sourceImage: HTMLImageElement | HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  padding = 0.2
): Promise<string> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  
  const sourceWidth = sourceImage instanceof HTMLImageElement 
    ? sourceImage.naturalWidth 
    : sourceImage.width;
  const sourceHeight = sourceImage instanceof HTMLImageElement 
    ? sourceImage.naturalHeight 
    : sourceImage.height;
  
  const paddingX = box.width * padding;
  const paddingY = box.height * padding;
  
  const x = Math.max(0, box.x - paddingX);
  const y = Math.max(0, box.y - paddingY);
  const width = Math.min(sourceWidth - x, box.width + paddingX * 2);
  const height = Math.min(sourceHeight - y, box.height + paddingY * 2);
  
  canvas.width = 150;
  canvas.height = 150;
  
  ctx.drawImage(
    sourceImage,
    x, y, width, height,
    0, 0, 150, 150
  );
  
  return canvas.toDataURL("image/jpeg", 0.8);
}

export function descriptorToArray(descriptor: Float32Array): number[] {
  return Array.from(descriptor);
}

export function arrayToDescriptor(array: number[]): Float32Array {
  return new Float32Array(array);
}
