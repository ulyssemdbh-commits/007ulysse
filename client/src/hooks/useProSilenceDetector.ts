/**
 * PRO SILENCE DETECTOR V2 - Professional Quality Hook
 * 
 * Détection automatique de fin de parole avec :
 * - Calibration automatique du bruit de fond
 * - Seuils adaptatifs basés sur l'environnement
 * - Hystérésis anti-faux positifs
 * - Statistiques en temps réel
 * 
 * Usage:
 * const { speechState, rmsLevel, stats, isCalibrated } = useProSilenceDetector({
 *   stream: mediaStream,
 *   onSpeechStart: () => console.log("User started speaking"),
 *   onSpeechEnd: () => console.log("User finished speaking"),
 *   silenceDuration: 1500,
 * });
 */

import { useState, useEffect, useRef, useCallback } from "react";

export type SpeechState = "idle" | "calibrating" | "listening" | "speaking" | "silence" | "ended";

export interface SilenceDetectorStats {
  peakLevel: number;
  avgLevel: number;
  speechDuration: number;
  calibratedThreshold: number;
  noiseFloor: number;
}

export interface ProSilenceDetectorOptions {
  stream: MediaStream | null;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onCalibrationComplete?: (threshold: number) => void;
  silenceDuration?: number;
  minSpeechDuration?: number;
  calibrationSamples?: number;
  noiseMultiplier?: number;
  enabled?: boolean;
}

export interface ProSilenceDetectorResult {
  speechState: SpeechState;
  rmsLevel: number;
  stats: SilenceDetectorStats;
  isCalibrated: boolean;
  isSpeaking: boolean;
  reset: () => void;
}

