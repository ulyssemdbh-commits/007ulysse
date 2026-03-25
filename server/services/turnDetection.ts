/**
 * TurnDetection - Robust end-of-speech detection for voice calls
 * 
 * Combines three signals:
 * 1. Audio silence (RMS energy below threshold)
 * 2. Text analysis (punctuation, word count, stability)
 * 3. Timeout (max turn duration)
 */

export type TurnDetectionConfig = {
  silenceThreshold: number;      // RMS threshold (0.0015 = very sensitive)
  silenceDurationMs: number;     // How long silence must persist (800ms)
  maxTurnMs: number;             // Force end after this (12000ms)
  minWordsForEos: number;        // Minimum words before allowing EOS (3)
  punctuationBonus: boolean;     // End faster if punctuation detected
  stabilityWindowMs: number;     // Window for transcript stability check (1500ms)
};

export type TurnState = {
  currentTranscript: string;
  previousTranscript: string;
  turnStartTime: number;
  lastSpeechTime: number;
  lastTranscriptChangeTime: number;
  isSpeaking: boolean;
  hasEnded: boolean;
};

export const DEFAULT_CONFIG: TurnDetectionConfig = {
  silenceThreshold: 0.002,       // Adjusted for typical mic levels
  silenceDurationMs: 600,        // 600ms of silence = probably done (was 800)
  maxTurnMs: 15000,              // 15 seconds max per turn
  minWordsForEos: 2,             // 2 words minimum (was 3)
  punctuationBonus: true,        // End faster with . ? !
  stabilityWindowMs: 1000,       // 1s stability (was 1.5s)
};

export class TurnDetector {
  private config: TurnDetectionConfig;
  private state: TurnState;
  private onEndTurn: (finalTranscript: string, reason: string) => void | Promise<void>;
  private endTurnPending: boolean = false;
  private silentChunkCount: number = 0;
  private readonly CHUNKS_PER_SECOND = 4; // Approximate chunks per second

  constructor(
    config: Partial<TurnDetectionConfig> = {},
    onEndTurn: (text: string, reason: string) => void | Promise<void>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onEndTurn = onEndTurn;
    this.state = this.createInitialState();
  }

  private createInitialState(): TurnState {
    const now = Date.now();
    return {
      currentTranscript: '',
      previousTranscript: '',
      turnStartTime: now,
      lastSpeechTime: now,
      lastTranscriptChangeTime: now,
      isSpeaking: false,
      hasEnded: false,
    };
  }

  /**
   * Reset detector for a new turn
   */
  reset() {
    this.state = this.createInitialState();
    this.endTurnPending = false;
    this.silentChunkCount = 0;
  }

  /**
   * Process an audio chunk (PCM16)
   * @param pcm Int16Array of audio samples
   */
  handleAudioChunk(pcm: Int16Array): void {
    if (this.state.hasEnded || this.endTurnPending) return;

    const now = Date.now();
    const silent = this.isSilent(pcm);

    if (!silent) {
      // User is speaking
      this.state.isSpeaking = true;
      this.state.lastSpeechTime = now;
      this.silentChunkCount = 0;
    } else {
      // Silent chunk
      this.silentChunkCount++;
      const silenceDuration = now - this.state.lastSpeechTime;

      // Check for silence-based end of turn
      if (this.state.isSpeaking && silenceDuration > this.config.silenceDurationMs) {
        this.state.isSpeaking = false;
        this.checkEndOfTurn('silence');
      }
    }

    // Check for timeout
    const turnDuration = now - this.state.turnStartTime;
    if (turnDuration > this.config.maxTurnMs) {
      this.checkEndOfTurn('timeout');
    }
  }

  /**
   * Process a transcript update from Whisper
   * @param newTranscript The current transcript text
   */
  handleTranscriptUpdate(newTranscript: string): void {
    if (this.state.hasEnded || this.endTurnPending) return;

    const trimmed = newTranscript.trim();
    
    // Track transcript changes for stability detection
    if (trimmed !== this.state.currentTranscript) {
      this.state.previousTranscript = this.state.currentTranscript;
      this.state.currentTranscript = trimmed;
      this.state.lastTranscriptChangeTime = Date.now();
    }

    // Check for text-based end of turn
    this.checkEndOfTurn('text');
  }

  /**
   * Force check for end of turn (can be called externally)
   */
  forceCheck(): void {
    if (!this.state.hasEnded && !this.endTurnPending) {
      this.checkEndOfTurn('force');
    }
  }

  /**
   * Get current state (for debugging/logging)
   */
  getState(): Readonly<TurnState> {
    return { ...this.state };
  }

