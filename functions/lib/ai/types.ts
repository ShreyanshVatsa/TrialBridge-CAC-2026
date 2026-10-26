import type { MinimizedProfile } from "@/lib/types/analysis";
import type { Language } from "@/lib/types/intake";
import type { ServerTrial } from "../trials";
import type { MatchPromptTrial } from "@/prompts/analyze-v3";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ProviderErrorKind = "rate_limited" | "server" | "timeout" | "network" | "client" | "invalid_output";

/** Typed provider failure; every kind triggers failover to the next provider. */
export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** Structured context (used by the mock provider; real providers only see `messages`). */
  profile?: MinimizedProfile;
  trials: readonly ServerTrial[];
  /** Present for Trial Q&A requests (mock provider uses it). */
  ask?: { question: string; language: Language };
  /** Present for criterion-judge requests (mock provider uses it). */
  match?: { trials: readonly MatchPromptTrial[] };
  /** Completion-token cap for this request (default 6000). */
  maxTokens?: number;
  /** gpt-oss reasoning effort; omitted = the model default (medium). */
  reasoningEffort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

export interface AiProvider {
  name: string;
  /** Mock provider: no budget, never used when a real provider is enabled. */
  isMock: boolean;
  maxInputChars: number;
  /** Returns the raw model text (expected to be JSON). Throws ProviderError on failure. */
  complete(req: CompletionRequest): Promise<string>;
}
