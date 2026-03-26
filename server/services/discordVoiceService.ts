/**
 * Discord Voice Service - Enables Ulysse to join voice calls and have conversations
 * Robust implementation with:
 * - Connection management with auto-reconnect
 * - Audio stream capture and processing
 * - Integration with VoiceCore (Whisper STT + OpenAI TTS)
 * - Error handling and graceful degradation
 */

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  VoiceConnection,
  AudioPlayer,
  StreamType,
  EndBehaviorType
} from '@discordjs/voice';
import { VoiceChannel, Client, GuildMember } from 'discord.js';
import { Readable, PassThrough } from 'stream';
import { speechToText, textToSpeech, isVoiceSupported, TTSOptions } from './voice/core';
import * as prism from 'prism-media';
import { discordVoiceMetrics } from './discordVoiceMetricsService';

interface VoiceSession {
  guildId: string;
  channelId: string;
  textChannelId: string | null;  // Text channel to send responses to
  connection: VoiceConnection;
  player: AudioPlayer;
  isListening: boolean;
  isSpeaking: boolean;
  isProcessing: boolean;  // Concurrency lock: one STT/TTS at a time per guild
  audioBuffer: Buffer[];
  silenceStart: number | null;
  lastActivity: Date;
  reconnectAttempts: number;
  activeCaptures: Map<string, { stream: any; decoder: any; timeout: NodeJS.Timeout }>;  // Track active audio captures per user
  processingQueue: Array<{ audioBuffer: Buffer; userId: string }>;  // Queue for pending audio to process
}

interface VoiceConfig {
  silenceThreshold: number;   // ms of silence before processing speech
  maxRecordingTime: number;   // max recording time in ms
  reconnectMaxAttempts: number;
  reconnectDelay: number;     // ms between reconnect attempts
  ttsVoice: TTSOptions['voice'];
  language: string;
}

const DEFAULT_CONFIG: VoiceConfig = {
  silenceThreshold: 1500,      // 1.5 seconds of silence
  maxRecordingTime: 60000,     // 60 seconds max recording
  reconnectMaxAttempts: 3,
  reconnectDelay: 5000,
  ttsVoice: 'onyx',            // Deep voice for Ulysse
  language: 'fr'
};

class DiscordVoiceService {
  private sessions: Map<string, VoiceSession> = new Map();
  private client: Client | null = null;
  private ulysseHandler: ((message: string, userId: string) => Promise<string>) | null = null;
  private config: VoiceConfig = DEFAULT_CONFIG;
  private isInitialized: boolean = false;

  constructor() {
    console.log('[DiscordVoice] Service created');
  }

  initialize(client: Client, ulysseHandler: (message: string, userId: string) => Promise<string>): void {
    this.client = client;
    this.ulysseHandler = ulysseHandler;
    this.isInitialized = true;
    
    // Check voice support
    if (!isVoiceSupported()) {
      console.warn('[DiscordVoice] Warning: Voice features require OPENAI_API_KEY. TTS/STT may not work.');
    }
    
    console.log('[DiscordVoice] Initialized with voice support:', isVoiceSupported());
  }

  async joinChannel(voiceChannel: VoiceChannel, textChannelId?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isInitialized) {
      return { success: false, error: 'Service not initialized' };
    }

    const guildId = voiceChannel.guild.id;
    
    // Check if already in this channel
    const existingSession = this.sessions.get(guildId);
    if (existingSession && existingSession.channelId === voiceChannel.id) {
      console.log('[DiscordVoice] Already in channel:', voiceChannel.name);
      return { success: true };
    }

