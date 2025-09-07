/**
 * AI Module for Insforge SDK
 * Wrapper for AI endpoints that follows OpenAI-like patterns
 * 
 * The backend handles all the complexity of different AI providers
 * and returns a unified format. This SDK just calls the endpoints.
 */

import { HttpClient } from '../lib/http-client';

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
   * Create a chat completion
   * 
   * @example
   * ```typescript
   * // Non-streaming
   * const response = await client.ai.chat.completions.create({
   *   model: 'gpt-4',
   *   messages: [{ role: 'user', content: 'Hello!' }]
   * });
   * console.log(response.response);
   * 
   * // Streaming - returns async iterable
   * const stream = await client.ai.chat.completions.create({
   *   model: 'gpt-4',
   *   messages: [{ role: 'user', content: 'Tell me a story' }],
   *   stream: true
   * });
   * 
   * for await (const event of stream) {
   *   if (event.chunk) {
   *     process.stdout.write(event.chunk);
   *   }
   *   if (event.done) {
   *     console.log('Stream complete!');
   *   }
   * }
   * ```
   */
  async create(params: {
    model: string;
    messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    message?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    systemPrompt?: string;
    stream?: boolean;
  }): Promise<any> {
    // For streaming, return an async iterable that yields parsed SSE events
    if (params.stream) {
      const headers = this.http.getHeaders();
      headers['Content-Type'] = 'application/json';
      
      const response = await this.http.fetch(
        `${this.http.baseUrl}/api/ai/chat/completion`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(params)
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Stream request failed');
      }

      // Return async iterable that parses SSE for the user
      return this.parseSSEStream(response);
    }

    // Non-streaming: use regular post method
    return this.http.post('/api/ai/chat/completion', params);
  }

  /**
   * Parse SSE stream into async iterable of parsed events
   * Users don't need to handle SSE parsing themselves
   */
  private async *parseSSEStream(response: Response): AsyncIterableIterator<any> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);
                yield data;
                
                // If we received the done signal, we can stop
                if (data.done) {
                  reader.releaseLock();
                  return;
                }
              } catch (e) {
                // Skip invalid JSON
                console.warn('Failed to parse SSE data:', dataStr);
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
   * Generate images
   * 
   * @example
   * ```typescript
   * const response = await client.ai.images.generate({
   *   model: 'dall-e-3',
   *   prompt: 'A sunset over mountains',
   *   numImages: 1,
   *   size: '1024x1024'
   * });
   * console.log(response.images[0].url);
   * ```
   */
  async generate(params: {
    model: string;
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    numImages?: number;
    quality?: 'standard' | 'hd';
    style?: 'vivid' | 'natural';
    responseFormat?: 'url' | 'b64_json';
    size?: string;
  }) {
    // Backend expects these exact field names
    return this.http.post('/api/ai/image/generation', params);
  }
}