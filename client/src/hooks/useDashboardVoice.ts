import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeVoice } from "@/hooks/use-realtime-voice";
import { useOpenAIRealtime } from "@/hooks/use-openai-realtime";
import { useRealtimeDiagnostics } from "@/hooks/use-realtime-diagnostics";
import { useConversation } from "@/hooks/use-chat";

interface UseDashboardVoiceOptions {
  userName: string;
  activeConversationId: number | null;
  micPermission?: PermissionState | "unknown";
}

/**
 * Voice mode selection — fixed at page load (Rules of Hooks).
 * Default = "realtime" (OpenAI Realtime API, the new low-latency pipeline).
 * Fallback = "legacy" (the old MediaRecorder/WebM pipeline).
 *
 * Switch via DevTools: `localStorage.setItem("voiceMode","legacy")` + refresh.
 */
const VOICE_MODE: "realtime" | "legacy" =
  typeof window !== "undefined" && window.localStorage?.getItem("voiceMode") === "legacy"
    ? "legacy"
    : "realtime";

if (typeof window !== "undefined") {
  console.log(`[Dashboard Voice] Mode: ${VOICE_MODE}`);
}

// =====================================================================
// NEW: OpenAI Realtime backend — server VAD, PCM16, no WebM headers, <300ms
// =====================================================================
function useDashboardVoiceRealtime({
  userName,
  activeConversationId,
  micPermission,
}: UseDashboardVoiceOptions) {
  const queryClient = useQueryClient();

  const rt = useOpenAIRealtime({ autoConnect: true });
  const [wantsToCall, setWantsToCall] = useState(false);

  const isInCall = rt.isListening || rt.isSpeaking || rt.isProcessing;
  const callState =
    rt.connectionState === "authenticated"
      ? wantsToCall
        ? "in_call"
        : "connected"
      : rt.connectionState === "connecting" || rt.connectionState === "authenticating"
      ? "connecting"
      : "idle";

  const startCall = useCallback(async () => {
    console.log("[Dashboard Voice] Realtime: starting call");
    setWantsToCall(true);
    await rt.startCall();
    if (activeConversationId) {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
    }
  }, [rt, activeConversationId, queryClient]);

  const endCall = useCallback(() => {
    console.log("[Dashboard Voice] Realtime: ending call");
    setWantsToCall(false);
    rt.endCall();
  }, [rt]);

  const diagnostics = useRealtimeDiagnostics();
  const { data: activeConversation } = useConversation(activeConversationId);

  const conversationContext = useMemo(() => {
    return (
      activeConversation?.messages?.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      })) || []
    );
  }, [activeConversation?.messages]);

  // Invalidate conversation cache whenever a turn completes
  useEffect(() => {
    if (rt.transcript && activeConversationId) {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
    }
  }, [rt.transcript, activeConversationId, queryClient]);

  const lastMicPermissionRef = useRef(micPermission);
  useEffect(() => {
    if (micPermission === "denied" && lastMicPermissionRef.current !== "denied") {
      diagnostics.logEvent("voice_permission_denied", "voice", "Microphone permission denied");
    }
    lastMicPermissionRef.current = micPermission;
  }, [micPermission, diagnostics]);

  // Adapter to match the legacy `voiceCall` shape consumed by the rest of the UI
  const voiceCallAdapter = useMemo(
    () => ({
      connectionState: rt.connectionState,
      voiceState: rt.voiceState,
      isListening: rt.isListening,
      isSpeaking: rt.isSpeaking,
      isProcessing: rt.isProcessing,
      isAuthenticated: rt.isAuthenticated,
      transcript: rt.transcript,
      lastResponse: rt.transcript,
      error: rt.error,
      sendTextMessage: rt.sendText,
      startListening: () => rt.startCall(),
      stopListening: () => rt.endCall(),
      cancel: () => rt.endCall(),
      connect: rt.connect,
      disconnect: rt.disconnect,
      unlockAudio: async () => {},
      requestMicrophoneAccess: async () => true,
      sendAuth: () => {},
      isProcessingBlocked: () => false,
      sessionId: null,
      startCallMode: () => {},
      endCallMode: () => {},
    }),
    [rt]
  );

  return {
    voiceCall: voiceCallAdapter,
    wantsToCall,
    setWantsToCall,
    isInCall,
    callState,
    startCall,
    endCall,
    realtime: voiceCallAdapter,
    diagnostics,
    conversationContext,
  };
}

