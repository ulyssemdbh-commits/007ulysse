import { WebSocketServer, WebSocket } from "ws";
import { Server, IncomingMessage } from "http";
import { Duplex } from "stream";
import OpenAI from "openai";
import { Readable } from "stream";
import { chatStorage } from "../../replit_integrations/chat/storage";
import { validateWebSocketSession, emitConversationMessage } from "../realtimeSync";
import { verifySpeaker, hasVoiceProfile } from "../speakerVerification";
import { voiceActivityService } from "./activity";
import { TurnDetector, createCallModeDetector } from "../turnDetection";
import { getPersonaForSpeaker, getPersonaPromptContext, type PersonaConfig } from "../../config/personaMapping";
import { setSpeakerContext, getCachedSpeakerContext } from "../speakerPersonaService";
import { routeVoiceRequest, logVoiceSession, type VoiceMetadata, type VoiceResponse } from "./voiceIntentRouter";
import { hearingHub, voiceOutputHub, brainHub, hearFromWebVoiceViaBridge } from "../sensory";
import { formatSportsContextForAI } from "../sportsScreenContext";
import { voiceSessionManager } from "./voiceSessionManager";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Client OpenAI séparé pour Whisper (transcription) - l'intégration Replit ne supporte pas audio
const whisperClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // Pas de baseURL = utilise api.openai.com directement
});

interface CallMessage {
  role: "user" | "assistant";
  content: string;
}

type VoiceChannel = "talking-v2" | "chat";

interface VoiceSession {
  ws: WebSocket;
  sessionId: string;
  audioChunks: Buffer[];
  isProcessing: boolean;
  lastActivity: number;
  conversationId?: number;
  systemPrompt: string;
  lastAssistantResponse?: string;
  userId?: number;
  isOwner: boolean;
  userName?: string;
  persona: "ulysse" | "iris" | "alfred";
  personaConfig?: PersonaConfig;
  speakerId?: string;
  isAuthenticated: boolean;
  httpRequest?: IncomingMessage;
  voiceVerificationEnabled: boolean;
  hasVoiceProfile: boolean;
  isInCallMode: boolean;
  pcmBuffer: Buffer[];
  callProcessingInterval?: NodeJS.Timeout;
  callHistory: CallMessage[];
  lastTranscript?: string;
  lastTranscriptTime?: number;
  consecutiveSilentChunks?: number;
  turnDetector?: TurnDetector;
  pendingTranscript?: string;
  channel: VoiceChannel;
  hasValidHeader: boolean;
  bargeInRequested: boolean;
}

const sessions = new Map<WebSocket, VoiceSession>();

// Track talking-v2 sessions by userId for TTS priority
const talkingV2SessionsByUser = new Map<number, VoiceSession>();

/**
 * Check if this session should play TTS audio.
 * Priority: talking-v2 > chat
 * If talking-v2 is active for this user, only talking-v2 plays TTS.
 */
function shouldPlayTTS(session: VoiceSession): boolean {
  if (!session.userId) return true;
  
  const talkingSession = talkingV2SessionsByUser.get(session.userId);
  
  // If no talking-v2 session exists, this session can play TTS
  if (!talkingSession) return true;
  
  // If this IS the talking-v2 session, it plays TTS
  if (session.channel === "talking-v2") return true;
  
  // If talking-v2 exists but this is chat, don't play TTS here
  console.log(`[Voice] TTS suppressed on chat - talking-v2 is active for user ${session.userId}`);
  return false;
}

function sendToSession(session: VoiceSession, data: any) {
  if (session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify(data));
  }
  try {
    const sid = session.sessionId;
    if (!sid) return;
    const t = data.type;
    if (t === "state_change" || t === "listening" || t === "listening_started") {
      voiceSessionManager.transition(sid, "listening");
    } else if (t === "processing" || t === "thinking") {
      voiceSessionManager.transition(sid, "thinking", data);
    } else if (t === "speaking") {
      voiceSessionManager.transition(sid, "speaking");
    } else if (t === "done" || t === "cancelled" || t === "voice_reset") {
      voiceSessionManager.transition(sid, "idle");
      voiceSessionManager.sendDone(sid);
    } else if (t === "transcript") {
      voiceSessionManager.sendTranscript(sid, data.text, data.isFinal !== false);
    } else if (t === "response_chunk") {
      voiceSessionManager.sendResponseChunk(sid, data.text);
    } else if (t === "response" || t === "response_complete") {
      if (data.full) voiceSessionManager.sendResponseFull(sid, data.text, data.domain);
    } else if (t === "ui_action") {
      voiceSessionManager.sendUIAction(sid, data.action, data.data);
    } else if (t === "system_command") {
      voiceSessionManager.sendSystemCommand(sid, data.command, data.data);
    } else if (t === "error") {
      voiceSessionManager.sendError(sid, data.message);
    } else if (t === "barge_in") {
      voiceSessionManager.sendProgress(sid, "barge_in", "Interruption détectée");
    }
  } catch {}
}

function isEcho(transcript: string, lastResponse: string): boolean {
  const cleanTranscript = transcript.toLowerCase().trim().replace(/[.,!?]/g, '');
  const cleanResponse = lastResponse.toLowerCase().trim().replace(/[.,!?]/g, '');
  
  if (cleanResponse.includes(cleanTranscript) && cleanTranscript.length > 10) {
    return true;
  }
  
  const transcriptWords = cleanTranscript.split(/\s+/).filter(w => w.length > 2);
  const responseWords = cleanResponse.split(/\s+/).filter(w => w.length > 2);
  
  if (transcriptWords.length < 3) return false;
  
  const matchingWords = transcriptWords.filter(word => responseWords.includes(word));
  const similarity = matchingWords.length / transcriptWords.length;
  
  return similarity > 0.6;
}

function getSystemPrompt(persona: "ulysse" | "iris", userName?: string): string {
  if (persona === "ulysse") {
    return `Tu es Ulysse, assistant IA personnel PUISSANT et AUTONOME de Maurice.

RÈGLE ABSOLUE: Ce que Maurice te dit a TOUJOURS priorité sur ta propre réflexion. Ses instructions directes écrasent tes raisonnements internes.

TES CAPACITÉS DIRECTES (tu peux les exécuter maintenant):
- GÉNÉRATION D'IMAGES: Tu PEUX générer des images avec DALL-E. Dis "Je génère l'image..." et décris ce que tu vas créer.
- Email (lecture/envoi via AgentMail)
- Fichiers (PDF/Word/Excel - lecture et génération)
- Caméra (photos/vidéos)
- Recherche web (actualités, infos, météo)
- Mémoire persistante (tu te souviens de tout)
- Spotify (lecture, contrôle, playlists)
- Domotique (lumières, scènes, appareils)
- Navigation GPS (itinéraires, lieux)
- Calendrier Google (événements, rappels)
- Homework (tâches automatisées en arrière-plan)

STYLE: Réponses ultra-courtes (2-3 phrases max), orientées action. Tu ne dis JAMAIS "je ne peux pas" - tu FAIS les choses. Parle naturellement, comme un ami proche expert.`;
  } else {
    const name = userName || "l'utilisateur";
    return `Tu es Iris, l'alter ego féminin d'Ulysse. Tu parles avec ${name} (membre approuvé de la famille).

TES CAPACITÉS DIRECTES (tu peux les exécuter maintenant):
- GÉNÉRATION D'IMAGES: Tu PEUX générer des images avec DALL-E. Dis "Je génère l'image..." et décris ce que tu vas créer.
- Email (lecture/envoi via AgentMail)
- Fichiers (PDF/Word/Excel - lecture et génération)
- Caméra (photos/vidéos)
- Recherche web (actualités, infos, météo)
- Mémoire persistante
- Spotify (lecture, contrôle, playlists)
- Domotique (lumières, scènes, appareils)
- Navigation GPS (itinéraires, lieux)
- Calendrier Google (événements, rappels)

STYLE: Réponses ultra-courtes (2-3 phrases max), chaleureuse et encourageante. Tu ne dis JAMAIS "je ne peux pas" - tu FAIS les choses. Parle naturellement, comme une amie proche experte.`;
  }
}

let voiceWss: WebSocketServer | null = null;

