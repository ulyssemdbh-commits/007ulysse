import { useState, useRef, useCallback, useEffect } from "react";
import * as faceapi from "@vladmandic/face-api";

interface FaceDescriptor {
  id: string;
  name: string;
  descriptor: Float32Array;
}

interface UseFaceRecognitionOptions {
  onFaceDetected?: (name: string | null, confidence: number) => void;
  detectionInterval?: number;
  matchThreshold?: number;
}

interface UseFaceRecognitionReturn {
  isLoading: boolean;
  isReady: boolean;
  isDetecting: boolean;
  error: string | null;
  detectedFace: string | null;
  confidence: number;
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  startDetection: () => void;
  stopDetection: () => void;
  enrollFace: (name: string) => Promise<boolean>;
  loadEnrolledFaces: (faces: FaceDescriptor[]) => void;
  clearEnrolledFaces: () => void;
}

const MODEL_URL = "/models/face-api";

export function useFaceRecognition({
  onFaceDetected,
  detectionInterval = 500,
  matchThreshold = 0.6
}: UseFaceRecognitionOptions = {}): UseFaceRecognitionReturn {
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedFace, setDetectedFace] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const enrolledFacesRef = useRef<FaceDescriptor[]>([]);
  const labeledDescriptorsRef = useRef<faceapi.LabeledFaceDescriptors[]>([]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        
        console.log("[FaceRecognition] Models loaded successfully");
        setIsReady(true);
      } catch (err) {
        console.error("[FaceRecognition] Error loading models:", err);
        setError("Erreur lors du chargement des modèles de reconnaissance faciale");
      } finally {
        setIsLoading(false);
      }
    };

    loadModels();
  }, []);

  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      console.log("[FaceRecognition] Camera started");
    } catch (err) {
      console.error("[FaceRecognition] Camera error:", err);
      setError("Impossible d'accéder à la caméra");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    console.log("[FaceRecognition] Camera stopped");
  }, []);

  const detectFace = useCallback(async () => {
    if (!videoRef.current || !isReady) return;

    try {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (detection && canvasRef.current) {
        const dims = faceapi.matchDimensions(canvasRef.current, videoRef.current, true);
        const resizedDetection = faceapi.resizeResults(detection, dims);
        
        canvasRef.current.getContext("2d")?.clearRect(0, 0, dims.width, dims.height);
        faceapi.draw.drawDetections(canvasRef.current, resizedDetection);
        faceapi.draw.drawFaceLandmarks(canvasRef.current, resizedDetection);

        if (labeledDescriptorsRef.current.length > 0) {
          const faceMatcher = new faceapi.FaceMatcher(labeledDescriptorsRef.current, matchThreshold);
          const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
          
          if (bestMatch.label !== "unknown") {
            const matchConfidence = 1 - bestMatch.distance;
            setDetectedFace(bestMatch.label);
            setConfidence(matchConfidence);
            onFaceDetected?.(bestMatch.label, matchConfidence);
          } else {
            setDetectedFace(null);
            setConfidence(0);
            onFaceDetected?.(null, 0);
          }
        }
      } else if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        setDetectedFace(null);
        setConfidence(0);
        onFaceDetected?.(null, 0);
      }
    } catch (err) {
      console.error("[FaceRecognition] Detection error:", err);
    }
  }, [isReady, matchThreshold, onFaceDetected]);

  const startDetection = useCallback(() => {
    if (!isReady || detectionIntervalRef.current) return;
    
    setIsDetecting(true);
    detectionIntervalRef.current = setInterval(detectFace, detectionInterval);
    console.log("[FaceRecognition] Detection started");
  }, [isReady, detectFace, detectionInterval]);

  const stopDetection = useCallback(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    setIsDetecting(false);
    console.log("[FaceRecognition] Detection stopped");
  }, []);

  const enrollFace = useCallback(async (name: string): Promise<boolean> => {
    if (!videoRef.current || !isReady) {
      console.error("[FaceRecognition] Cannot enroll: not ready");
      return false;
    }

    try {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        console.error("[FaceRecognition] No face detected for enrollment");
        return false;
      }

      const faceDescriptor: FaceDescriptor = {
        id: `${name}_${Date.now()}`,
        name,
        descriptor: detection.descriptor
      };

      enrolledFacesRef.current.push(faceDescriptor);
      
      const existingIndex = labeledDescriptorsRef.current.findIndex(ld => ld.label === name);
      if (existingIndex >= 0) {
        const existingDescriptors = labeledDescriptorsRef.current[existingIndex].descriptors;
        labeledDescriptorsRef.current[existingIndex] = new faceapi.LabeledFaceDescriptors(
          name,
          [...existingDescriptors, detection.descriptor]
        );
      } else {
        labeledDescriptorsRef.current.push(
          new faceapi.LabeledFaceDescriptors(name, [detection.descriptor])
        );
      }

      console.log(`[FaceRecognition] Enrolled face for ${name}`);
      return true;
    } catch (err) {
      console.error("[FaceRecognition] Enrollment error:", err);
      return false;
    }
  }, [isReady]);

  const loadEnrolledFaces = useCallback((faces: FaceDescriptor[]) => {
    enrolledFacesRef.current = faces;
    
    const facesByName = faces.reduce((acc, face) => {
      if (!acc[face.name]) acc[face.name] = [];
      acc[face.name].push(face.descriptor);
      return acc;
    }, {} as Record<string, Float32Array[]>);

    labeledDescriptorsRef.current = Object.entries(facesByName).map(
      ([name, descriptors]) => new faceapi.LabeledFaceDescriptors(name, descriptors)
    );

    console.log(`[FaceRecognition] Loaded ${faces.length} enrolled faces`);
  }, []);

  const clearEnrolledFaces = useCallback(() => {
    enrolledFacesRef.current = [];
    labeledDescriptorsRef.current = [];
    console.log("[FaceRecognition] Cleared enrolled faces");
  }, []);

  useEffect(() => {
    return () => {
      stopDetection();
      stopCamera();
    };
  }, [stopDetection, stopCamera]);

  return {
    isLoading,
    isReady,
    isDetecting,
    error,
    detectedFace,
    confidence,
    videoRef,
    canvasRef,
    startCamera,
    stopCamera,
    startDetection,
    stopDetection,
    enrollFace,
    loadEnrolledFaces,
    clearEnrolledFaces
  };
}

export function serializeFaceDescriptor(descriptor: Float32Array): number[] {
  return Array.from(descriptor);
}

export function deserializeFaceDescriptor(arr: number[]): Float32Array {
  return new Float32Array(arr);
}

export type { FaceDescriptor };
