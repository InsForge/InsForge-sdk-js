/**
 * AI Module Types - OpenAI-compatible interfaces for Insforge AI
 * 
 * These types follow OpenAI SDK conventions while mapping to Insforge backend
 */

// ============= OpenAI-style Chat Types (SDK Interface) =============

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  max_tokens?: number;  // OpenAI style (will convert to maxTokens)
  top_p?: number;       // OpenAI style (will convert to topP)
  stream?: boolean;
  system?: string;      // Convenience for system prompt
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatCompletionMessage;
    finish_reason: 'stop' | 'length' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Streaming types
export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatCompletionMessage>;
    finish_reason: 'stop' | 'length' | 'content_filter' | null;
  }>;
}

// ============= OpenAI-style Image Types (SDK Interface) =============

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;           // OpenAI style (will convert to numImages)
  size?: '256x256' | '512x512' | '1024x1024' | '1024x1792' | '1792x1024' | string;
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  response_format?: 'url' | 'b64_json';  // OpenAI style (will convert to responseFormat)
}

export interface ImageGenerationResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

// ============= Insforge Backend Types (matches backend/src/types/ai.ts) =============

export interface InsforgeChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface InsforgeChatRequest {
  model: string;
  message?: string;
  messages?: InsforgeChatMessage[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;    // Backend uses camelCase
  topP?: number;          // Backend uses camelCase
  systemPrompt?: string;
}

// Backend response format from /api/ai/chat
export interface InsforgeChatResponse {
  success: boolean;
  response: string;
  model: string;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface InsforgeImageRequest {
  model: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  numImages?: number;     // Backend uses camelCase
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  responseFormat?: 'url' | 'b64_json';  // Backend uses camelCase
  size?: string;
}

// Backend response format from /api/ai/image/generation
export interface InsforgeImageResponse {
  model: string;
  images: Array<{
    url?: string;
    image_data?: string;
    revised_prompt?: string;
  }>;
  count: number;
  nextActions: string;
}

// ============= Streaming Types (SSE format from backend) =============

export interface StreamData {
  chunk?: string;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  done?: boolean;
  error?: string;
}