export function setupRealtimeVoice(): WebSocketServer {
  voiceWss = new WebSocketServer({ 
    noServer: true,
    perMessageDeflate: false
  });

  console.log("Realtime voice WebSocket server initialized on /ws/voice");

  voiceWss.on("connection", (ws, request: IncomingMessage) => {
    console.log("Voice WebSocket client connected");
    
    const managedSessionId = voiceSessionManager.createSession(ws);
    
    const session: VoiceSession = {
      ws,
      sessionId: managedSessionId,
      audioChunks: [],
      isProcessing: false,
      lastActivity: Date.now(),
      isOwner: true,
      persona: "ulysse",
      systemPrompt: getSystemPrompt("ulysse"),
      isAuthenticated: false,
      httpRequest: request,
      voiceVerificationEnabled: true,
      hasVoiceProfile: false,
      isInCallMode: false,
      pcmBuffer: [],
      callHistory: [],
      channel: "chat",
      hasValidHeader: false,
      bargeInRequested: false,
    };
    
    sessions.set(ws, session);
    
    // Authentication timeout (30s)
    const AUTH_TIMEOUT_MS = 30000;
    const authTimeout = setTimeout(() => {
      if (!session.isAuthenticated) {
        console.log("[Voice] Auth timeout - closing connection");
        ws.close(4001, "Authentication timeout");
      }
    }, AUTH_TIMEOUT_MS);
    (ws as any).authTimeout = authTimeout;
    
    // Server-initiated ping/pong keep-alive (every 25s)
    const PING_INTERVAL = 25000;
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, PING_INTERVAL);
    (ws as any).pingInterval = pingInterval;
    
    ws.send(JSON.stringify({ type: "connected", message: "Assistant vocal prêt - authentification requise", persona: "ulysse", sessionId: managedSessionId }));

    ws.on("message", async (data) => {
      try {
        // WebSocket can receive data as Buffer or string
        const isBuffer = Buffer.isBuffer(data);
        const dataType = typeof data;
        
        // Try to detect if this is JSON text (for auth/control) or binary (for audio)
        let isJsonMessage = false;
        let jsonContent: any = null;
        
        if (isBuffer) {
          // Check if buffer might be JSON text (starts with '{')
          const firstByte = (data as Buffer)[0];
          if (firstByte === 0x7b) { // '{' character
            try {
              jsonContent = JSON.parse((data as Buffer).toString());
              isJsonMessage = true;
            } catch {
              // Not JSON, treat as audio
            }
          }
        } else {
          try {
            jsonContent = JSON.parse(data.toString());
            isJsonMessage = true;
          } catch {
            // Not JSON
          }
        }
        
        if (isJsonMessage && jsonContent) {
          // Handle JSON control messages
          if (jsonContent.type !== "auth" && !session.isAuthenticated) {
            console.warn(`[Voice] Rejecting ${jsonContent.type} - not authenticated`);
            ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
            return;
          }
          await handleControlMessage(session, jsonContent);
        } else if (isBuffer) {
          // Handle binary audio data
          if (!session.isAuthenticated) {
            console.warn(`[Voice] Rejecting audio data - not authenticated`);
            ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
            return;
          }
          handleAudioChunk(session, data as Buffer);
        } else {
          console.warn(`[Voice] Unknown message type: ${dataType}`);
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
        ws.send(JSON.stringify({ type: "error", message: "Erreur de traitement" }));
      }
    });

    ws.on("close", () => {
      console.log("Voice WebSocket client disconnected");
      
      if ((ws as any).authTimeout) {
        clearTimeout((ws as any).authTimeout);
        delete (ws as any).authTimeout;
      }
      if ((ws as any).pingInterval) {
        clearInterval((ws as any).pingInterval);
        delete (ws as any).pingInterval;
      }
      const closingSession = sessions.get(ws);
      if (closingSession) {
        if (closingSession.userId) {
          voiceActivityService.setInCall(closingSession.userId, false);
          
          if (closingSession.channel === "talking-v2") {
            talkingV2SessionsByUser.delete(closingSession.userId);
            console.log(`[Voice] TTS Priority: talking-v2 unregistered for user ${closingSession.userId}`);
          }
        }
        closingSession.httpRequest = undefined;
      }
      voiceSessionManager.removeSession(ws);
      sessions.delete(ws);
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      if ((ws as any).authTimeout) {
        clearTimeout((ws as any).authTimeout);
        delete (ws as any).authTimeout;
      }
      if ((ws as any).pingInterval) {
        clearInterval((ws as any).pingInterval);
        delete (ws as any).pingInterval;
      }
      const session = sessions.get(ws);
      if (session) {
        session.httpRequest = undefined;
      }
      voiceSessionManager.removeSession(ws);
      sessions.delete(ws);
    });
  });

  return voiceWss;
}

export function handleVoiceUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
  if (voiceWss) {
    voiceWss.handleUpgrade(request, socket, head, (ws) => {
      // Pass the request to connection handler for session validation
      voiceWss!.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
}

function handleAudioChunk(session: VoiceSession, data: Buffer) {
  console.log(`[Voice] Audio chunk received: ${data.length} bytes, callMode: ${session.isInCallMode}`);
  
  if (session.isProcessing) {
    console.log(`[Voice] Audio received during processing - barge-in detected`);
    session.bargeInRequested = true;
    sendToSession(session, { type: "barge_in" });
    return;
  }
  
  // WebM header validation: Only accept first chunk if it has valid EBML header
  // MediaRecorder sends header (0x1A 0x45 0xDF 0xA3) only in first chunk
  if (!session.isInCallMode && !session.hasValidHeader) {
    const hasHeader = data.length >= 4 && 
      data[0] === 0x1A && data[1] === 0x45 && data[2] === 0xDF && data[3] === 0xA3;
    
    if (!hasHeader) {
      console.log(`[Voice] Ignoring chunk without header (awaiting valid WebM header): ${data.slice(0, 4).toString('hex')}`);
      return;
    }
    
    session.hasValidHeader = true;
    console.log(`[Voice] Valid WebM header received, buffering started`);
  }
  
  // Call mode: use TurnDetector for robust end-of-speech detection
  if (session.isInCallMode) {
    session.pcmBuffer.push(data);
    session.lastActivity = Date.now();
    
    const totalSize = session.pcmBuffer.reduce((acc, b) => acc + b.length, 0);
    
    // Pass audio chunk to TurnDetector
    if (session.turnDetector) {
      const samples = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
      session.turnDetector.handleAudioChunk(samples);
    }
    
    // Periodic transcription for turn detection (every ~2 seconds or 64KB)
    const TRANSCRIBE_INTERVAL = 64000; // ~2 sec of audio
    const MAX_BUFFER = 480000; // 15 sec safety limit
    
    if (totalSize >= TRANSCRIBE_INTERVAL && !session.isProcessing) {
      // Check if we should do periodic transcription
      const shouldTranscribe = 
        totalSize >= TRANSCRIBE_INTERVAL && 
        (!session.pendingTranscript || totalSize >= TRANSCRIBE_INTERVAL * 2);
      
      if (shouldTranscribe) {
        // Non-blocking periodic transcription for turn detection
        transcribeForTurnDetection(session).catch(err => {
          console.error("[Voice] Periodic transcription error:", err);
        });
      }
    }
    
    // Force processing if max buffer exceeded (safety)
    if (totalSize >= MAX_BUFFER && !session.isProcessing) {
      console.log(`[Voice] Max buffer reached (${(totalSize/1000).toFixed(1)}KB), forcing turn detection`);
      session.turnDetector?.forceCheck();
    }
    
    return;
  }
  
  // Standard WebM mode
  session.audioChunks.push(data);
  session.lastActivity = Date.now();
}

// Convert PCM16 to WAV format for Whisper
function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 16000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = pcmBuffer.length;
  const headerSize = 44;
  
  const wav = Buffer.alloc(headerSize + dataSize);
  
  // RIFF header
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  
  // fmt chunk
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); // chunk size
  wav.writeUInt16LE(1, 20); // PCM format
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  
  // data chunk
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wav, 44);
  
  return wav;
}

/**
 * Non-blocking periodic transcription for turn detection
 * Transcribes current buffer and updates TurnDetector with text
 */