    try {
      // Leave existing channel if in different one
      if (existingSession) {
        await this.leaveChannel(guildId);
      }

      console.log('[DiscordVoice] Joining channel:', voiceChannel.name);

      // Create voice connection
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,  // We need to hear users
        selfMute: false
      });

      // Create audio player for TTS responses
      const player = createAudioPlayer();
      connection.subscribe(player);

      // Create session with proper initialization
      const session: VoiceSession = {
        guildId,
        channelId: voiceChannel.id,
        textChannelId: textChannelId || null,
        connection,
        player,
        isListening: false,
        isSpeaking: false,
        isProcessing: false,
        audioBuffer: [],
        silenceStart: null,
        lastActivity: new Date(),
        reconnectAttempts: 0,
        activeCaptures: new Map(),
        processingQueue: []
      };

      this.sessions.set(guildId, session);

      // Start metrics session
      discordVoiceMetrics.startSession(guildId, voiceChannel.id);

      // Setup connection state handlers
      this.setupConnectionHandlers(connection, session);

      // Wait for connection to be ready
      await entersState(connection, VoiceConnectionStatus.Ready, 30000);
      console.log('[DiscordVoice] Connected to:', voiceChannel.name);

      // Start listening for voice activity
      this.startListening(session);

      return { success: true };

    } catch (error: any) {
      console.error('[DiscordVoice] Failed to join channel:', error.message);
      this.sessions.delete(guildId);
      return { success: false, error: error.message };
    }
  }

  private setupConnectionHandlers(connection: VoiceConnection, session: VoiceSession): void {
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log('[DiscordVoice] Disconnected from voice channel');
      
      try {
        // Try to reconnect
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
        // Seems to be reconnecting, wait for Ready
        await entersState(connection, VoiceConnectionStatus.Ready, 20000);
        console.log('[DiscordVoice] Reconnected successfully');
        session.reconnectAttempts = 0;
      } catch (error) {
        // Connection lost, try to rejoin or cleanup
        if (session.reconnectAttempts < this.config.reconnectMaxAttempts) {
          session.reconnectAttempts++;
          console.log(`[DiscordVoice] Reconnect attempt ${session.reconnectAttempts}/${this.config.reconnectMaxAttempts}`);
          
          setTimeout(async () => {
            try {
              if (this.client) {
                const channel = await this.client.channels.fetch(session.channelId) as VoiceChannel;
                if (channel) {
                  await this.joinChannel(channel);
                }
              }
            } catch (e) {
              console.error('[DiscordVoice] Reconnect failed:', e);
            }
          }, this.config.reconnectDelay);
        } else {
          console.log('[DiscordVoice] Max reconnect attempts reached, cleaning up');
          // End metrics session before cleanup
          discordVoiceMetrics.endSession(session.guildId);
          connection.destroy();
          this.sessions.delete(session.guildId);
        }
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      console.log('[DiscordVoice] Connection destroyed');
      // End metrics session before cleanup
      discordVoiceMetrics.endSession(session.guildId);
      this.sessions.delete(session.guildId);
    });

    connection.on('error', (error: Error) => {
      console.error('[DiscordVoice] Connection error:', error.message);
    });
  }

  private startListening(session: VoiceSession): void {
    if (session.isListening) return;
    
    session.isListening = true;
    const receiver = session.connection.receiver;
    
    console.log('[DiscordVoice] Started listening for voice activity');

    // Listen for speaking events
    receiver.speaking.on('start', (userId: string) => {
      if (session.isSpeaking) return; // Don't listen while Ulysse is speaking
      
      console.log(`[DiscordVoice] User ${userId} started speaking`);
      session.silenceStart = null;
      session.lastActivity = new Date();
      
      // Create audio stream for this user
      this.captureUserAudio(session, userId);
    });

    receiver.speaking.on('end', (userId: string) => {
      console.log(`[DiscordVoice] User ${userId} stopped speaking`);
      session.silenceStart = Date.now();
    });
  }

  private captureUserAudio(session: VoiceSession, userId: string): void {
    // Prevent multiple concurrent captures from the same user
    if (session.activeCaptures.has(userId)) {
      console.log(`[DiscordVoice] Already capturing audio from user ${userId}, skipping`);
      return;
    }

    // Don't capture while we're speaking or processing
    if (session.isSpeaking || session.isProcessing) {
      console.log('[DiscordVoice] Busy (speaking/processing), skipping capture');
      return;
    }

    const receiver = session.connection.receiver;
    const chunks: Buffer[] = [];
    let totalSize = 0;
    const maxSize = 10 * 1024 * 1024; // 10MB max audio buffer
    
    try {
      // Subscribe to user's audio with opus decoder
      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: this.config.silenceThreshold
        }
      });

      // Decode opus to PCM
      const decoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960
      });

      // Setup max recording timeout
      const recordingTimeout = setTimeout(() => {
        console.log(`[DiscordVoice] Max recording time reached for user ${userId}, forcing end`);
        this.cleanupCapture(session, userId);
      }, this.config.maxRecordingTime);

      // Track active capture for cleanup
      session.activeCaptures.set(userId, { stream: audioStream, decoder, timeout: recordingTimeout });

      audioStream.pipe(decoder);

      decoder.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          console.log(`[DiscordVoice] Max buffer size reached for user ${userId}, forcing end`);
          this.cleanupCapture(session, userId);
          return;
        }
        chunks.push(chunk);
      });

      decoder.on('end', async () => {
        // Clean up the capture tracking
        this.cleanupCapture(session, userId);

        if (chunks.length === 0) {
          console.log('[DiscordVoice] No audio data captured');
          return;
        }

        const audioBuffer = Buffer.concat(chunks);
        console.log(`[DiscordVoice] Captured ${audioBuffer.length} bytes of audio from user ${userId}`);

        // Queue the audio for processing (or process immediately if not busy)
        await this.queueOrProcessAudio(session, audioBuffer, userId);
      });

      decoder.on('error', (error: Error) => {
        console.error('[DiscordVoice] Decoder error:', error.message);
        this.cleanupCapture(session, userId);
      });

      audioStream.on('error', (error: Error) => {
        console.error('[DiscordVoice] Audio stream error:', error.message);
        this.cleanupCapture(session, userId);
      });

    } catch (error: any) {
      console.error('[DiscordVoice] Failed to capture audio:', error.message);
      this.cleanupCapture(session, userId);
    }
  }

  private cleanupCapture(session: VoiceSession, userId: string): void {
    const capture = session.activeCaptures.get(userId);
    if (capture) {
      try {
        clearTimeout(capture.timeout);
        capture.stream.destroy?.();
        capture.decoder.destroy?.();
      } catch (e) {
        // Ignore cleanup errors
      }
      session.activeCaptures.delete(userId);
    }
  }

  private async queueOrProcessAudio(session: VoiceSession, audioBuffer: Buffer, userId: string): Promise<void> {
    // If we're currently processing, queue it
    if (session.isProcessing) {
      console.log('[DiscordVoice] Processing in progress, queuing audio');
      session.processingQueue.push({ audioBuffer, userId });
      // Limit queue size to prevent memory issues
      if (session.processingQueue.length > 3) {
        session.processingQueue.shift(); // Drop oldest
        console.log('[DiscordVoice] Queue full, dropped oldest audio');
      }
      return;
    }

    // Process immediately
    await this.processAudio(session, audioBuffer, userId);

    // Process queued items
    while (session.processingQueue.length > 0 && !session.isSpeaking) {
      const next = session.processingQueue.shift();
      if (next) {
        await this.processAudio(session, next.audioBuffer, next.userId);
      }
    }
  }

  private async processAudio(session: VoiceSession, audioBuffer: Buffer, userId: string): Promise<void> {
    if (!this.ulysseHandler) {
      console.error('[DiscordVoice] No Ulysse handler configured');
      return;
    }

    // Minimum audio size check (avoid processing noise/very short sounds)
    // 48kHz * 2 channels * 2 bytes = 192KB per second, so 10KB ≈ 50ms of audio
    if (audioBuffer.length < 50000) {
      console.log('[DiscordVoice] Audio too short (<250ms), ignoring');
      return;
    }

    // Set processing lock
    session.isProcessing = true;

    try {
      // Convert PCM to WAV format for Whisper
      const wavBuffer = this.pcmToWav(audioBuffer, 48000, 2, 16);
      
      console.log('[DiscordVoice] Transcribing audio with Whisper...');
      const transcription = await speechToText(wavBuffer, this.config.language, 'audio/wav');
      
      if (!transcription || transcription.trim().length === 0) {
        console.log('[DiscordVoice] Empty transcription, ignoring');
        return;
      }

      // Filter out noise/filler transcriptions
      const cleanTranscription = transcription.trim().toLowerCase();
      if (cleanTranscription.length < 3 || 
          ['hm', 'hmm', 'uh', 'um', 'euh', 'ah', 'oh'].includes(cleanTranscription)) {
        console.log('[DiscordVoice] Noise/filler detected, ignoring');
        return;
      }

      console.log(`[DiscordVoice] Transcribed: "${transcription}"`);

      // Record transcription metrics (estimate audio duration from buffer size: 48kHz * 2 channels * 2 bytes = 192KB/s)
      const audioDurationMs = Math.round((audioBuffer.length / 192000) * 1000);
      // Try to get username from Discord client
      let username: string | undefined;
      try {
        const guild = this.client?.guilds.cache.get(session.guildId);
        const member = guild?.members.cache.get(userId);
        username = member?.displayName || member?.user.username;
      } catch (e) {
        // Ignore, username is optional
      }
      discordVoiceMetrics.recordTranscription(session.guildId, userId, transcription, audioDurationMs, username);

      // Process with Ulysse
      console.log('[DiscordVoice] Processing with Ulysse...');
      const response = await this.ulysseHandler(transcription, userId);
      
      console.log(`[DiscordVoice] Ulysse response: "${response.substring(0, 100)}..."`);

      // Send response to text channel if available
      if (session.textChannelId && this.client) {
        try {
          const textChannel = await this.client.channels.fetch(session.textChannelId);
          if (textChannel && textChannel.isTextBased()) {
            const { EmbedBuilder } = await import('discord.js');
            const embed = new EmbedBuilder()
              .setColor(0x5865F2)
              .setAuthor({ name: 'Ulysse - Reponse vocale' })
              .setDescription(response.length > 4000 ? response.substring(0, 4000) + '...' : response)
              .addFields({ name: 'Question', value: transcription.length > 1000 ? transcription.substring(0, 1000) + '...' : transcription })
              .setTimestamp();
            await (textChannel as any).send({ embeds: [embed] });
          }
        } catch (e) {
          console.error('[DiscordVoice] Failed to send text response:', e);
        }
      }

      // Generate TTS and speak
      await this.speak(session, response);

    } catch (error: any) {
      console.error('[DiscordVoice] Processing error:', error.message);
      discordVoiceMetrics.recordSTTError(session.guildId);
      
      // Try to speak an error message
      try {
        await this.speak(session, "Désolé, je n'ai pas bien compris. Peux-tu répéter?");
      } catch (e) {
        console.error('[DiscordVoice] Failed to speak error message:', e);
        discordVoiceMetrics.recordTTSError(session.guildId);
      }
    } finally {
      // Release processing lock
      session.isProcessing = false;
    }
  }

  private pcmToWav(pcmData: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);           // Chunk size
    buffer.writeUInt16LE(1, 20);            // Audio format (PCM)
    buffer.writeUInt16LE(channels, 22);     // Channels
    buffer.writeUInt32LE(sampleRate, 24);   // Sample rate
    buffer.writeUInt32LE(byteRate, 28);     // Byte rate
    buffer.writeUInt16LE(blockAlign, 32);   // Block align
    buffer.writeUInt16LE(bitsPerSample, 34); // Bits per sample

    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    pcmData.copy(buffer, 44);

    return buffer;
  }

  async speak(session: VoiceSession, text: string): Promise<void> {
    if (!session || !session.connection) {
      console.error('[DiscordVoice] No active session for speaking');
      return;
    }

    // Mark as speaking to avoid listening loop
    session.isSpeaking = true;

    try {
      console.log('[DiscordVoice] Generating TTS for:', text.substring(0, 50) + '...');
      
      // Record TTS metrics
      discordVoiceMetrics.recordTTS(session.guildId);
      
      // Generate TTS audio
      const audioBuffer = await textToSpeech(text, {
        voice: this.config.ttsVoice,
        speed: 1.0
      });

      // Create readable stream from buffer
      const audioStream = new Readable();
      audioStream.push(audioBuffer);
      audioStream.push(null);

      // Create audio resource (MP3 format from OpenAI TTS)
      const resource = createAudioResource(audioStream, {
        inputType: StreamType.Arbitrary
      });

      // Play the audio
      session.player.play(resource);

      // Wait for audio to finish
      await new Promise<void>((resolve, reject) => {
        session.player.once(AudioPlayerStatus.Idle, () => {
          console.log('[DiscordVoice] Finished speaking');
          resolve();
        });

        session.player.once('error', (error: Error) => {
          console.error('[DiscordVoice] Player error:', error.message);
          reject(error);
        });

        // Timeout safety
        setTimeout(() => {
          resolve();
        }, 60000);
      });

    } catch (error: any) {
      console.error('[DiscordVoice] TTS/speak error:', error.message);
    } finally {
      // Resume listening
      session.isSpeaking = false;
    }
  }

  setTextChannel(guildId: string, textChannelId: string): boolean {
    const session = this.sessions.get(guildId);
    if (!session) {
      return false;
    }
    session.textChannelId = textChannelId;
    return true;
  }

  async leaveChannel(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) {
      return false;
    }

    try {
      session.isListening = false;
      
      // Cleanup all active captures before leaving
      const activeUserIds = Array.from(session.activeCaptures.keys());
      for (const userId of activeUserIds) {
        this.cleanupCapture(session, userId);
      }
      
      // Clear processing queue
      session.processingQueue = [];
      
      // End metrics session
      const metrics = discordVoiceMetrics.endSession(guildId);
      if (metrics) {
        console.log(`[DiscordVoice] Session stats: ${metrics.transcriptionCount} transcriptions, ${metrics.ttsCount} TTS, duration: ${metrics.durationMs}ms`);
      }
      
      session.connection.destroy();
      this.sessions.delete(guildId);
      console.log('[DiscordVoice] Left voice channel');
      return true;
    } catch (error: any) {
      console.error('[DiscordVoice] Error leaving channel:', error.message);
      return false;
    }
  }

  async speakInChannel(guildId: string, text: string): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) {
      console.error('[DiscordVoice] No session for guild:', guildId);
      return false;
    }

    try {
      await this.speak(session, text);
      return true;
    } catch (error: any) {
      console.error('[DiscordVoice] Failed to speak:', error.message);
      return false;
    }
  }

  isInChannel(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  getSessionInfo(guildId: string): { channelId: string; isListening: boolean; isSpeaking: boolean } | null {
    const session = this.sessions.get(guildId);
    if (!session) return null;

    return {
      channelId: session.channelId,
      isListening: session.isListening,
      isSpeaking: session.isSpeaking
    };
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  isVoiceSupported(): boolean {
    return isVoiceSupported();
  }

  setConfig(config: Partial<VoiceConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[DiscordVoice] Config updated:', this.config);
  }
}

export const discordVoiceService = new DiscordVoiceService();