// =====================================================================
// LEGACY: kept as fallback (set localStorage.voiceMode = "legacy")
// =====================================================================
function useDashboardVoiceLegacy({
  userName,
  activeConversationId,
  micPermission,
}: UseDashboardVoiceOptions) {
  const queryClient = useQueryClient();

  const voiceCall = useRealtimeVoice({
    userName,
    conversationId: activeConversationId ?? undefined,
    channel: "talking-v2",
    onTranscript: (text) => {
      console.log("[Dashboard Legacy] Transcript:", text);
      if (activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
      }
    },
    onResponse: (text) => {
      console.log("[Dashboard Legacy] Response:", text);
      if (activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
      }
    },
    onError: (error) => {
      console.error("[Dashboard Legacy] Error:", error);
    },
  });

  const [wantsToCall, setWantsToCall] = useState(false);

  const isInCall = voiceCall.isListening || voiceCall.isSpeaking;
  const callState =
    voiceCall.connectionState === "authenticated"
      ? voiceCall.isListening
        ? "in_call"
        : "connected"
      : voiceCall.connectionState === "connecting" || voiceCall.connectionState === "authenticating"
      ? "connecting"
      : "idle";

  const voiceState = voiceCall.voiceState;
  const callModeStartedRef = useRef(false);
  useEffect(() => {
    if (voiceCall.isProcessingBlocked?.()) return;
    if (
      wantsToCall &&
      voiceCall.connectionState === "authenticated" &&
      !voiceCall.isListening &&
      voiceState !== "processing"
    ) {
      if (!callModeStartedRef.current) {
        voiceCall.startCallMode(activeConversationId ?? undefined);
        callModeStartedRef.current = true;
      }
      voiceCall.startListening();
    }
    if (!wantsToCall) callModeStartedRef.current = false;
  }, [
    wantsToCall,
    voiceCall.connectionState,
    voiceCall.isListening,
    voiceState,
    voiceCall,
    activeConversationId,
  ]);

  const startCall = useCallback(async () => {
    setWantsToCall(true);
    voiceCall.connect();
  }, [voiceCall]);

  const endCall = useCallback(() => {
    setWantsToCall(false);
    callModeStartedRef.current = false;
    voiceCall.endCallMode();
    voiceCall.stopListening();
    voiceCall.disconnect();
  }, [voiceCall]);

  const diagnostics = useRealtimeDiagnostics();
  const { data: activeConversation } = useConversation(activeConversationId);

  const conversationContext = useMemo(() => {
    return (
      activeConversation?.messages?.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      })) || []
    );
  }, [activeConversation?.messages]);

  const realtime = voiceCall;

  const lastMicPermissionRef = useRef(micPermission);
  useEffect(() => {
    if (micPermission === "denied" && lastMicPermissionRef.current !== "denied") {
      diagnostics.logEvent("voice_permission_denied", "voice", "Microphone permission denied");
    }
    lastMicPermissionRef.current = micPermission;
  }, [micPermission, diagnostics]);

  return {
    voiceCall,
    wantsToCall,
    setWantsToCall,
    isInCall,
    callState,
    startCall,
    endCall,
    realtime,
    diagnostics,
    conversationContext,
  };
}

export const useDashboardVoice =
  VOICE_MODE === "realtime" ? useDashboardVoiceRealtime : useDashboardVoiceLegacy;