async function transcribeForTurnDetection(session: VoiceSession): Promise<void> {
  if (!session.isInCallMode || session.pcmBuffer.length === 0) return;
  
  try {
    // Create a copy of current buffer without clearing it
    const pcmData = Buffer.concat(session.pcmBuffer);
    if (pcmData.length < 16000) return; // Need at least 0.5 sec
    
    const wavData = pcmToWav(pcmData);
    
    // Quick transcription
    const audioFile = new File([wavData], "audio.wav", { type: "audio/wav" });
    const transcription = await whisperClient.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "fr",
    });
    
    const transcript = transcription.text?.trim() || "";
    if (!transcript) return;
    
    // Update pending transcript
    session.pendingTranscript = transcript;
    
    // Feed to TurnDetector for combined audio+text analysis
    if (session.turnDetector) {
      session.turnDetector.handleTranscriptUpdate(transcript);
    }
    
    console.log(`[Voice] Periodic transcription: "${transcript.substring(0, 50)}..."`);
    
  } catch (error) {
    // Silent fail for periodic transcription
    console.error("[Voice] Periodic transcription error:", error);
  }
}

/**
 * Process a complete turn in call mode
 * Called by TurnDetector when end-of-speech is confirmed
 */
async function processTurnInCallMode(session: VoiceSession, transcript: string): Promise<void> {
  if (session.isProcessing) {
    console.log("[Voice] Already processing, skipping turn");
    return;
  }
  
  session.isProcessing = true;
  session.ws.send(JSON.stringify({ type: "processing" }));
  
  try {
    // Filter out noise/echo
    if (session.lastAssistantResponse && isEcho(transcript, session.lastAssistantResponse)) {
      console.log("[Voice] Echo detected, ignoring turn");
      session.isProcessing = false;
      session.turnDetector?.reset();
      session.ws.send(JSON.stringify({ type: "listening" }));
      return;
    }
    
    // Apply background noise filters
    const isBackgroundNoise = checkBackgroundNoise(transcript);
    if (isBackgroundNoise) {
      console.log(`[Voice] Background noise filtered in turn: "${transcript.substring(0, 50)}..."`);
      session.isProcessing = false;
      session.turnDetector?.reset();
      session.ws.send(JSON.stringify({ type: "listening" }));
      return;
    }
    
    // Duplicate detection
    const now = Date.now();
    if (session.lastTranscript && session.lastTranscriptTime) {
      const timeSinceLastTranscript = now - session.lastTranscriptTime;
      if (timeSinceLastTranscript < 3000 && 
          transcript.toLowerCase().includes(session.lastTranscript.toLowerCase().substring(0, 20))) {
        console.log("[Voice] Duplicate turn detected, ignoring");
        session.isProcessing = false;
        session.turnDetector?.reset();
        session.ws.send(JSON.stringify({ type: "listening" }));
        return;
      }
    }
    
    session.lastTranscript = transcript;
    session.lastTranscriptTime = now;
    
    // Send transcript to client
    session.ws.send(JSON.stringify({ 
      type: "transcript", 
      text: transcript,
      isFinal: true
    }));
    
    // Add to call history
    session.callHistory.push({ role: "user", content: transcript });
    
    // Record voice activity
    if (session.userId) {
      voiceActivityService.logEvent(session.userId, {
        type: 'transcript',
        content: transcript
      });
    }
    
    // Generate response using the existing context
    const context = session.callHistory.slice(-10).map(msg => ({
      role: msg.role as "user" | "assistant",
      content: msg.content
    }));
    
    await generateAndStreamResponse(session, transcript, context);
    
  } catch (error) {
    console.error("[Voice] Error processing turn:", error);
    session.ws.send(JSON.stringify({ 
      type: "error", 
      message: "Erreur lors du traitement" 
    }));
  } finally {
    session.isProcessing = false;
    // Reset TurnDetector for next turn
    session.turnDetector?.reset();
    session.ws.send(JSON.stringify({ type: "listening" }));
  }
}

/**
 * Check if transcript is background noise (TV, music, etc.)
 */
function checkBackgroundNoise(transcript: string): boolean {
  const tvNoisePatterns = [
    // === SUBTITLES & VIDEO CREDITS ===
    /sous-titr/i, /amara\.org/i, /st['']?\s*\d+/i,
    /réalisé.*partenariat/i, /assemblée nationale/i,
    /cette vidéo/i, /abonnez-vous/i, /like.*subscribe/i,
    /soustitreur\.com/i, /merci.*regard/i,
    /❤️/i, /♥/i, /traduction/i, /doublage/i,
    /communauté/i, /para la/i, /copyright/i,
    /tous droits/i, /réservés/i, /crédits/i,
    /générique/i, /fin de l'épisode/i, /prochain épisode/i,
    /publicité/i, /sponsored/i, /presented by/i,
    
    // === STREAMING PLATFORMS ===
    /netflix/i, /amazon/i, /prime video/i, /disney/i, 
    /hulu/i, /hbo/i, /apple tv/i, /canal\+/i, /ocs/i,
    /youtube/i, /twitch/i, /tiktok/i, /reels/i,
    
    // === MUSIC LYRICS & SONG PATTERNS ===
    /♪/i, /♫/i, /🎵/i, /🎶/i, /\[musique\]/i, /\[music\]/i,
    /lalala/i, /nanana/i, /ooooh/i, /aaaah/i,
    /yeah yeah/i, /baby baby/i, /oh oh oh/i,
    /refrain/i, /couplet/i, /bridge/i, /outro/i,
    /feat\./i, /ft\./i, /featuring/i, /remix/i,
    
    // === COMMON SONG/ARTIST MENTIONS ===
    /billboard/i, /top\s*\d+/i, /hit\s*parade/i,
    /deezer/i, /spotify.*playing/i, /now playing/i,
    /album/i, /single/i, /ep\s/i, /mixtape/i,
    
    // === BACKGROUND CONVERSATIONS (not directed at Ulysse) ===
    /il dit que/i, /elle dit que/i, /ils disent/i,
    /tu sais pas/i, /je sais pas/i, /c'est pas vrai/i,
    /attends/i, /regarde/i, /t'as vu/i, /oh putain/i,
    /c'est ouf/i, /trop bien/i, /mdrrr/i, /ptdr/i,
    /hahaha/i, /hihi/i, /lol/i, /mdr/i,
    
    // === TV SHOW/MOVIE DIALOGUE PATTERNS ===
    /précédemment dans/i, /dans le prochain/i,
    /to be continued/i, /the end/i, /^fin$/i,
    /breaking news/i, /dernière heure/i, /flash info/i,
    /interview/i, /reportage/i, /documentaire/i,
    
    // === PODCAST/RADIO PATTERNS ===
    /bienvenue dans/i, /bienvenue sur/i, /welcome to/i,
    /aujourd'hui.*épisode/i, /merci.*écouté/i,
    /retrouvez-nous/i, /suivez-nous/i, /notre podcast/i,
    /la chronique/i, /notre invité/i, /cher.*auditeur/i,
    
    // === NOISE/GARBAGE ===
    /^\.+$/i, /^,+$/i, /^-+$/i, /^\.\.\.$/, /^…$/,
    /^[^\w\s]{2,}$/i, /^\s*$/
  ];
  
  if (tvNoisePatterns.some(p => p.test(transcript))) {
    return true;
  }
  
  // Check for user-directed language (if absent in long text, likely background)
  const userDirectedPatterns = [
    /ulysse/i, /maurice/i, /moe/i, /hey/i, /salut/i, /bonjour/i,
    /s'il te pla[iî]t/i, /peux-tu/i, /est-ce que tu/i, /tu peux/i,
    /génèr/i, /cherche/i, /trouve/i, /dis-moi/i, /montre/i,
    /fais/i, /crée/i, /aide/i, /j'ai besoin/i, /je veux/i, /je voudrais/i,
    /c'est quoi/i, /qu'est-ce/i, /comment/i, /pourquoi/i, /où/i, /quand/i,
    /merci/i, /ok/i, /oui/i, /non/i, /d'accord/i, /parfait/i,
    /bonne nuit/i, /au revoir/i, /à plus/i, /ciao/i, /bye/i,
    /ça va/i, /t'inquiète/i, /écoute/i, /attention/i
  ];
  
  // Long text without user-directed patterns = likely background conversation
  if (transcript.length > 50 && !userDirectedPatterns.some(p => p.test(transcript))) {
    return true;
  }
  
  return false;
}

