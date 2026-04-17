/**
 * OpenAI Realtime API proxy.
 *
 * Standard de l'industrie 2026 (utilisé par ChatGPT Voice, Vapi, LiveKit Agents).
 * Élimine TOUS les bugs de l'ancien système :
 *   - Plus de MediaRecorder/WebM/EBML (PCM16 raw 24kHz direct)
 *   - Plus de silence detection custom (server_vad d'OpenAI)
 *   - Plus de pipeline STT→LLM→TTS séparé (1 seul model gpt-4o-realtime)
 *   - Latence <300ms, barge-in natif
 *
 * Architecture : client <-WS-> ce proxy <-WS-> wss://api.openai.com/v1/realtime
 * Le proxy injecte le system prompt (persona + perspicacité), gère l'auth session,
 * trace l'activité dans voiceActivityService.
 */

import { WebSocketServer, WebSocket as WsWebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { validateWebSocketSession } from "../realtimeSync";
import { getPersonaForSpeaker, getPersonaPromptContext } from "../../config/personaMapping";
import { voiceActivityService } from "./activity";

const OPENAI_REALTIME_URL =
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";

interface ProxySession {
  client: WsWebSocket;
  upstream: WsWebSocket | null;
  userId?: number;
  userName?: string;
  persona?: "ulysse" | "iris" | "alfred";
  isAuthenticated: boolean;
  isInCall: boolean;
  upstreamReady: boolean;
  pendingAudio: string[]; // base64 chunks awaiting upstream ready
  lastTranscript: string;
  lastResponse: string;
  httpRequest: IncomingMessage;
}

const sessions = new Map<WsWebSocket, ProxySession>();
let wss: WebSocketServer | null = null;

function send(ws: WsWebSocket, payload: any) {
  if (ws.readyState === WsWebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function openUpstream(session: ProxySession) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    send(session.client, { type: "error", error: "OPENAI_API_KEY missing on server" });
    session.client.close(1011, "OPENAI_API_KEY missing");
    return;
  }

  const upstream = new WsWebSocket(OPENAI_REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });
  session.upstream = upstream;

  upstream.on("open", () => {
    console.log(`[OpenAIRealtime] Upstream connected for user ${session.userId}`);

    // Build system prompt from persona + perspicacité (already injected in personaMapping)
    const speakerId = session.userName?.toLowerCase().trim() || null;
    const personaConfig = getPersonaForSpeaker(speakerId);
    session.persona = personaConfig.persona;
    const instructions = getPersonaPromptContext(personaConfig);

    // Configure the session : audio in/out PCM16 24kHz, server-side VAD, voice "alloy"
    upstream.send(
      JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions,
          voice: "alloy",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
          temperature: 0.8,
          max_response_output_tokens: 4096,
        },
      })
    );

    session.upstreamReady = true;
    send(session.client, { type: "ready", persona: session.persona });

    // Flush any audio that arrived before upstream was open
    for (const chunk of session.pendingAudio) {
      upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk }));
    }
    session.pendingAudio = [];
  });

  upstream.on("message", (raw) => {
    let event: any;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        send(session.client, { type: "speech_started" });
        break;

      case "input_audio_buffer.speech_stopped":
        send(session.client, { type: "speech_stopped" });
        break;

      case "conversation.item.input_audio_transcription.completed":
        session.lastTranscript = event.transcript || "";
        send(session.client, { type: "user_transcript", text: session.lastTranscript });
        break;

      case "response.audio.delta":
        // PCM16 base64 chunk for playback
        send(session.client, { type: "audio_delta", data: event.delta });
        break;

      case "response.audio_transcript.delta":
        send(session.client, { type: "transcript_delta", text: event.delta });
        break;

      case "response.audio_transcript.done":
        session.lastResponse = event.transcript || "";
        send(session.client, { type: "response_text", text: session.lastResponse });
        break;

      case "response.done":
        send(session.client, {
          type: "response_done",
          transcript: session.lastResponse,
          userTranscript: session.lastTranscript,
        });
        break;

      case "error":
        console.error(`[OpenAIRealtime] Upstream error:`, event.error);
        send(session.client, { type: "error", error: event.error?.message || "upstream error" });
        break;

      case "session.created":
      case "session.updated":
      case "rate_limits.updated":
      case "response.created":
      case "response.output_item.added":
      case "response.content_part.added":
      case "response.content_part.done":
      case "response.output_item.done":
      case "conversation.item.created":
      case "input_audio_buffer.committed":
        // silent — internal lifecycle events
        break;

      default:
        // forward unknown events as-is for client-side flexibility
        send(session.client, { type: `_raw_${event.type}`, event });
    }
  });

  upstream.on("close", (code, reason) => {
    console.log(`[OpenAIRealtime] Upstream closed: ${code} ${reason}`);
    send(session.client, { type: "upstream_closed", code });
    session.upstreamReady = false;
    if (session.client.readyState === WsWebSocket.OPEN) {
      session.client.close(1000, "upstream closed");
    }
  });

  upstream.on("error", (err) => {
    console.error(`[OpenAIRealtime] Upstream error:`, err.message);
    send(session.client, { type: "error", error: `upstream: ${err.message}` });
  });
}

