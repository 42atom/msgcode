/**
 * msgcode: TTS Backend Types
 *
 * Shared types for all TTS backend implementations
 */

export type TtsBackend = "qwen" | "indextts";

export type TtsResult = {
  success: boolean;
  audioPath?: string;
  artifactId?: string;
  backend?: TtsBackend;
  error?: string;
};

export type TtsOptions = {
  workspacePath: string;
  text: string;
  voice?: string;
  model?: string;
  instruct?: string;
  refAudioPath?: string;
  refText?: string;
  lang?: string;
  speed?: number;
  temperature?: number;
  maxTokens?: number;
  format?: "wav" | "m4a";
  timeoutMs?: number;

  // Emotion vector support (IndexTTS)
  emoAuto?: boolean;          // Enable auto-emotion analysis via LM Studio
  emotionText?: string;
  emotionVector?: number[];  // 8 floats for IndexTTS
  emotionAlpha?: number;      // default 0.6
};

export type TtsBackendContext = {
  workspacePath: string;
  text: string;
  artifactId: string;
  wavPath: string;
  m4aPath: string;
  outFormat: "wav" | "m4a";
  timeoutMs: number;
};

export type TtsBackendRunner = (options: TtsOptions & TtsBackendContext) => Promise<TtsResult>;