export function useProSilenceDetector(options: ProSilenceDetectorOptions): ProSilenceDetectorResult {
  const {
    stream,
    onSpeechStart,
    onSpeechEnd,
    onCalibrationComplete,
    silenceDuration = 1500,
    minSpeechDuration = 300,
    calibrationSamples = 30,
    noiseMultiplier = 2.5,
    enabled = true,
  } = options;

  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [rmsLevel, setRmsLevel] = useState(0);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [stats, setStats] = useState<SilenceDetectorStats>({
    peakLevel: 0,
    avgLevel: 0,
    speechDuration: 0,
    calibratedThreshold: 0.02,
    noiseFloor: 0,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // State tracking refs
  const lastSpeechTimeRef = useRef<number>(0);
  const speechStartTimeRef = useRef<number>(0);
  const hasSpeechStartedRef = useRef(false);
  const speechConfidenceRef = useRef(0);
  const silenceConfidenceRef = useRef(0);
  
  // Calibration refs
  const noiseCalibrationSamplesRef = useRef<number[]>([]);
  const noiseFloorRef = useRef(0);
  const calibratedThresholdRef = useRef(0.02);

  // Constants
  const MIN_SPEECH_THRESHOLD = 0.015;
  const MAX_SPEECH_THRESHOLD = 0.08;
  const SPEECH_CONFIRM_FRAMES = 5;
  const SILENCE_CONFIRM_FRAMES = 8;

  const reset = useCallback(() => {
    setSpeechState("idle");
    setRmsLevel(0);
    setIsCalibrated(false);
    setStats({
      peakLevel: 0,
      avgLevel: 0,
      speechDuration: 0,
      calibratedThreshold: 0.02,
      noiseFloor: 0,
    });
    
    hasSpeechStartedRef.current = false;
    speechStartTimeRef.current = 0;
    speechConfidenceRef.current = 0;
    silenceConfidenceRef.current = 0;
    noiseCalibrationSamplesRef.current = [];
    noiseFloorRef.current = 0;
    calibratedThresholdRef.current = 0.02;
  }, []);

  useEffect(() => {
    if (!stream || !enabled) {
      reset();
      return;
    }

    // Create audio context
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.error("[ProSilenceDetector] Failed to create AudioContext:", e);
      return;
    }

    // Resume if suspended
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }

    // Create analyser
    const audioContext = audioContextRef.current;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.3;
    analyserRef.current = analyser;

    // Connect stream
    try {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;
    } catch (e) {
      console.error("[ProSilenceDetector] Failed to connect source:", e);
      return;
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    // Reset state
    noiseCalibrationSamplesRef.current = [];
    setSpeechState("calibrating");
    setIsCalibrated(false);

    console.log("[ProSilenceDetector] Started - Calibrating noise floor...");

    const checkAudio = () => {
      if (!analyserRef.current) return;

      try {
        analyser.getByteFrequencyData(dataArray);
      } catch (e) {
        animationFrameRef.current = requestAnimationFrame(checkAudio);
        return;
      }

      // Calculate RMS
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = dataArray[i] / 255;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      const peakValue = Math.max(...dataArray) / 255;
      
      setRmsLevel(rms);

      const now = Date.now();

      // === PHASE 1: Calibration ===
      if (!isCalibrated) {
        noiseCalibrationSamplesRef.current.push(rms);

        if (noiseCalibrationSamplesRef.current.length >= calibrationSamples) {
          const samples = noiseCalibrationSamplesRef.current;
          const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
          const variance = samples.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / samples.length;
          const stdDev = Math.sqrt(variance);

          noiseFloorRef.current = avg + stdDev;
          
          let threshold = noiseFloorRef.current * noiseMultiplier;
          threshold = Math.max(MIN_SPEECH_THRESHOLD, Math.min(MAX_SPEECH_THRESHOLD, threshold));
          calibratedThresholdRef.current = threshold;

          setIsCalibrated(true);
          setSpeechState("listening");
          setStats(prev => ({
            ...prev,
            calibratedThreshold: threshold,
            noiseFloor: noiseFloorRef.current,
          }));

          console.log(`[ProSilenceDetector] Calibration complete: noise=${noiseFloorRef.current.toFixed(4)}, threshold=${threshold.toFixed(4)}`);
          onCalibrationComplete?.(threshold);
        }

        animationFrameRef.current = requestAnimationFrame(checkAudio);
        return;
      }

      // === PHASE 2: Speech Detection with Hysteresis ===
      const threshold = calibratedThresholdRef.current;
      const isAboveThreshold = rms > threshold;

      // Update stats
      setStats(prev => ({
        ...prev,
        peakLevel: Math.max(prev.peakLevel, peakValue),
        avgLevel: prev.avgLevel * 0.95 + rms * 0.05,
      }));

      if (isAboveThreshold) {
        speechConfidenceRef.current++;
        silenceConfidenceRef.current = 0;

        if (speechConfidenceRef.current >= SPEECH_CONFIRM_FRAMES) {
          if (!hasSpeechStartedRef.current) {
            hasSpeechStartedRef.current = true;
            speechStartTimeRef.current = now;
            setSpeechState("speaking");
            console.log(`[ProSilenceDetector] ✓ Speech CONFIRMED (level: ${rms.toFixed(3)})`);
            onSpeechStart?.();
          }
          lastSpeechTimeRef.current = now;
        }
      } else {
        silenceConfidenceRef.current++;
        speechConfidenceRef.current = Math.max(0, speechConfidenceRef.current - 1);

        if (hasSpeechStartedRef.current && silenceConfidenceRef.current >= SILENCE_CONFIRM_FRAMES) {
          const silenceTime = now - lastSpeechTimeRef.current;
          const speechDuration = lastSpeechTimeRef.current - speechStartTimeRef.current;

          if (silenceTime >= silenceDuration && speechDuration >= minSpeechDuration) {
            setSpeechState("ended");
            setStats(prev => ({
              ...prev,
              speechDuration,
            }));

            console.log(`[ProSilenceDetector] ✓ Speech ENDED: ${speechDuration}ms speech, ${silenceTime}ms silence`);
            onSpeechEnd?.();

            // Reset for next utterance
            hasSpeechStartedRef.current = false;
            speechConfidenceRef.current = 0;
            silenceConfidenceRef.current = 0;
            
            // Don't continue checking after end
            return;
          } else if (silenceTime >= 500) {
            setSpeechState("silence");
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(checkAudio);
    };

    animationFrameRef.current = requestAnimationFrame(checkAudio);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
      }
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, [stream, enabled, silenceDuration, minSpeechDuration, calibrationSamples, noiseMultiplier, onSpeechStart, onSpeechEnd, onCalibrationComplete, reset, isCalibrated]);

  return {
    speechState,
    rmsLevel,
    stats,
    isCalibrated,
    isSpeaking: speechState === "speaking",
    reset,
  };
}

export default useProSilenceDetector;