async function handleClientMessage(session: ProxySession, raw: any) {
  let msg: any;
  try {
    msg = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(raw.toString());
  } catch {
    return;
  }

  // --- Auth flow (must come first) ---
  if (msg.type === "auth") {
    const result = await validateWebSocketSession(session.httpRequest);
    if (!result) {
      send(session.client, { type: "auth.failed", error: "Session validation required" });
      return;
    }
    session.userId = result.userId;
    session.userName = result.displayName || result.username || msg.userName;
    session.isAuthenticated = true;
    console.log(`[OpenAIRealtime] Authenticated userId=${session.userId} (${session.userName})`);
    send(session.client, { type: "auth.ok", userId: session.userId, userName: session.userName });

    // Open the upstream connection NOW that we know who the user is
    await openUpstream(session);
    return;
  }

  if (!session.isAuthenticated) {
    send(session.client, { type: "error", error: "not authenticated" });
    return;
  }

  // --- Audio in (PCM16 base64) ---
  if (msg.type === "audio" && typeof msg.data === "string") {
    if (!session.upstreamReady || !session.upstream) {
      session.pendingAudio.push(msg.data);
      // cap pending to avoid memory blow-up if upstream never opens
      if (session.pendingAudio.length > 100) session.pendingAudio.shift();
      return;
    }
    session.upstream.send(
      JSON.stringify({ type: "input_audio_buffer.append", audio: msg.data })
    );
    return;
  }

  // --- Text input ---
  if (msg.type === "text" && typeof msg.text === "string") {
    if (!session.upstream) return;
    session.upstream.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: msg.text }],
        },
      })
    );
    session.upstream.send(JSON.stringify({ type: "response.create" }));
    return;
  }

  // --- Start call: marks user as in-call (triggers brain pulse via voiceActivityService) ---
  if (msg.type === "start_call") {
    session.isInCall = true;
    if (session.userId) voiceActivityService.setInCall(session.userId, true);
    send(session.client, { type: "call_started" });
    return;
  }

  if (msg.type === "end_call") {
    session.isInCall = false;
    if (session.userId) voiceActivityService.setInCall(session.userId, false);
    // Cancel any in-flight response
    session.upstream?.send(JSON.stringify({ type: "response.cancel" }));
    send(session.client, { type: "call_ended" });
    return;
  }

  // --- Barge-in: user started talking while assistant was speaking ---
  if (msg.type === "interrupt") {
    session.upstream?.send(JSON.stringify({ type: "response.cancel" }));
    return;
  }
}

export function setupOpenAIRealtime(): WebSocketServer {
  wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  console.log("[OpenAIRealtime] WebSocket server initialized on /ws/voice-realtime");

  wss.on("connection", (ws: WsWebSocket, request: IncomingMessage) => {
    console.log("[OpenAIRealtime] Client connected");
    const session: ProxySession = {
      client: ws,
      upstream: null,
      isAuthenticated: false,
      isInCall: false,
      upstreamReady: false,
      pendingAudio: [],
      lastTranscript: "",
      lastResponse: "",
      httpRequest: request,
    };
    sessions.set(ws, session);

    // 30s auth timeout
    const authTimeout = setTimeout(() => {
      if (!session.isAuthenticated) {
        console.log("[OpenAIRealtime] Auth timeout");
        ws.close(4001, "auth timeout");
      }
    }, 30_000);

    // 25s ping keep-alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WsWebSocket.OPEN) ws.ping();
    }, 25_000);

    send(ws, { type: "connected", message: "OpenAI Realtime proxy ready - authenticate" });

    ws.on("message", (data) => {
      handleClientMessage(session, data).catch((err) =>
        console.error("[OpenAIRealtime] handleClientMessage error:", err)
      );
    });

    ws.on("close", () => {
      console.log(`[OpenAIRealtime] Client disconnected (userId=${session.userId})`);
      clearTimeout(authTimeout);
      clearInterval(pingInterval);
      if (session.userId) voiceActivityService.setInCall(session.userId, false);
      session.upstream?.close();
      sessions.delete(ws);
    });

    ws.on("error", (err) => {
      console.error("[OpenAIRealtime] Client WS error:", err.message);
    });
  });

  return wss;
}

export function handleOpenAIRealtimeUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
) {
  if (wss) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss!.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
}