  /**
   * Check if conditions are met to end the turn
   */
  private checkEndOfTurn(reason: 'silence' | 'timeout' | 'text' | 'force'): void {
    if (this.state.hasEnded || this.endTurnPending) return;

    const text = this.state.currentTranscript.trim();
    if (!text) return;

    const now = Date.now();
    const words = text.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const endsWithPunct = /[.?!…。？！]$/.test(text);
    const endsWithQuestion = /\?|？$/.test(text);

    // Calculate durations
    const silenceDuration = now - this.state.lastSpeechTime;
    const turnDuration = now - this.state.turnStartTime;
    const transcriptStable = now - this.state.lastTranscriptChangeTime > this.config.stabilityWindowMs;

    // Minimum words check
    const enoughWords = wordCount >= this.config.minWordsForEos;

    // Silence check (with adaptive threshold based on word count)
    const silenceMultiplier = endsWithPunct ? 0.7 : 1.0; // Faster end with punctuation
    const requiredSilence = this.config.silenceDurationMs * silenceMultiplier;
    const silenceLong = silenceDuration > requiredSilence;

    // Determine if we should end the turn
    let shouldEnd = false;
    let endReason = reason;

    // Priority 1: Timeout (forced)
    if (reason === 'timeout' || turnDuration > this.config.maxTurnMs) {
      shouldEnd = true;
      endReason = 'timeout';
    }
    // Priority 2: Force check with content
    else if (reason === 'force' && enoughWords) {
      shouldEnd = true;
      endReason = 'force';
    }
    // Priority 3: Silence + enough words
    else if (reason === 'silence' && silenceLong && enoughWords) {
      shouldEnd = true;
      endReason = 'silence';
    }
    // Priority 4: Punctuation + silence + enough words
    else if (reason === 'text' && endsWithPunct && enoughWords && silenceLong) {
      shouldEnd = true;
      endReason = 'punctuation';
    }
    // Priority 5: Question with shorter patience
    else if (reason === 'text' && endsWithQuestion && wordCount >= 2 && silenceDuration > 500) {
      shouldEnd = true;
      endReason = 'question';
    }
    // Priority 6: Transcript stability (user stopped, text stable)
    else if (transcriptStable && silenceLong && enoughWords && !this.state.isSpeaking) {
      shouldEnd = true;
      endReason = 'stability';
    }

    if (shouldEnd) {
      this.triggerEndTurn(text, endReason);
    }
  }

  /**
   * Trigger the end of turn callback
   */
  private async triggerEndTurn(text: string, reason: string): Promise<void> {
    if (this.endTurnPending || this.state.hasEnded) return;

    this.endTurnPending = true;
    this.state.hasEnded = true;

    console.log(`[TurnDetector] End of turn (${reason}): "${text.substring(0, 50)}..." (${text.split(/\s+/).length} words)`);

    try {
      await this.onEndTurn(text, reason);
    } catch (error) {
      console.error('[TurnDetector] Error in onEndTurn callback:', error);
    }

    // Reset for next turn (but keep hasEnded true until explicit reset)
    this.state.currentTranscript = '';
    this.state.previousTranscript = '';
    this.endTurnPending = false;
  }

  /**
   * Calculate RMS (Root Mean Square) to detect silence
   */
  private isSilent(pcm: Int16Array): boolean {
    if (pcm.length === 0) return true;

    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
      sum += pcm[i] * pcm[i];
    }
    
    // Normalize to 0-1 range (Int16 max = 32768)
    const rms = Math.sqrt(sum / pcm.length) / 32768;
    return rms < this.config.silenceThreshold;
  }

  /**
   * Get energy level (for debugging/UI)
   */
  getEnergyLevel(pcm: Int16Array): number {
    if (pcm.length === 0) return 0;

    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
      sum += pcm[i] * pcm[i];
    }
    
    return Math.sqrt(sum / pcm.length) / 32768;
  }
}

/**
 * Create a pre-configured TurnDetector for call mode
 */
export function createCallModeDetector(
  onEndTurn: (text: string, reason: string) => void | Promise<void>
): TurnDetector {
  return new TurnDetector(
    {
      silenceThreshold: 0.002,
      silenceDurationMs: 600,      // 600ms (was 900ms) — réactivité améliorée
      maxTurnMs: 15000,
      minWordsForEos: 2,           // 2 mots minimum (était 3)
      punctuationBonus: true,
      stabilityWindowMs: 900,      // 900ms (était 1500ms)
    },
    onEndTurn
  );
}

/**
 * Create a pre-configured TurnDetector for standard voice mode
 */
export function createStandardModeDetector(
  onEndTurn: (text: string, reason: string) => void | Promise<void>
): TurnDetector {
  return new TurnDetector(
    {
      silenceThreshold: 0.0015,    // More sensitive
      silenceDurationMs: 600,      // Faster response
      maxTurnMs: 10000,            // 10 seconds max
      minWordsForEos: 2,
      punctuationBonus: true,
      stabilityWindowMs: 1000,
    },
    onEndTurn
  );
}
