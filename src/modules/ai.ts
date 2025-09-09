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
} from "@insforge/shared-schemas";

export class AI {
  public readonly chat: Chat;
  public readonly images: Images;

  constructor(private http: HttpClient) {
    this.chat = new Chat(http);
    this.images = new Images(http);
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
   * // With images
   * const response = await client.ai.chat.completions.create({
   *   model: 'gpt-4-vision',
   *   messages: [{
   *     role: 'user',
   *     content: 'What is in this image?',
   *     images: [{ url: 'https://example.com/image.jpg' }]
   *   }]
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
  async generate(params: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const response: ImageGenerationResponse = await this.http.post(
      "/api/ai/image/generation",
      params
    );

    return response;
  }
}
