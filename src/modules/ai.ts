/**
 * AI Module for Insforge SDK
 * Response format roughly matches OpenAI SDK for compatibility
 *
 * The backend handles all the complexity of different AI providers
 * and returns a unified format. This SDK transforms responses to match OpenAI-like format.
 */

import { HttpClient } from "../lib/http-client";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
} from "@insforge/shared-schemas";

export class AI {
  public readonly chat: Chat;
  public readonly images: Images;
  public readonly embeddings: Embeddings;

  constructor(private http: HttpClient) {
    this.chat = new Chat(http);
    this.images = new Images(http);
    this.embeddings = new Embeddings(http);
  }
}

class Chat {
  public readonly completions: ChatCompletions;

  constructor(http: HttpClient) {
    this.completions = new ChatCompletions(http);
  }
}

class ChatCompletions {
  constructor(private http: HttpClient) {}

  /**
   * Create a chat completion - OpenAI-like response format
   *
   * @example
   * ```typescript
   * // Non-streaming
   * const completion = await client.ai.chat.completions.create({
   *   model: 'gpt-4',
   *   messages: [{ role: 'user', content: 'Hello!' }]
   * });
   * console.log(completion.choices[0].message.content);
   *
   * // With images (OpenAI-compatible format)
   * const response = await client.ai.chat.completions.create({
   *   model: 'gpt-4-vision',
   *   messages: [{
   *     role: 'user',
   *     content: [
   *       { type: 'text', text: 'What is in this image?' },
   *       { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
   *     ]
   *   }]
   * });
   *
   * // With PDF files
   * const pdfResponse = await client.ai.chat.completions.create({
   *   model: 'anthropic/claude-3.5-sonnet',
   *   messages: [{
   *     role: 'user',
   *     content: [
   *       { type: 'text', text: 'Summarize this document' },
   *       { type: 'file', file: { filename: 'doc.pdf', file_data: 'https://example.com/doc.pdf' } }
   *     ]
   *   }],
   *   fileParser: { enabled: true, pdf: { engine: 'mistral-ocr' } }
   * });
   *
   * // With web search
   * const searchResponse = await client.ai.chat.completions.create({
   *   model: 'openai/gpt-4',
   *   messages: [{ role: 'user', content: 'What are the latest news about AI?' }],
   *   webSearch: { enabled: true, maxResults: 5 }
   * });
   * // Access citations from response.choices[0].message.annotations
   *
   * // With thinking/reasoning mode (Anthropic models)
   * const thinkingResponse = await client.ai.chat.completions.create({
   *   model: 'anthropic/claude-3.5-sonnet',
   *   messages: [{ role: 'user', content: 'Solve this complex math problem...' }],
   *   thinking: true
   * });
   *
   * // Streaming - returns async iterable
   * const stream = await client.ai.chat.completions.create({
   *   model: 'gpt-4',
   *   messages: [{ role: 'user', content: 'Tell me a story' }],
   *   stream: true
   * });
   *
   * for await (const chunk of stream) {
   *   if (chunk.choices[0]?.delta?.content) {
   *     process.stdout.write(chunk.choices[0].delta.content);
   *   }
   * }
   * ```
   */
  async create(params: ChatCompletionRequest): Promise<any> {
    // Backend already expects camelCase, no transformation needed
    const backendParams = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      topP: params.topP,
      stream: params.stream,
      // New plugin options
      webSearch: params.webSearch,
      fileParser: params.fileParser,
      thinking: params.thinking,
    };

    // For streaming, return an async iterable that yields OpenAI-like chunks
    if (params.stream) {
      const headers = this.http.getHeaders();
      headers["Content-Type"] = "application/json";

      const response = await this.http.fetch(
        `${this.http.baseUrl}/api/ai/chat/completion`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(backendParams),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Stream request failed");
      }

      // Return async iterable that parses SSE and transforms to OpenAI-like format
      return this.parseSSEStream(response, params.model);
    }

    // Non-streaming: transform response to OpenAI-like format
    const response: ChatCompletionResponse = await this.http.post(
      "/api/ai/chat/completion",
      backendParams
    );

    // Transform to OpenAI-like format
    const content = response.text || "";