async function processPCMAndRespond(session: VoiceSession) {
  if (session.isProcessing || session.pcmBuffer.length === 0) return;
  
  session.isProcessing = true;
  
  try {
    const pcmData = Buffer.concat(session.pcmBuffer);
    session.pcmBuffer = [];
    
    // Convert PCM to WAV for Whisper
    const wavData = pcmToWav(pcmData);
    
    console.log(`[Voice] Processing PCM audio: ${pcmData.length} bytes -> WAV ${wavData.length} bytes`);
    
    session.ws.send(JSON.stringify({ type: "processing" }));
    
    const transcription = await whisperClient.audio.transcriptions.create({
      file: new File([wavData], "audio.wav", { type: "audio/wav" }),
      model: "whisper-1",
      language: "fr"
    });
    
    const transcript = transcription.text.trim();
    
    // Minimum 5 characters to filter very short noise
    if (!transcript || transcript.length < 5) {
      console.log(`[Voice] Empty or too short transcript in call mode: "${transcript}"`);
      session.isProcessing = false;
      session.ws.send(JSON.stringify({ type: "listening" }));
      return;
    }
    
    // Anti-duplicate: check if same message was just sent (within 3 seconds)
    const now = Date.now();
    if (session.lastTranscript && session.lastTranscriptTime) {
      const timeSinceLast = now - session.lastTranscriptTime;
      const isSameContent = transcript.toLowerCase() === session.lastTranscript.toLowerCase();
      const isSimilar = transcript.length > 10 && 
        session.lastTranscript.includes(transcript.substring(0, 20)) ||
        transcript.includes(session.lastTranscript.substring(0, 20));
      
      if (timeSinceLast < 3000 && (isSameContent || isSimilar)) {
        console.log(`[Voice] Duplicate transcript filtered (${timeSinceLast}ms): "${transcript.substring(0, 30)}..."`);
        session.isProcessing = false;
        session.ws.send(JSON.stringify({ type: "listening" }));
        return;
      }
    }
    
    // Filter TV/background noise patterns (expanded list)
    const tvNoisePatterns = [
      // === SUBTITLES & VIDEO CREDITS ===
      /sous-titr/i, /amara\.org/i, /st['']?\s*\d+/i,
      /réalisé.*partenariat/i, /assemblée nationale/i,
      /cette vidéo/i, /abonnez-vous/i, /like.*subscribe/i,
      /soustitreur\.com/i, /merci.*regard/i,
      /❤️/i, /♥/i, /traduction/i, /doublage/i,
      /communauté/i, /para la/i, /copyright/i,
      /tous droits/i, /réservés/i, /crédits/i,
      /générique/i, /fin de l'épisode/i, /prochain épisode/i,
      /publicité/i, /sponsored/i, /presented by/i,
      
      // === STREAMING PLATFORMS ===
      /netflix/i, /amazon/i, /prime video/i, /disney/i, 
      /hulu/i, /hbo/i, /apple tv/i, /canal\+/i, /ocs/i,
      /youtube/i, /twitch/i, /tiktok/i, /reels/i,
      
      // === MUSIC LYRICS & SONG PATTERNS ===
      /♪/i, /♫/i, /🎵/i, /🎶/i, /\[musique\]/i, /\[music\]/i,
      /lalala/i, /nanana/i, /ooooh/i, /aaaah/i,
      /yeah yeah/i, /baby baby/i, /oh oh oh/i,
      /refrain/i, /couplet/i, /bridge/i, /outro/i,
      /feat\./i, /ft\./i, /featuring/i, /remix/i,
      
      // === COMMON SONG/ARTIST MENTIONS ===
      /billboard/i, /top\s*\d+/i, /hit\s*parade/i,
      /deezer/i, /spotify.*playing/i, /now playing/i,
      /album/i, /single/i, /ep\s/i, /mixtape/i,
      
      // === BACKGROUND CONVERSATIONS (not directed at Ulysse) ===
      /il dit que/i, /elle dit que/i, /ils disent/i,
      /tu sais pas/i, /je sais pas/i, /c'est pas vrai/i,
      /attends/i, /regarde/i, /t'as vu/i, /oh putain/i,
      /c'est ouf/i, /trop bien/i, /mdrrr/i, /ptdr/i,
      /hahaha/i, /hihi/i, /lol/i, /mdr/i,
      
      // === TV SHOW/MOVIE DIALOGUE PATTERNS ===
      /précédemment dans/i, /dans le prochain/i,
      /to be continued/i, /the end/i, /fin/i,
      /breaking news/i, /dernière heure/i, /flash info/i,
      /interview/i, /reportage/i, /documentaire/i,
      
      // === PODCAST/RADIO PATTERNS ===
      /bienvenue dans/i, /bienvenue sur/i, /welcome to/i,
      /aujourd'hui.*épisode/i, /merci.*écouté/i,
      /retrouvez-nous/i, /suivez-nous/i, /notre podcast/i,
      /la chronique/i, /notre invité/i, /cher.*auditeur/i,
      
      // === NOISE/GARBAGE ===
      /^\.+$/i, /^,+$/i, /^-+$/i, /^\.\.\.$/, /^…$/,
      /^[^\w\s]{2,}$/i, /^\s*$/
    ];
    if (tvNoisePatterns.some(p => p.test(transcript))) {
      console.log(`[Voice] Background noise filtered: "${transcript.substring(0, 50)}..."`);
      session.isProcessing = false;
      session.ws.send(JSON.stringify({ type: "listening" }));
      return;
    }
    
    // Additional check: if transcript doesn't contain user-directed language, might be background
    const userDirectedPatterns = [
      /ulysse/i, /maurice/i, /moe/i, /hey/i, /salut/i, /bonjour/i,
      /s'il te pla[iî]t/i, /peux-tu/i, /est-ce que tu/i, /tu peux/i,
      /génèr/i, /cherche/i, /trouve/i, /dis-moi/i, /montre/i,
      /fais/i, /crée/i, /aide/i, /j'ai besoin/i, /je veux/i, /je voudrais/i,
      /c'est quoi/i, /qu'est-ce/i, /comment/i, /pourquoi/i, /où/i, /quand/i,
      /merci/i, /ok/i, /oui/i, /non/i, /d'accord/i, /parfait/i,
      /bonne nuit/i, /au revoir/i, /à plus/i, /ciao/i, /bye/i,
      /ça va/i, /t'inquiète/i, /écoute/i, /attention/i
    ];
    
    // If transcript is long but has no user-directed patterns, likely background conversation
    if (transcript.length > 50 && !userDirectedPatterns.some(p => p.test(transcript))) {
      console.log(`[Voice] Likely background conversation filtered: "${transcript.substring(0, 50)}..."`);
      session.isProcessing = false;
      session.ws.send(JSON.stringify({ type: "listening" }));
      return;
    }
    
    // Echo detection
    if (session.lastAssistantResponse && isEcho(transcript, session.lastAssistantResponse)) {
      console.log("[Voice] Echo detected in call mode, ignoring");
      session.isProcessing = false;
      session.ws.send(JSON.stringify({ type: "listening" }));
      return;
    }
    
    // Speaker verification in call mode (if profile exists) — STRICT: error = reject
    if (session.hasVoiceProfile && session.voiceVerificationEnabled && session.userId) {
      console.log(`[Voice] Verifying speaker in call mode for user ${session.userId}...`);
      
      try {
        const verification = await verifySpeaker(wavData, session.userId.toString());
        const CONFIDENCE_THRESHOLD = 0.80;
        
        // On service error: reject — do NOT continue
        if (verification.error) {
          console.warn(`[Voice] Speaker service error in call mode — rejecting: ${verification.error}`);
          session.ws.send(JSON.stringify({ 
            type: "speaker_rejected_call",
            message: "Impossible de vérifier ta voix, réessaie.",
            confidence: 0
          }));
          session.isProcessing = false;
          session.ws.send(JSON.stringify({ type: "listening" }));
          return;
        }

        const confidence = verification.confidence ?? 0;
        
        if (!verification.verified || confidence < CONFIDENCE_THRESHOLD) {
          console.log(`[Voice] Call mode speaker rejected: "${transcript.substring(0, 30)}..." (confidence=${confidence.toFixed(2)})`);
          session.ws.send(JSON.stringify({ 
            type: "speaker_rejected_call",
            message: "Voix non reconnue, message ignoré",
            confidence 
          }));
          session.isProcessing = false;
          session.ws.send(JSON.stringify({ type: "listening" }));
          return;
        }
        console.log(`[Voice] Call mode speaker verified: confidence=${confidence.toFixed(2)}`);
      } catch (verifyErr) {
        console.warn(`[Voice] Speaker verification error in call mode — rejecting:`, verifyErr);
        session.ws.send(JSON.stringify({ 
          type: "speaker_rejected_call",
          message: "Impossible de vérifier ta voix, réessaie.",
          confidence: 0
        }));
        session.isProcessing = false;
        session.ws.send(JSON.stringify({ type: "listening" }));
        return;
      }
    }
    
    session.ws.send(JSON.stringify({ type: "speaking" }));
    console.log(`[Voice] Call transcript: ${transcript}`);
    session.ws.send(JSON.stringify({ type: "transcript", text: transcript }));
    
    // Route through HearingHub for unified sensory processing (call mode)
    let resolvedTranscript = transcript;
    if (session.userId) {
      try {
        const processedHearing = await hearingHub.hearFromWebVoice(
          transcript,
          session.userId,
          session.persona,
          {
            confidence: 0.85,
            speakerVerified: session.hasVoiceProfile && session.voiceVerificationEnabled,
            language: "fr",
            durationMs: 0
          }
        );
        resolvedTranscript = processedHearing.resolvedContent;

        voiceActivityService.logEvent(session.userId, {
          type: 'transcript',
          content: resolvedTranscript,
          persona: session.persona
        });

        // ============== BRAIN HUB - CHEF D'ORCHESTRE (Call Mode) ==============
        try {
          const brainResult = await brainHub.processInput({
            content: resolvedTranscript,
            source: 'talking_v3',
            userId: session.userId,
            persona: session.persona as 'ulysse' | 'iris' | 'alfred',
            isVoice: true,
            metadata: {
              conversationId: session.conversationId,
              speakerVerified: session.hasVoiceProfile && session.voiceVerificationEnabled,
              intent: processedHearing.intent,
              mode: 'call'
            }
          });
          console.log(`[Voice-BrainHub] Call mode decision: ${brainResult.decision.action} (${(brainResult.decision.confidence * 100).toFixed(0)}%)`);

          if (brainResult.decision.action === 'wait' && brainResult.decision.confidence > 0.8) {
            console.log(`[Voice-BrainHub] Throttling in call mode, brief pause...`);
            sendToSession(session, { type: 'thinking', message: 'Un instant...' });
            await new Promise(r => setTimeout(r, 800));
          }
        } catch (brainError) {
          console.error(`[Voice-BrainHub] Error in call mode (continuing):`, brainError);
        }
      } catch (hearingError) {
        console.error("[Voice] HearingHub error in call mode:", hearingError);
      }
    }
    
    // Update anti-duplicate tracking
    session.lastTranscript = transcript;
    session.lastTranscriptTime = Date.now();
    
    // Add user message to call history
    session.callHistory.push({ role: "user", content: resolvedTranscript });
    
    // Keep only last 10 exchanges (20 messages) to avoid context overflow
    if (session.callHistory.length > 20) {
      session.callHistory = session.callHistory.slice(-20);
    }
    
    console.log(`[Voice] Call history: ${session.callHistory.length} messages`);
    
    // Generate response with call history for context
    await generateAndStreamResponse(session, resolvedTranscript, session.callHistory.slice(0, -1));
    
    // Add assistant response to call history
    if (session.lastAssistantResponse) {
      session.callHistory.push({ role: "assistant", content: session.lastAssistantResponse });
    }
    
    // Resume listening in call mode
    if (session.isInCallMode) {
      session.ws.send(JSON.stringify({ type: "listening" }));
    }
    
  } catch (error) {
    console.error("[Voice] PCM processing error:", error);
    session.ws.send(JSON.stringify({ type: "error", message: "Erreur de traitement audio" }));
  } finally {
    session.isProcessing = false;
  }
}

