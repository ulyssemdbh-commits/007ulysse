import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
import * as faceRecognitionService from "./faceRecognitionService";

const FRAMES_DIR = path.join(process.cwd(), "temp_frames");
const AUDIO_DIR = path.join(process.cwd(), "temp_audio");

if (!fs.existsSync(FRAMES_DIR)) {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
}
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  hasAudio: boolean;
  audioCodec?: string;
  fileSize: number;
}

export interface ExtractedFrame {
  timestamp: number;
  framePath: string;
  isSceneChange: boolean;
  frameNumber: number;
}

export interface FrameAnalysis {
  timestamp: number;
  description: string;
  objects: string[];
  actions: string[];
  text?: string;
  faces?: FaceInFrame[];
  sceneType?: string;
  isSceneChange?: boolean;
  frameNumber?: number;
}

export interface FaceInFrame {
  personId?: number;
  personName?: string;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  isUnknown: boolean;
}

export interface AudioSegment {
  startTime: number;
  endTime: number;
  text: string;
  speaker?: string;
}

export interface VideoAnalysisResult {
  videoPath: string;
  fileName: string;
  metadata: VideoMetadata;
  frames: FrameAnalysis[];
  transcript: AudioSegment[];
  summary: string;
  keyMoments: KeyMoment[];
  facesDetected: { personId?: number; personName: string; appearances: number[] }[];
  analysisTimestamp: Date;
  processingTimeMs: number;
}

export interface KeyMoment {
  timestamp: number;
  description: string;
  importance: "high" | "medium" | "low";
  type: "scene_change" | "speech" | "action" | "face_appearance" | "text_visible";
}

async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      videoPath
    ]);

    let stdout = "";
    let stderr = "";

    ffprobe.stdout.on("data", (data) => { stdout += data; });
    ffprobe.stderr.on("data", (data) => { stderr += data; });

    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr}`));
        return;
      }

      try {
        const info = JSON.parse(stdout);
        const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
        const audioStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === "audio");
        const format = info.format || {};

        const fpsStr = videoStream?.r_frame_rate || "30/1";
        const [fpsNum, fpsDen] = fpsStr.split("/").map(Number);
        const fps = fpsDen ? fpsNum / fpsDen : 30;

        resolve({
          duration: parseFloat(format.duration || "0"),
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          fps: Math.round(fps * 100) / 100,
          codec: videoStream?.codec_name || "unknown",
          bitrate: parseInt(format.bit_rate || "0", 10),
          hasAudio: !!audioStream,
          audioCodec: audioStream?.codec_name,
          fileSize: parseInt(format.size || "0", 10)
        });
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e}`));
      }
    });
  });
}

async function extractFrames(
  videoPath: string,
  sessionId: string,
  options: { 
    sceneThreshold?: number; 
    maxFrames?: number;
    intervalSeconds?: number;
  } = {}
): Promise<ExtractedFrame[]> {
  const { sceneThreshold = 0.3, maxFrames = 30, intervalSeconds = 2 } = options;
  const outputDir = path.join(FRAMES_DIR, sessionId);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const metadata = await getVideoMetadata(videoPath);
  const frames: ExtractedFrame[] = [];

  const sceneFramesPattern = path.join(outputDir, "scene_%04d.jpg");
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", videoPath,
      "-vf", `select='gt(scene,${sceneThreshold})',showinfo`,
      "-vsync", "vfr",
      "-q:v", "2",
      "-frames:v", String(Math.min(maxFrames, 15)),
      sceneFramesPattern,
      "-y"
    ]);

    ffmpeg.on("close", (code) => {
      if (code === 0 || fs.readdirSync(outputDir).filter(f => f.startsWith("scene_")).length > 0) {
        resolve();
      } else {
        resolve();
      }
    });
    ffmpeg.on("error", reject);
  });

  const sceneFiles = fs.readdirSync(outputDir).filter(f => f.startsWith("scene_")).sort();
  let frameIndex = 0;
  for (const file of sceneFiles) {
    frames.push({
      timestamp: frameIndex * (metadata.duration / Math.max(sceneFiles.length, 1)),
      framePath: path.join(outputDir, file),
      isSceneChange: true,
      frameNumber: frameIndex++
    });
  }

  const intervalFramesNeeded = Math.min(maxFrames - frames.length, Math.ceil(metadata.duration / intervalSeconds));
  if (intervalFramesNeeded > 0 && metadata.duration > 0) {
    const intervalPattern = path.join(outputDir, "interval_%04d.jpg");
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-i", videoPath,
        "-vf", `fps=1/${intervalSeconds}`,
        "-q:v", "2",
        "-frames:v", String(intervalFramesNeeded),
        intervalPattern,
        "-y"
      ]);

      ffmpeg.on("close", () => resolve());
      ffmpeg.on("error", reject);
    });

    const intervalFiles = fs.readdirSync(outputDir).filter(f => f.startsWith("interval_")).sort();
    for (let i = 0; i < intervalFiles.length; i++) {
      const timestamp = i * intervalSeconds;
      const alreadyHasFrame = frames.some(f => Math.abs(f.timestamp - timestamp) < 1);
      if (!alreadyHasFrame) {
        frames.push({
          timestamp,
          framePath: path.join(outputDir, intervalFiles[i]),
          isSceneChange: false,
          frameNumber: frames.length
        });
      }
    }
  }

  frames.sort((a, b) => a.timestamp - b.timestamp);
  return frames.slice(0, maxFrames);
}