    return {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: response.metadata?.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
            // Include annotations if present (from web search or file parsing)
            ...(response.annotations && { annotations: response.annotations }),
          },
          finish_reason: "stop",
        },
      ],
      usage: response.metadata?.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  /**
   * Parse SSE stream into async iterable of OpenAI-like chunks
   */
  private async *parseSSEStream(
    response: Response,
    model: string
  ): AsyncIterableIterator<any> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);

                // Transform to OpenAI-like streaming format
                if (data.chunk || data.content) {
                  yield {
                    id: `chatcmpl-${Date.now()}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          content: data.chunk || data.content,
                        },
                        finish_reason: data.done ? "stop" : null,
                      },
                    ],
                  };
                }

                // If we received the done signal, we can stop
                if (data.done) {
                  reader.releaseLock();
                  return;
                }
              } catch (e) {
                // Skip invalid JSON
                console.warn("Failed to parse SSE data:", dataStr);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

class Embeddings {
  constructor(private http: HttpClient) {}

  /**
   * Create embeddings for text input - OpenAI-like response format
   *
   * @example
   * ```typescript
   * // Single text input
   * const response = await client.ai.embeddings.create({
   *   model: 'openai/text-embedding-3-small',
   *   input: 'Hello world'
   * });
   * console.log(response.data[0].embedding); // number[]
   *
   * // Multiple text inputs
   * const response = await client.ai.embeddings.create({
   *   model: 'openai/text-embedding-3-small',
   *   input: ['Hello world', 'Goodbye world']
   * });
   * response.data.forEach((item, i) => {
   *   console.log(`Embedding ${i}:`, item.embedding.slice(0, 5)); // First 5 dimensions
   * });
   *
   * // With custom dimensions (if supported by model)
   * const response = await client.ai.embeddings.create({
   *   model: 'openai/text-embedding-3-small',
   *   input: 'Hello world',
   *   dimensions: 256
   * });
   *
   * // With base64 encoding format
   * const response = await client.ai.embeddings.create({
   *   model: 'openai/text-embedding-3-small',
   *   input: 'Hello world',
   *   encoding_format: 'base64'
   * });
   * ```
   */
  async create(params: EmbeddingsRequest): Promise<any> {
    const response: EmbeddingsResponse = await this.http.post(
      "/api/ai/embeddings",
      params
    );

    // Return OpenAI-compatible format
    return {
      object: response.object,
      data: response.data,
      model: response.metadata?.model,
      usage: response.metadata?.usage
        ? {
            prompt_tokens: response.metadata.usage.promptTokens || 0,
            total_tokens: response.metadata.usage.totalTokens || 0,
          }
        : {
            prompt_tokens: 0,
            total_tokens: 0,
          },
    };
  }
}

class Images {
  constructor(private http: HttpClient) {}

  /**
   * Generate images - OpenAI-like response format
   *
   * @example
   * ```typescript
   * // Text-to-image
   * const response = await client.ai.images.generate({
   *   model: 'dall-e-3',
   *   prompt: 'A sunset over mountains',
   * });
   * console.log(response.images[0].url);
   *
   * // Image-to-image (with input images)
   * const response = await client.ai.images.generate({
   *   model: 'stable-diffusion-xl',
   *   prompt: 'Transform this into a watercolor painting',
   *   images: [
   *     { url: 'https://example.com/input.jpg' },
   *     // or base64-encoded Data URI:
   *     { url: 'data:image/jpeg;base64,/9j/4AAQ...' }
   *   ]
   * });
   * ```
   */
  async generate(params: ImageGenerationRequest): Promise<any> {
    const response: ImageGenerationResponse = await this.http.post(
      "/api/ai/image/generation",
      params
    );
    
    // Build data array based on response content
    let data: Array<{ b64_json?: string; content?: string }> = [];
    
    if (response.images && response.images.length > 0) {
      // Has images - extract base64 and include text
      data = response.images.map(img => ({
        b64_json: img.imageUrl.replace(/^data:image\/\w+;base64,/, ''),
        content: response.text
      }));
    } else if (response.text) {
      // Text-only response
      data = [{ content: response.text }];
    }
    
    // Return OpenAI-compatible format
    return {
      created: Math.floor(Date.now() / 1000),
      data,
      ...(response.metadata?.usage && {
        usage: {
          total_tokens: response.metadata.usage.totalTokens || 0,
          input_tokens: response.metadata.usage.promptTokens || 0,
          output_tokens: response.metadata.usage.completionTokens || 0,
        }
      })
    };
  }
}