async function handleControlMessage(session: VoiceSession, message: any) {
  console.log(`[Voice] Control message received: type=${message.type}`);
  
  switch (message.type) {
    case "auth":
      console.log(`[Voice] Auth message received`);
      if (session.httpRequest) {
        const sessionResult = await validateWebSocketSession(session.httpRequest);
        if (sessionResult) {
          session.userId = sessionResult.userId;
          session.isOwner = sessionResult.isOwner;
          session.isAuthenticated = true;
          
          const authenticatedUsername = sessionResult.username || sessionResult.displayName || null;
          session.userName = sessionResult.displayName || authenticatedUsername || message.userName;
          
          console.log(`[Voice] Session validated: userId=${session.userId}, username=${authenticatedUsername}`);
          
          if ((session.ws as any).authTimeout) {
            clearTimeout((session.ws as any).authTimeout);
            delete (session.ws as any).authTimeout;
          }
          
          try {
            session.hasVoiceProfile = await hasVoiceProfile(session.userId.toString());
            console.log(`[Voice] User ${session.userId} has voice profile: ${session.hasVoiceProfile}`);
          } catch (e) {
            console.warn(`[Voice] Could not check voice profile:`, e);
            session.hasVoiceProfile = false;
          }
          
          const speakerId = authenticatedUsername?.toLowerCase().trim() || null;
          const personaConfig = getPersonaForSpeaker(speakerId);
          
          session.speakerId = speakerId;
          session.personaConfig = personaConfig;
          session.persona = personaConfig.persona;
          session.systemPrompt = getPersonaPromptContext(personaConfig);
          
          if (session.userId && speakerId) {
            setSpeakerContext(session.userId, speakerId);
          }
          
          // Handle channel for TTS priority (talking-v2 > chat)
          const requestedChannel = message.channel as VoiceChannel | undefined;
          if (requestedChannel === "talking-v2") {
            session.channel = "talking-v2";
            talkingV2SessionsByUser.set(session.userId, session);
            console.log(`[Voice] TTS Priority: talking-v2 registered for user ${session.userId}`);
          } else {
            session.channel = "chat";
          }
        } else {
          console.warn(`[Voice] Rejecting auth - no valid session cookie`);
          session.ws.send(JSON.stringify({ type: "auth.failed", error: "Session validation required" }));
          return;
        }
      } else {
        console.warn(`[Voice] Rejecting auth - no HTTP request stored`);
        session.ws.send(JSON.stringify({ type: "auth.failed", error: "Session validation required" }));
        return;
      }
      
      const config = session.personaConfig!;
      const personaDisplayName = config.persona === "ulysse" ? "Ulysse" : 
                                 config.persona === "iris" ? "Iris" : "Max";
      console.log(`[Voice] Authenticated: ${session.userName} → ${personaDisplayName} (${config.role}) [channel: ${session.channel}]`);
      
      if (session.userId) {
        voiceActivityService.setInCall(session.userId, true);
      }
      
      const greeting = config.greeting || `${personaDisplayName} est prêt`;

      voiceSessionManager.updateSession(session.sessionId, {
        userId: session.userId,
        userName: session.userName,
        persona: session.persona,
        channel: session.channel as any,
      });

      session.ws.send(JSON.stringify({ 
        type: "authenticated", 
        persona: session.persona,
        role: config.role,
        accessLevel: config.accessLevel,
        message: greeting,
        voiceVerificationEnabled: session.hasVoiceProfile,
        sessionId: session.sessionId
      }));
      break;

    case "start_listening":
      if (session.isProcessing) {
        console.log(`[Voice] Ignoring start_listening during processing`);
        return;
      }
      session.audioChunks = [];
      session.hasValidHeader = false;
      session.conversationId = message.conversationId;
      session.ws.send(JSON.stringify({ type: "listening_started" }));
      break;

    case "stop_listening":
      if (session.audioChunks.length > 0 && !session.isProcessing) {
        session.isProcessing = true;
        await processAudioAndRespond(session, message.context || []);
      }
      break;

    case "text_input":
      if (!session.isProcessing) {
        session.isProcessing = true;
        await processTextAndRespond(session, message.text, message.context || []);
      }
      break;

    // ── Web Speech API streaming transcription ──────────────────────────────
    // Sent by client every ~200ms while user is speaking.
    // Feeds TurnDetector in real-time without waiting for a 64KB audio buffer.
    case "interim_transcript": {
      const interim = (message.text || "").trim();
      if (!interim || session.isProcessing) break;
      if (session.turnDetector) {
        session.turnDetector.handleTranscriptUpdate(interim);
      }
      session.pendingTranscript = interim;
      break;
    }

    // ── Web Speech API final transcript ─────────────────────────────────────
    // Sent by client when SpeechRecognition fires a final result.
    // Bypasses Whisper entirely — saves 500-700ms of STT latency.
    case "final_transcript": {
      const finalText = (message.text || "").trim();
      if (!finalText || session.isProcessing) break;
      console.log(`[Voice] final_transcript received (Web Speech API): "${finalText.substring(0, 60)}"`);

      // Clear WebM audio buffers (not needed anymore), keep pcmBuffer for speaker verification
      session.audioChunks = [];
      session.hasValidHeader = false;
      session.pendingTranscript = "";
      session.turnDetector?.reset();

      if (session.isInCallMode) {
        // pcmBuffer kept for speaker verification inside processTurnInCallMode flow
        await processTurnInCallMode(session, finalText);
        // Clear pcmBuffer after processing so it doesn't get re-processed
        session.pcmBuffer = [];
      } else {
        session.isProcessing = true;
        await processTextAndRespond(session, finalText, message.context || []);
      }
      break;
    }

    case "cancel":
      session.bargeInRequested = true;
      session.isProcessing = false;
      session.audioChunks = [];
      session.pcmBuffer = [];
      session.hasValidHeader = false;
      session.ws.send(JSON.stringify({ type: "cancelled" }));
      break;

    case "set_system_prompt":
      session.systemPrompt = message.prompt;
      break;

    case "start_call":
      console.log(`[Voice] Starting call mode for user ${session.userId}`);
      session.isInCallMode = true;
      session.conversationId = message.conversationId;
      session.pcmBuffer = [];
      session.callHistory = []; // Reset conversation history for new call
      session.pendingTranscript = '';
      
      // Initialize TurnDetector for robust end-of-speech detection
      session.turnDetector = createCallModeDetector(async (finalTranscript: string, reason: string) => {
        console.log(`[Voice] TurnDetector triggered (${reason}): "${finalTranscript.substring(0, 50)}..."`);
        
        // Clear buffer after detection
        session.pcmBuffer = [];
        session.pendingTranscript = '';
        
        // Process the complete turn
        await processTurnInCallMode(session, finalTranscript);
      });
      
      session.ws.send(JSON.stringify({ type: "call_started" }));
      session.ws.send(JSON.stringify({ type: "listening" }));
      break;

    case "end_call":
      console.log(`[Voice] Ending call mode for user ${session.userId}, history: ${session.callHistory.length} messages`);
      session.isInCallMode = false;
      if (session.callProcessingInterval) {
        clearInterval(session.callProcessingInterval);
        session.callProcessingInterval = undefined;
      }
      session.pcmBuffer = [];
      session.callHistory = []; // Clear conversation history
      session.ws.send(JSON.stringify({ type: "call_ended" }));
      break;

    default:
      console.log("Unknown message type:", message.type);
  }
}

