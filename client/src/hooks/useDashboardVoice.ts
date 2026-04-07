import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeVoice } from "@/hooks/use-realtime-voice";
import { useRealtimeDiagnostics } from "@/hooks/use-realtime-diagnostics";
import { useConversation } from "@/hooks/use-chat";

interface UseDashboardVoiceOptions {
  userName: string;
  activeConversationId: number | null;
  micPermission?: PermissionState | "unknown";
}

export function useDashboardVoice({ userName, activeConversationId, micPermission }: UseDashboardVoiceOptions) {
  const queryClient = useQueryClient();

  const voiceCall = useRealtimeVoice({
    userName,
    conversationId: activeConversationId ?? undefined,
    channel: "talking-v2",
    onTranscript: (text) => {
      console.log("[Dashboard V3 Pro] Transcript:", text);
      if (activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
      }
    },
    onResponse: (text) => {
      console.log("[Dashboard V3 Pro] Response:", text);
      if (activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
      }
    },
    onError: (error) => {
      console.error("[Dashboard V3 Pro] Error:", error);
    },
  });

  const [wantsToCall, setWantsToCall] = useState(false);

  const isInCall = voiceCall.isListening || voiceCall.isSpeaking;
  const callState = voiceCall.connectionState === "authenticated"
    ? (voiceCall.isListening ? "in_call" : "connected")
    : voiceCall.connectionState === "connecting" || voiceCall.connectionState === "authenticating"
      ? "connecting"
      : "idle";

  const voiceState = voiceCall.voiceState;
  useEffect(() => {
    if (voiceCall.isProcessingBlocked?.()) {
      console.log("[Dashboard V3 Pro] Restart blocked - still processing audio");
      return;
    }
    if (wantsToCall && voiceCall.connectionState === "authenticated" && !voiceCall.isListening && voiceState !== "processing") {
      console.log("[Dashboard V3 Pro] Auto-starting listening after auth...");
      voiceCall.startListening();
    }
  }, [wantsToCall, voiceCall.connectionState, voiceCall.isListening, voiceState, voiceCall]);

  const startCall = useCallback(async () => {
    console.log("[Dashboard V3 Pro] Starting call...");
    setWantsToCall(true);
    voiceCall.connect();
  }, [voiceCall]);

  const endCall = useCallback(() => {
    console.log("[Dashboard V3 Pro] Ending call...");
    setWantsToCall(false);
    voiceCall.stopListening();
    voiceCall.disconnect();
  }, [voiceCall]);

  const diagnostics = useRealtimeDiagnostics();

  const { data: activeConversation } = useConversation(activeConversationId);

  const conversationContext = useMemo(() => {
    return activeConversation?.messages?.slice(-10).map(m => ({
      role: m.role,
      content: m.content
    })) || [];
  }, [activeConversation?.messages]);

  const realtimeRef = useRef<ReturnType<typeof useRealtimeVoice> | null>(null);

  const realtime = useRealtimeVoice({
    context: conversationContext,
    conversationId: activeConversationId ?? undefined,
    onTranscript: (text) => {
      console.log("Realtime transcript:", text);
    },
    onResponse: (text) => {
      console.log("Realtime response:", text);
      if (activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
      }
    },
    onError: (error) => {
      console.error("Realtime error:", error);
      diagnostics.trackVoiceError("websocket", `Realtime voice error: ${error}`, undefined, async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        realtimeRef.current?.disconnect();
        await new Promise(resolve => setTimeout(resolve, 500));
        realtimeRef.current?.connect();
        return true;
      });
    }
  });

  useEffect(() => {
    realtimeRef.current = realtime;
  }, [realtime]);

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