async function extractAudio(videoPath: string, sessionId: string): Promise<string | null> {
  const outputPath = path.join(AUDIO_DIR, `${sessionId}.mp3`);
  
  return new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", videoPath,
      "-vn",
      "-acodec", "libmp3lame",
      "-q:a", "4",
      outputPath,
      "-y"
    ]);

    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        resolve(null);
      }
    });
    ffmpeg.on("error", () => resolve(null));
  });
}

async function transcribeAudio(audioPath: string, openai: OpenAI): Promise<AudioSegment[]> {
  try {
    const audioBuffer = fs.readFileSync(audioPath);
    const audioFile = new File([audioBuffer], path.basename(audioPath), { type: "audio/mp3" });

    const response = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"]
    });

    const segments: AudioSegment[] = [];
    if (response.segments) {
      for (const seg of response.segments) {
        segments.push({
          startTime: seg.start,
          endTime: seg.end,
          text: seg.text.trim()
        });
      }
    } else if (response.text) {
      segments.push({
        startTime: 0,
        endTime: 0,
        text: response.text
      });
    }

    return segments;
  } catch (error) {
    console.error("Audio transcription error:", error);
    return [];
  }
}

async function analyzeFrameWithVision(
  framePath: string,
  timestamp: number,
  openai: OpenAI,
  context?: string
): Promise<FrameAnalysis> {
  try {
    const imageBuffer = fs.readFileSync(framePath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = "image/jpeg";

    const prompt = `Analyse cette image extraite d'une vidéo au timestamp ${timestamp.toFixed(1)} secondes.
${context ? `Contexte: ${context}` : ""}

Fournis une analyse PRÉCISE et FACTUELLE. Décris UNIQUEMENT ce que tu vois réellement.

Réponds en JSON avec ce format exact:
{
  "description": "Description détaillée et factuelle de la scène",
  "objects": ["liste", "des", "objets", "visibles"],
  "actions": ["actions", "en", "cours"],
  "text": "tout texte visible dans l'image ou null",
  "sceneType": "intérieur|extérieur|portrait|paysage|document|écran|autre"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { 
              type: "image_url", 
              image_url: { 
                url: `data:${mimeType};base64,${base64Image}`,
                detail: "high"
              } 
            }
          ]
        }
      ],
      max_tokens: 500,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content || "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { console.warn("[VideoAnalysis] Failed to parse AI frame analysis"); }

    return {
      timestamp,
      description: parsed.description || "Analyse non disponible",
      objects: parsed.objects || [],
      actions: parsed.actions || [],
      text: parsed.text || undefined,
      sceneType: parsed.sceneType || "autre"
    };
  } catch (error) {
    console.error(`Frame analysis error at ${timestamp}s:`, error);
    return {
      timestamp,
      description: "Erreur lors de l'analyse de cette frame",
      objects: [],
      actions: []
    };
  }
}

async function detectFacesInFrame(
  _framePath: string,
  _userId: number
): Promise<FaceInFrame[]> {
  // Face detection for video frames requires face-api.js server-side setup
  // For now, return empty array - face detection can be added later with proper canvas setup
  // The GPT-4V analysis will still describe people visible in the frames
  return [];
}

function generateSummary(
  metadata: VideoMetadata,
  frames: FrameAnalysis[],
  transcript: AudioSegment[],
  facesDetected: { personId?: number; personName: string; appearances: number[] }[]
): string {
  const durationMin = Math.floor(metadata.duration / 60);
  const durationSec = Math.round(metadata.duration % 60);
  const durationStr = durationMin > 0 ? `${durationMin}m ${durationSec}s` : `${durationSec}s`;

  let summary = `**Analyse vidéo** (${durationStr}, ${metadata.width}x${metadata.height})\n\n`;

  const sceneTypes = frames.map(f => f.sceneType).filter((s): s is string => Boolean(s));
  const uniqueScenes = Array.from(new Set(sceneTypes));
  if (uniqueScenes.length > 0) {
    summary += `**Types de scènes:** ${uniqueScenes.join(", ")}\n\n`;
  }

  const allObjects = frames.flatMap(f => f.objects);
  const objectCounts = allObjects.reduce((acc, obj) => {
    acc[obj] = (acc[obj] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const topObjects = Object.entries(objectCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([obj]) => obj);
  if (topObjects.length > 0) {
    summary += `**Objets principaux:** ${topObjects.join(", ")}\n\n`;
  }

  if (facesDetected.length > 0) {
    const knownFaces = facesDetected.filter(f => f.personId);
    const unknownCount = facesDetected.filter(f => !f.personId).length;
    if (knownFaces.length > 0) {
      summary += `**Personnes identifiées:** ${knownFaces.map(f => f.personName).join(", ")}\n`;
    }
    if (unknownCount > 0) {
      summary += `**Visages inconnus:** ${unknownCount}\n`;
    }
    summary += "\n";
  }

  if (transcript.length > 0) {
    const fullText = transcript.map(s => s.text).join(" ");
    const words = fullText.split(/\s+/).length;
    summary += `**Transcription:** ${words} mots détectés\n`;
    if (fullText.length > 200) {
      summary += `Extrait: "${fullText.slice(0, 200)}..."\n`;
    } else if (fullText.length > 0) {
      summary += `"${fullText}"\n`;
    }
    summary += "\n";
  }

  const keyDescriptions = frames
    .filter(f => f.isSceneChange || f.frameNumber === 0)
    .slice(0, 5)
    .map(f => `- ${f.timestamp.toFixed(1)}s: ${f.description.slice(0, 100)}`);
  if (keyDescriptions.length > 0) {
    summary += `**Moments clés:**\n${keyDescriptions.join("\n")}\n`;
  }

  return summary;
}

function identifyKeyMoments(
  frames: FrameAnalysis[],
  transcript: AudioSegment[],
  facesDetected: { personId?: number; personName: string; appearances: number[] }[]
): KeyMoment[] {
  const keyMoments: KeyMoment[] = [];

  for (const frame of frames) {
    if (frame.sceneType && frames.filter(f => f.sceneType === frame.sceneType).length <= 2) {
      keyMoments.push({
        timestamp: frame.timestamp,
        description: `Changement de scène: ${frame.description.slice(0, 80)}`,
        importance: "medium",
        type: "scene_change"
      });
    }

    if (frame.text) {
      keyMoments.push({
        timestamp: frame.timestamp,
        description: `Texte visible: "${frame.text.slice(0, 50)}"`,
        importance: "medium",
        type: "text_visible"
      });
    }
  }

  for (const face of facesDetected) {
    if (face.appearances.length > 0) {
      keyMoments.push({
        timestamp: face.appearances[0],
        description: `${face.personName} apparaît dans la vidéo`,
        importance: face.personId ? "high" : "low",
        type: "face_appearance"
      });
    }
  }

  for (const segment of transcript) {
    if (segment.text.length > 50) {
      keyMoments.push({
        timestamp: segment.startTime,
        description: `Parole: "${segment.text.slice(0, 60)}..."`,
        importance: "medium",
        type: "speech"
      });
    }
  }

  keyMoments.sort((a, b) => a.timestamp - b.timestamp);
  return keyMoments.slice(0, 20);
}

function cleanupTempFiles(sessionId: string): void {
  const framesDir = path.join(FRAMES_DIR, sessionId);
  const audioPath = path.join(AUDIO_DIR, `${sessionId}.mp3`);

  try {
    if (fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}

export async function analyzeVideo(
  videoPath: string,
  userId: number,
  openai: OpenAI,
  options: {
    maxFrames?: number;
    transcribeAudio?: boolean;
    detectFaces?: boolean;
    intervalSeconds?: number;
  } = {}
): Promise<VideoAnalysisResult> {
  const startTime = Date.now();
  const sessionId = `video_${userId}_${Date.now()}`;
  const { 
    maxFrames = 20, 
    transcribeAudio: shouldTranscribe = true, 
    detectFaces = true,
    intervalSeconds = 3
  } = options;

  try {
    console.log(`[VideoAnalysis] Starting analysis of ${videoPath}`);

    const metadata = await getVideoMetadata(videoPath);
    console.log(`[VideoAnalysis] Metadata: ${metadata.duration}s, ${metadata.width}x${metadata.height}`);

    const extractedFrames = await extractFrames(videoPath, sessionId, {
      maxFrames,
      intervalSeconds,
      sceneThreshold: 0.3
    });
    console.log(`[VideoAnalysis] Extracted ${extractedFrames.length} frames`);

    let transcript: AudioSegment[] = [];
    if (shouldTranscribe && metadata.hasAudio) {
      const audioPath = await extractAudio(videoPath, sessionId);
      if (audioPath) {
        transcript = await transcribeAudio(audioPath, openai);
        console.log(`[VideoAnalysis] Transcribed ${transcript.length} segments`);
      }
    }

    const frames: FrameAnalysis[] = [];
    const faceAppearances = new Map<string, { personId?: number; personName: string; timestamps: number[] }>();

    for (const extractedFrame of extractedFrames) {
      const transcriptContext = transcript
        .filter(s => s.startTime <= extractedFrame.timestamp && s.endTime >= extractedFrame.timestamp)
        .map(s => s.text)
        .join(" ");

      const frameAnalysis = await analyzeFrameWithVision(
        extractedFrame.framePath,
        extractedFrame.timestamp,
        openai,
        transcriptContext
      );

      if (detectFaces) {
        const faces = await detectFacesInFrame(extractedFrame.framePath, userId);
        frameAnalysis.faces = faces;

        for (const face of faces) {
          const key = face.personId ? `id_${face.personId}` : `unknown_${face.personName || "unknown"}`;
          if (!faceAppearances.has(key)) {
            faceAppearances.set(key, {
              personId: face.personId,
              personName: face.personName || "Inconnu",
              timestamps: []
            });
          }
          faceAppearances.get(key)!.timestamps.push(extractedFrame.timestamp);
        }
      }

      frames.push(frameAnalysis);
    }

    const facesDetected = Array.from(faceAppearances.values()).map(f => ({
      personId: f.personId,
      personName: f.personName,
      appearances: f.timestamps
    }));

    const summary = generateSummary(metadata, frames, transcript, facesDetected);
    const keyMoments = identifyKeyMoments(frames, transcript, facesDetected);

    const result: VideoAnalysisResult = {
      videoPath,
      fileName: path.basename(videoPath),
      metadata,
      frames,
      transcript,
      summary,
      keyMoments,
      facesDetected,
      analysisTimestamp: new Date(),
      processingTimeMs: Date.now() - startTime
    };

    console.log(`[VideoAnalysis] Complete in ${result.processingTimeMs}ms`);
    return result;

  } finally {
    // Always cleanup temp files to prevent storage leaks
    cleanupTempFiles(sessionId);
  }
}

export async function getQuickVideoPreview(
  videoPath: string,
  openai: OpenAI
): Promise<{ thumbnail: string; duration: number; summary: string }> {
  const sessionId = `preview_${Date.now()}`;
  
  try {
    const metadata = await getVideoMetadata(videoPath);
    
    const thumbnailPath = path.join(FRAMES_DIR, `${sessionId}_thumb.jpg`);
    await new Promise<void>((resolve) => {
      const ffmpeg = spawn("ffmpeg", [
        "-i", videoPath,
        "-ss", String(Math.min(1, metadata.duration / 2)),
        "-frames:v", "1",
        "-q:v", "2",
        thumbnailPath,
        "-y"
      ]);
      ffmpeg.on("close", () => resolve());
      ffmpeg.on("error", () => resolve());
    });

    let thumbnailBase64 = "";
    if (fs.existsSync(thumbnailPath)) {
      thumbnailBase64 = fs.readFileSync(thumbnailPath).toString("base64");
      fs.unlinkSync(thumbnailPath);
    }

    return {
      thumbnail: thumbnailBase64 ? `data:image/jpeg;base64,${thumbnailBase64}` : "",
      duration: metadata.duration,
      summary: `Vidéo ${metadata.width}x${metadata.height}, ${metadata.duration.toFixed(1)}s, ${metadata.hasAudio ? "avec audio" : "sans audio"}`
    };
  } catch (error) {
    return {
      thumbnail: "",
      duration: 0,
      summary: "Aperçu non disponible"
    };
  }
}