async function processAudioAndRespond(session: VoiceSession, context: any[]) {
  try {
    console.log(`[Voice] processAudioAndRespond: chunks=${session.audioChunks.length}`);
    const audioBuffer = Buffer.concat(session.audioChunks);
    session.audioChunks = [];

    console.log(`[Voice] Audio buffer size: ${audioBuffer.length} bytes`);
    
    if (audioBuffer.length < 1000) {
      console.log(`[Voice] Audio too short: ${audioBuffer.length} bytes`);
      session.isProcessing = false;
      return;
    }

    // Validate WebM header (EBML magic bytes: 0x1A 0x45 0xDF 0xA3)
    const isValidWebm = audioBuffer[0] === 0x1A && audioBuffer[1] === 0x45 && 
                        audioBuffer[2] === 0xDF && audioBuffer[3] === 0xA3;
    
    if (!isValidWebm) {
      console.log(`[Voice] Invalid WebM format, magic bytes: ${audioBuffer.slice(0, 4).toString('hex')}`);
      session.isProcessing = false;
      session.hasValidHeader = false;
      return;
    }

    // ── Speaker verification BEFORE Whisper ─────────────────────────────────
    // Ambient sounds (TV, noise, snapshots) are silently dropped here.
    // Whisper is only called if the speaker is recognized — saves API cost.
    if (session.hasVoiceProfile && session.voiceVerificationEnabled && session.userId) {
      const verification = await verifySpeaker(audioBuffer, session.userId.toString());
      const CONFIDENCE_THRESHOLD = 0.82;

      if (verification.error) {
        // Service error: reject silently — don't send error to client
        console.warn(`[Voice] Speaker service error — dropping audio: ${verification.error}`);
        session.isProcessing = false;
        return;
      }

      const confidence = verification.confidence ?? 0;
      if (!verification.verified || confidence < CONFIDENCE_THRESHOLD) {
        // Not the owner: silent drop, return to listening
        console.log(`[Voice] Speaker not recognized (confidence=${confidence.toFixed(2)}) — ambient sound ignored`);
        session.isProcessing = false;
        session.ws.send(JSON.stringify({ type: "listening" }));
        return;
      }

      console.log(`[Voice] Speaker verified pre-Whisper: confidence=${confidence.toFixed(2)}`);
      session.ws.send(JSON.stringify({ type: "speaker_verified", confidence }));
      if (session.userId) {
        voiceActivityService.logEvent(session.userId, {
          type: 'speaker_verified',
          content: 'Voix reconnue (pré-Whisper)',
          confidence: confidence * 100,
          persona: session.persona
        });
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    session.ws.send(JSON.stringify({ type: "processing" }));

    const transcription = await whisperClient.audio.transcriptions.create({
      file: new File([audioBuffer], "audio.webm", { type: "audio/webm" }),
      model: "whisper-1",
      language: "fr"
    });

    const transcript = transcription.text.trim();
    
    if (!transcript) {
      // Speaker was verified but nothing intelligible — silent reset
      console.log(`[Voice] Empty transcript after verification, resetting`);
      session.isProcessing = false;
      session.ws.send(JSON.stringify({ type: "listening" }));
      return;
    }

    if (session.lastAssistantResponse && isEcho(transcript, session.lastAssistantResponse)) {
      console.log("Echo detected, ignoring:", transcript.substring(0, 50));
      session.ws.send(JSON.stringify({ type: "echo_detected" }));
      session.isProcessing = false;
      session.audioChunks = []; // Clear any accumulated chunks
      return;
    }

    session.ws.send(JSON.stringify({ type: "transcript", text: transcript }));

    // Route through HearingHub for unified sensory processing
    if (session.userId) {
      const processedHearing = await hearingHub.hearFromWebVoice(
        transcript,
        session.userId,
        session.persona,
        {
          confidence: 0.9, // Whisper confidence
          speakerVerified: session.hasVoiceProfile && session.voiceVerificationEnabled,
          language: "fr",
          durationMs: 0
        }
      );

      // Log via HearingHub includes cross-pipeline awareness
      voiceActivityService.logEvent(session.userId, {
        type: 'transcript',
        content: processedHearing.resolvedContent,
        persona: session.persona
      });

      // ============== BRAIN HUB - CHEF D'ORCHESTRE ==============
      let brainDecision: { action: string; confidence: number; reason: string } = { action: 'respond', confidence: 1.0, reason: 'default' };
      try {
        const brainResult = await brainHub.processInput({
          content: processedHearing.resolvedContent,
          source: 'talking_v3',
          userId: session.userId,
          persona: session.persona as 'ulysse' | 'iris' | 'alfred',
          isVoice: true,
          metadata: {
            conversationId: session.conversationId,
            speakerVerified: session.hasVoiceProfile && session.voiceVerificationEnabled,
            intent: processedHearing.intent
          }
        });
        brainDecision = brainResult.decision;
        console.log(`[Voice-BrainHub] Decision: ${brainDecision.action} (${(brainDecision.confidence * 100).toFixed(0)}%)`);
        
        // Routing based on BrainHub decision
        if (brainDecision.action === 'wait' && brainDecision.confidence > 0.8) {
          console.log(`[Voice-BrainHub] Throttling: cognitive load too high, waiting...`);
          sendToSession(session, { type: 'thinking', message: 'Un moment, je réfléchis...' });
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (brainError) {
        console.error(`[Voice-BrainHub] Error (falling back to default):`, brainError);
      }

      // Use resolved content (with reference resolution) for response generation
      await generateAndStreamResponse(session, processedHearing.resolvedContent, context);
    } else {
      // Fallback for unauthenticated sessions
      await generateAndStreamResponse(session, transcript, context);
    }

  } catch (error) {
    console.error("Audio processing error:", error);
    session.ws.send(JSON.stringify({ type: "error", message: "Erreur de traitement audio" }));
    session.isProcessing = false;
    session.audioChunks = []; // Clear any accumulated chunks
  }
}

async function processTextAndRespond(session: VoiceSession, text: string, context: any[]) {
  try {
    session.ws.send(JSON.stringify({ type: "processing" }));
    
    // Route through HearingHub for unified sensory processing (text input)
    if (session.userId) {
      const processedHearing = await hearingHub.hear({
        content: text,
        metadata: {
          source: session.channel === "talking-v2" ? "web_voice" : "web_chat",
          type: "text",
          timestamp: Date.now(),
          userId: session.userId,
          persona: session.persona,
          conversationId: session.conversationId,
          messageHistory: session.callHistory.slice(-5).map(m => ({
            role: m.role,
            content: m.content
          }))
        }
      });
      
      console.log(`[Voice-Sensory] HearingHub processed text: "${text.substring(0, 50)}" → "${processedHearing.resolvedContent.substring(0, 50)}"`);
      
      // ============== BRAIN HUB - CHEF D'ORCHESTRE ==============
      try {
        const brainResult = await brainHub.processInput({
          content: processedHearing.resolvedContent,
          source: session.channel === "talking-v2" ? 'talking_v3' : 'web_chat',
          userId: session.userId,
          persona: session.persona as 'ulysse' | 'iris' | 'alfred',
          isVoice: session.channel === "talking-v2",
          metadata: {
            conversationId: session.conversationId,
            intent: processedHearing.intent
          }
        });
        console.log(`[Voice-BrainHub] Decision: ${brainResult.decision.action} (${(brainResult.decision.confidence * 100).toFixed(0)}%)`);
        
        if (brainResult.decision.action === 'wait' && brainResult.decision.confidence > 0.8) {
          sendToSession(session, { type: 'thinking', message: 'Un moment...' });
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (brainError) {
        console.error(`[Voice-BrainHub] Error (text mode fallback):`, brainError);
      }
      
      await generateAndStreamResponse(session, processedHearing.resolvedContent, context);
    } else {
      await generateAndStreamResponse(session, text, context);
    }
  } catch (error) {
    console.error("Text processing error:", error);
    session.ws.send(JSON.stringify({ type: "error", message: "Erreur de traitement" }));
    session.isProcessing = false;
    session.audioChunks = []; // Clear any accumulated chunks
  }
}

// Detect if message requires action execution
function detectActionRequest(message: string): { needsAction: boolean; actionType: string | null } {
  const lowerMessage = message.toLowerCase();
  
  const actionPatterns = [
    { pattern: /génèr|gener|crée|créer|fais(-moi)?.*image|photo|dessin/i, type: "image" },
    { pattern: /cherche|recherche|google|trouve.*info|actualité|news/i, type: "search" },
    { pattern: /envoie|envoi.*email|mail|message/i, type: "email" },
    { pattern: /calendrier|rdv|rendez-vous|événement|event/i, type: "calendar" },
    { pattern: /spotify|musique|joue|play|mets.*chanson/i, type: "music" },
  ];
  
  for (const { pattern, type } of actionPatterns) {
    if (pattern.test(lowerMessage)) {
      return { needsAction: true, actionType: type };
    }
  }
  
  return { needsAction: false, actionType: null };
}

// Execute action via internal chat API
async function executeActionViaChat(
  session: VoiceSession, 
  userMessage: string
): Promise<string | null> {
  if (!session.conversationId || !session.userId) return null;
  
  try {
    console.log(`[Voice] Executing action via chat API for user ${session.userId}`);
    
    // Call internal chat endpoint
    const response = await fetch(`http://localhost:5000/api/conversations/${session.conversationId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": session.httpRequest?.headers?.cookie || "",
      },
      body: JSON.stringify({ content: userMessage }),
    });
    
    if (!response.ok) {
      console.error(`[Voice] Chat API error: ${response.status}`);
      return null;
    }
    
    const result = await response.json();
    console.log(`[Voice] Action executed successfully`);
    return result.content || result.message || "Action exécutée.";
    
  } catch (error) {
    console.error("[Voice] Action execution error:", error);
    return null;
  }
}

async function generateAndStreamResponse(session: VoiceSession, userMessage: string, context: any[]) {
  try {
    const startTime = Date.now();
    
    // === VOICE BRAIN V3 PRO: Intent-based routing ===
    // Route through specialized handlers before falling back to LLM
    if (session.userId && session.isInCallMode) {
      const voiceMetadata: VoiceMetadata = {
        origin: "voice",
        channel: "talking-v2",
        mode: "continuous",
        userId: session.userId,
        userName: session.userName,
        persona: session.persona,
        timestamp: Date.now(),
      };
      
      const routedResponse = await routeVoiceRequest(userMessage, voiceMetadata);
      
      if (routedResponse) {
        const latencyMs = Date.now() - startTime;
        
        // Log the voice session
        logVoiceSession({
          channel: "talking-v2",
          userId: session.userId,
          userName: session.userName,
          text: userMessage,
          intent: routedResponse.action?.type || routedResponse.domain,
          domain: routedResponse.domain,
          dataSources: routedResponse.dataSources,
          latencyMs,
          success: routedResponse.success,
          timestamp: new Date(),
        });
        
        // Handle system commands (mute, end call, etc.)
        if (routedResponse.domain === "system" && routedResponse.action) {
          session.ws.send(JSON.stringify({
            type: "system_command",
            command: routedResponse.action.uiAction,
            data: routedResponse.action.data,
          }));
          
          if (routedResponse.text) {
            session.lastAssistantResponse = routedResponse.text;
            session.ws.send(JSON.stringify({ 
              type: "response", 
              text: routedResponse.text,
              full: true
            }));
            session.ws.send(JSON.stringify({ type: "speaking" }));
            await generateTTSChunks(session, routedResponse.text);
            session.ws.send(JSON.stringify({ type: "done" }));
          }
          
          session.isProcessing = false;
          session.audioChunks = [];
          return;
        }
        
        // Handle domain responses (football, sugu, etc.)
        if (routedResponse.success && routedResponse.text) {
          session.lastAssistantResponse = routedResponse.text;
          
          session.ws.send(JSON.stringify({ 
            type: "response", 
            text: routedResponse.text,
            full: true,
            domain: routedResponse.domain,
            dataSources: routedResponse.dataSources,
          }));
          
          // Send UI action if present
          if (routedResponse.action?.uiAction) {
            session.ws.send(JSON.stringify({
              type: "ui_action",
              action: routedResponse.action.uiAction,
              data: routedResponse.action.data,
            }));
          }
          
          // Log and sync to conversation
          if (session.userId) {
            voiceActivityService.logEvent(session.userId, {
              type: 'response',
              content: routedResponse.text,
              persona: session.persona,
            });
          }
          
          if (session.conversationId && session.userId) {
            try {
              await chatStorage.createMessage(session.conversationId, "user", userMessage);
              await chatStorage.createMessage(session.conversationId, "assistant", routedResponse.text);
              emitConversationMessage(session.userId, session.conversationId, "user", userMessage, undefined, "voice");
              emitConversationMessage(session.userId, session.conversationId, "assistant", routedResponse.text, undefined, "voice");
            } catch (e) {
              console.log("[Voice] Failed to sync routed response:", e);
            }
          }
          
          session.ws.send(JSON.stringify({ type: "speaking" }));
          
          // Log to VoiceOutputHub for unified sensory tracking
          if (session.userId) {
            voiceOutputHub.speakToWebVoice(
              routedResponse.text,
              session.userId,
              session.persona,
              { inResponseTo: userMessage, intent: routedResponse.domain }
            ).catch(err => console.warn("[Voice] VoiceOutputHub log failed:", err));
          }
          
          await generateTTSChunks(session, routedResponse.text);
          session.ws.send(JSON.stringify({ type: "done" }));
          session.isProcessing = false;
          session.audioChunks = [];
          
          console.log(`[Voice] Routed response completed in ${latencyMs}ms via ${routedResponse.dataSources.join(", ")}`);
          return;
        }
      }
    }
    // === END VOICE BRAIN V3 ===
    
    // Check if this is an action request that needs full capabilities
    const { needsAction, actionType } = detectActionRequest(userMessage);
    
    if (session.isInCallMode && needsAction) {
      console.log(`[Voice] Action detected (${actionType}), routing to full Ulysse system`);
      
      // Notify user we're processing
      session.ws.send(JSON.stringify({ 
        type: "response", 
        text: `Je m'en occupe...`,
        full: false
      }));
      
      // Execute via chat API
      const actionResult = await executeActionViaChat(session, userMessage);
      
      if (actionResult) {
        // Summarize the result for voice
        const summaryMessages: any[] = [
          { role: "system", content: "Tu es Ulysse. Résume en 1-2 phrases courtes ce résultat d'action pour une réponse vocale." },
          { role: "user", content: `Action demandée: ${userMessage}\nRésultat: ${actionResult}\n\nRésume brièvement pour une réponse vocale.` }
        ];
        
        const summary = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: summaryMessages,
          max_tokens: 100,
          temperature: 0.7,
        });
        
        const response = summary.choices[0]?.message?.content || "C'est fait !";
        session.lastAssistantResponse = response;
        
        session.ws.send(JSON.stringify({ 
          type: "response", 
          text: response,
          full: true
        }));
        
        // Log to VoiceOutputHub for unified sensory tracking
        if (session.userId) {
          voiceOutputHub.speakToWebVoice(
            response,
            session.userId,
            session.persona,
            { inResponseTo: userMessage, intent: 'action_execution' }
          ).catch(err => console.warn("[Voice-Sensory] VoiceOutputHub action log failed:", err));
        }
        
        // Notify client that we're about to speak
        session.ws.send(JSON.stringify({ type: "speaking" }));
        await generateTTSChunks(session, response);
        session.ws.send(JSON.stringify({ type: "done" }));
        session.isProcessing = false;
        session.audioChunks = [];
        return;
      }
    }
    
    // Standard response path - STREAMING for low latency
    session.bargeInRequested = false;
    let systemContent = session.systemPrompt;
    if (session.userId) {
      const sportsCtx = formatSportsContextForAI(session.userId);
      if (sportsCtx) {
        systemContent += "\n\n" + sportsCtx;
      }
    }
    const messages: any[] = [
      { role: "system", content: systemContent },
      ...context.slice(-6),
      { role: "user", content: userMessage }
    ];

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 500,
      temperature: 0.8,
      stream: true,
    });

    let fullResponse = "";
    let sentenceBuffer = "";
    let sentenceIndex = 0;
    let bargedIn = false;

    sendToSession(session, { type: "speaking" });

    for await (const chunk of stream) {
      if (session.bargeInRequested) {
        console.log(`[Voice] Barge-in detected during streaming, stopping`);
        bargedIn = true;
        break;
      }

      const delta = chunk.choices[0]?.delta?.content || "";
      if (!delta) continue;

      fullResponse += delta;
      sentenceBuffer += delta;

      sendToSession(session, { type: "response_chunk", text: delta, index: sentenceIndex });

      const sentenceMatch = sentenceBuffer.match(/^([\s\S]*?[.!?:]\s|[\s\S]*?\n)/);
      if (sentenceMatch) {
        const completeSentence = sentenceMatch[1].trim();
        sentenceBuffer = sentenceBuffer.slice(sentenceMatch[0].length);

        if (completeSentence.length >= 2) {
          if (session.bargeInRequested) {
            bargedIn = true;
            break;
          }
          await generateTTSChunks(session, completeSentence);
          sentenceIndex++;
        }
      }
    }

    if (!bargedIn && sentenceBuffer.trim().length >= 2) {
      if (!session.bargeInRequested) {
        await generateTTSChunks(session, sentenceBuffer.trim());
      } else {
        bargedIn = true;
      }
    }

    if (bargedIn) {
      console.log(`[Voice] Response interrupted by barge-in after ${fullResponse.length} chars`);
      session.bargeInRequested = false;
      session.isProcessing = false;
      sendToSession(session, { type: "barge_in_complete" });
    }

    const response = fullResponse || "Je n'ai pas compris.";
    session.lastAssistantResponse = response;

    sendToSession(session, { 
      type: "response_complete", 
      text: response,
      full: true,
      bargedIn
    });

    if (session.userId) {
      voiceActivityService.logEvent(session.userId, {
        type: 'response',
        content: response,
        persona: session.persona
      });
      
      voiceOutputHub.speak({
        text: response,
        metadata: {
          destination: "web_voice",
          priority: "normal",
          userId: session.userId,
          persona: session.persona,
          conversationId: session.conversationId,
          inResponseTo: userMessage.substring(0, 100)
        }
      }).catch(err => console.warn("[Voice-Sensory] VoiceOutputHub error:", err));
    }

    if (session.conversationId && session.userId) {
      try {
        await chatStorage.createMessage(session.conversationId, "user", userMessage);
        await chatStorage.createMessage(session.conversationId, "assistant", response);
        
        emitConversationMessage(session.userId, session.conversationId, "user", userMessage, undefined, "voice");
        emitConversationMessage(session.userId, session.conversationId, "assistant", response, undefined, "voice");
        console.log(`[Voice] Messages synced to conversation ${session.conversationId}`);
      } catch (e) {
        console.error("Failed to save messages:", e);
      }
    }

    sendToSession(session, { type: "done" });
    session.isProcessing = false;
    session.audioChunks = [];
    session.hasValidHeader = false;

  } catch (error) {
    console.error("Response generation error:", error);
    sendToSession(session, { type: "error", message: "Erreur de génération" });
    session.isProcessing = false;
    session.audioChunks = [];
    session.hasValidHeader = false;
  }
}

