export interface VoiceAPIConfig {
  baseUrl: string;
  credentials?: RequestCredentials;
}

export interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;
}

export interface STTRequest {
  audio: Blob;
  language?: string;
}

export interface VoiceStatusResponse {
  useBrowserFallback: boolean;
  openaiAvailable: boolean;
}

export interface VoiceAPI {
  getStatus: () => Promise<VoiceStatusResponse>;
  tts: (request: TTSRequest) => Promise<Blob>;
  stt: (request: STTRequest, signal?: AbortSignal) => Promise<string>;
}

export function createVoiceAPI(config: Partial<VoiceAPIConfig> = {}): VoiceAPI {
  const { baseUrl = "/api/voice", credentials = "include" } = config;

  const getStatus = async (): Promise<VoiceStatusResponse> => {
    try {
      const response = await fetch(`${baseUrl}/status`, { credentials });
      if (!response.ok) throw new Error("Status request failed");
      return response.json();
    } catch (error) {
      console.error("[VoiceAPI] Status check failed:", error);
      return { useBrowserFallback: true, openaiAvailable: false };
    }
  };

  const tts = async (request: TTSRequest): Promise<Blob> => {
    const response = await fetch(`${baseUrl}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials,
      body: JSON.stringify({
        text: request.text,
        voice: request.voice || "onyx",
        speed: request.speed || 1.0,
      }),
    });

    if (!response.ok) {
      throw new Error(`TTS request failed: ${response.status}`);
    }

    return response.blob();
  };

  const stt = async (request: STTRequest, signal?: AbortSignal): Promise<string> => {
    const { audio, language = "fr" } = request;
    
    const mimeType = audio.type || "audio/webm";
    let extension = "webm";
    if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
      extension = "m4a";
    } else if (mimeType.includes("ogg")) {
      extension = "ogg";
    } else if (mimeType.includes("wav")) {
      extension = "wav";
    } else if (mimeType.includes("mp3") || mimeType.includes("mpeg")) {
      extension = "mp3";
    }

    const formData = new FormData();
    formData.append("audio", audio, `audio.${extension}`);
    formData.append("language", language);
    formData.append("mimeType", mimeType);

    const response = await fetch(`${baseUrl}/stt`, {
      method: "POST",
      credentials,
      body: formData,
      signal,
    });

    if (!response.ok) {
      throw new Error(`STT request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.transcript || "";
  };

  return { getStatus, tts, stt };
}

const defaultVoiceAPI = createVoiceAPI();

export default defaultVoiceAPI;
