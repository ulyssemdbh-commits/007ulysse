import { useCallback, useRef } from "react";

interface AudioContextManagerResult {
  getAudioContext: () => AudioContext | null;
  getAnalyser: () => AnalyserNode | null;
  getTtsAnalyser: () => AnalyserNode | null;
  initAudioContext: () => Promise<AudioContext | null>;
  getAudioEnergy: (analyser: AnalyserNode) => number;
  getMicEnergy: () => number;
  getTtsEnergy: () => number;
  connectInputStream: (stream: MediaStream) => MediaStreamAudioSourceNode | null;
  connectTTSElement: (audio: HTMLAudioElement) => MediaElementAudioSourceNode | null;
  disconnectTTSSource: () => void;
  suspendAudio: () => Promise<void>;
  resumeAudio: () => Promise<void>;
  closeAudioContext: () => Promise<void>;
}

export function useAudioContextManager(): AudioContextManagerResult {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ttsAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const ttsSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const initAudioContext = useCallback(async (): Promise<AudioContext | null> => {
    if (audioContextRef.current) return audioContextRef.current;
    
    try {
      const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return null;
      
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;
      
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;
      
      const ttsAnalyser = ctx.createAnalyser();
      ttsAnalyser.fftSize = 256;
      ttsAnalyser.smoothingTimeConstant = 0.3;
      ttsAnalyserRef.current = ttsAnalyser;
      
      return ctx;
    } catch (err) {
      console.error("[AudioContextManager] Failed to create AudioContext:", err);
      return null;
    }
  }, []);

  const getAudioEnergy = useCallback((analyser: AnalyserNode): number => {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    return sum / dataArray.length;
  }, []);

  const getMicEnergy = useCallback((): number => {
    if (!analyserRef.current) return 0;
    return getAudioEnergy(analyserRef.current);
  }, [getAudioEnergy]);

  const getTtsEnergy = useCallback((): number => {
    if (!ttsAnalyserRef.current) return 0;
    return getAudioEnergy(ttsAnalyserRef.current);
  }, [getAudioEnergy]);

  const getAudioContext = useCallback(() => audioContextRef.current, []);
  const getAnalyser = useCallback(() => analyserRef.current, []);
  const getTtsAnalyser = useCallback(() => ttsAnalyserRef.current, []);

  const connectInputStream = useCallback((stream: MediaStream): MediaStreamAudioSourceNode | null => {
    if (!audioContextRef.current || !analyserRef.current) return null;
    
    try {
      if (audioSourceRef.current) {
        try { audioSourceRef.current.disconnect(); } catch {}
      }
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      audioSourceRef.current = source;
      return source;
    } catch (err) {
      console.error("[AudioContextManager] Failed to connect input stream:", err);
      return null;
    }
  }, []);

  const connectTTSElement = useCallback((audio: HTMLAudioElement): MediaElementAudioSourceNode | null => {
    if (!audioContextRef.current || !ttsAnalyserRef.current) return null;
    
    try {
      if (ttsSourceRef.current) {
        try { ttsSourceRef.current.disconnect(); } catch {}
      }
      const source = audioContextRef.current.createMediaElementSource(audio);
      source.connect(ttsAnalyserRef.current);
      ttsAnalyserRef.current.connect(audioContextRef.current.destination);
      ttsSourceRef.current = source;
      return source;
    } catch (err) {
      console.error("[AudioContextManager] Failed to connect TTS element:", err);
      return null;
    }
  }, []);

  const disconnectTTSSource = useCallback(() => {
    if (ttsSourceRef.current) {
      try { ttsSourceRef.current.disconnect(); } catch {}
      ttsSourceRef.current = null;
    }
    if (ttsAnalyserRef.current) {
      try { ttsAnalyserRef.current.disconnect(); } catch {}
    }
  }, []);

  const suspendAudio = useCallback(async () => {
    if (audioContextRef.current && audioContextRef.current.state === "running") {
      try {
        await audioContextRef.current.suspend();
        console.log("[AudioContextManager] AudioContext suspended");
      } catch (err) {
        console.error("[AudioContextManager] Failed to suspend AudioContext:", err);
      }
    }
  }, []);

  const resumeAudio = useCallback(async () => {
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      try {
        await audioContextRef.current.resume();
        console.log("[AudioContextManager] AudioContext resumed");
      } catch (err) {
        console.error("[AudioContextManager] Failed to resume AudioContext:", err);
      }
    }
  }, []);

  const closeAudioContext = useCallback(async () => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.disconnect(); } catch {}
      audioSourceRef.current = null;
    }
    if (ttsSourceRef.current) {
      try { ttsSourceRef.current.disconnect(); } catch {}
      ttsSourceRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try {
        await audioContextRef.current.close();
        console.log("[AudioContextManager] AudioContext closed");
      } catch {}
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    ttsAnalyserRef.current = null;
  }, []);

  return {
    getAudioContext,
    getAnalyser,
    getTtsAnalyser,
    initAudioContext,
    getAudioEnergy,
    getMicEnergy,
    getTtsEnergy,
    connectInputStream,
    connectTTSElement,
    disconnectTTSSource,
    suspendAudio,
    resumeAudio,
    closeAudioContext,
  };
}