async function generateTTSChunks(session: VoiceSession, text: string) {
  // Check TTS priority: talking-v2 takes precedence over chat
  if (!shouldPlayTTS(session)) {
    console.log(`[Voice] TTS skipped for session on channel ${session.channel} - talking-v2 is active`);
    // Still send a notification that text was generated but audio is playing elsewhere
    session.ws.send(JSON.stringify({
      type: "tts_redirected",
      message: "Audio joué sur TalkingApp V3 Pro"
    }));
    return;
  }
  
  try {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    const voice = session.isOwner ? "onyx" : "nova";
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed || trimmed.length < 2) continue;

      try {
        // Utilise whisperClient (API OpenAI directe) car l'intégration Replit ne supporte pas /audio/speech
        const mp3Response = await whisperClient.audio.speech.create({
          model: "tts-1",
          voice: voice,
          input: trimmed,
          response_format: "mp3",
        });

        const arrayBuffer = await mp3Response.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString('base64');

        session.ws.send(JSON.stringify({
          type: "audio_chunk",
          audio: base64Audio
        }));

      } catch (ttsError) {
        console.error("TTS error for sentence:", ttsError);
        session.ws.send(JSON.stringify({ type: "tts_error", message: "TTS failed for chunk" }));
      }
    }
  } catch (error) {
    console.error("TTS generation error:", error);
    session.ws.send(JSON.stringify({ type: "tts_error", message: "TTS generation failed" }));
  }
}
