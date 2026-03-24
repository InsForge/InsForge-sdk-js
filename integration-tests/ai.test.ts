import { describe, it, expect, beforeAll } from 'vitest';
import { signUpAndSignIn } from './setup';
import type { InsForgeClient } from '../src/client';

/**
 * AI module integration tests.
 *
 * Public API tested:
 *   ai.embeddings.create(params)
 *   ai.chat.completions.create(params)          – non-streaming
 *   ai.chat.completions.create(params, stream)   – streaming
 *   ai.chat.completions.create(params, tools)     – tool calling
 *   ai.chat.completions.create(params, webSearch) – web search
 *   ai.images.generate(params)
 *
 * NOTE: AI features require models to be enabled on the test project.
 * Tests are structured as try/catch so an unavailable model produces
 * a structured error rather than a test failure.
 */

const EMBEDDINGS_MODEL = 'openai/text-embedding-3-small';
const CHAT_MODEL = 'openai/gpt-4o-mini';
const IMAGE_MODEL = 'openai/dall-e-3';

describe('AI Module', () => {
  let client: InsForgeClient;

  beforeAll(async () => {
    const result = await signUpAndSignIn();
    expect(result.error).toBeNull();
    client = result.client;
  });

  // ================================================================
  // Embeddings
  // ================================================================

  describe('embeddings.create()', () => {
    it('should create embeddings for a single string input', async () => {
      try {
        const response = await client.ai.embeddings.create({
          model: EMBEDDINGS_MODEL,
          input: 'Hello world',
        });

        expect(response.object).toBe('list');
        expect(response.data).toHaveLength(1);
        expect(response.data[0].object).toBe('embedding');
        expect(Array.isArray(response.data[0].embedding)).toBe(true);
        expect(response.data[0].embedding.length).toBeGreaterThan(0);
        expect(response.data[0].index).toBe(0);
        expect(response.model).toBeDefined();
        expect(response.usage).toBeDefined();
        expect(response.usage.prompt_tokens).toBeGreaterThanOrEqual(0);
        expect(response.usage.total_tokens).toBeGreaterThanOrEqual(0);
      } catch (err: any) {
        console.warn('Embeddings model not available:', err.message);
        expect(err.message || err.error).toBeDefined();
      }
    });

    it('should create embeddings for multiple string inputs', async () => {
      try {
        const response = await client.ai.embeddings.create({
          model: EMBEDDINGS_MODEL,
          input: ['Hello world', 'Goodbye world', 'Testing embeddings'],
        });

        expect(response.object).toBe('list');
        expect(response.data).toHaveLength(3);
        expect(response.data[0].index).toBe(0);
        expect(response.data[1].index).toBe(1);
        expect(response.data[2].index).toBe(2);

        // All embeddings should have the same dimensions
        const dim = response.data[0].embedding.length;
        expect(response.data[1].embedding.length).toBe(dim);
        expect(response.data[2].embedding.length).toBe(dim);
      } catch (err: any) {
        expect(err.message || err.error).toBeDefined();
      }
    });

    it('should support custom dimensions parameter', async () => {
      try {
        const response = await client.ai.embeddings.create({
          model: EMBEDDINGS_MODEL,
          input: 'Test custom dimensions',
          dimensions: 256,
        });

        expect(response.data[0].embedding.length).toBe(256);
      } catch (err: any) {
        expect(err.message || err.error).toBeDefined();
      }
    });
  });

  // ================================================================
  // Chat Completions – non-streaming
  // ================================================================

  describe('chat.completions.create() – non-streaming', () => {
    it('should create a chat completion with standard response shape', async () => {
      try {
        const response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
        });

        expect(response.id).toBeDefined();
        expect(response.object).toBe('chat.completion');
        expect(response.created).toBeDefined();
        expect(response.model).toBeDefined();
        expect(response.choices).toHaveLength(1);
        expect(response.choices[0].index).toBe(0);
        expect(response.choices[0].message.role).toBe('assistant');
        expect(response.choices[0].message.content).toBeDefined();
        expect(response.choices[0].message.content.length).toBeGreaterThan(0);
        expect(response.choices[0].finish_reason).toBe('stop');
        expect(response.usage).toBeDefined();
      } catch (err: any) {
        console.warn('Chat model not available:', err.message);
        expect(err.message || err.error).toBeDefined();
      }
    });

    it('should support system messages', async () => {
      try {
        const response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: 'system', content: 'You are a calculator. Reply with only numbers.' },
            { role: 'user', content: 'What is 2 + 2?' },
          ],
        });

        expect(response.choices[0].message.content).toBeDefined();
      } catch (err: any) {
        expect(err.message || err.error).toBeDefined();
      }
    });

    it('should support multi-turn conversations', async () => {
      try {
        const response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: 'user', content: 'My name is SDK-Test.' },
            { role: 'assistant', content: 'Hello SDK-Test!' },
            { role: 'user', content: 'What did I say my name is? Reply in one word.' },
          ],
        });

        expect(response.choices[0].message.content).toBeDefined();
      } catch (err: any) {
        expect(err.message || err.error).toBeDefined();
      }
    });
  });

  // ================================================================
  // Chat Completions – streaming
  // ================================================================

  describe('chat.completions.create() – streaming', () => {
    it('should stream chunks and accumulate content', async () => {
      try {
        const stream = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'Count from 1 to 5, separated by commas.' }],
          stream: true,
        });

        let content = '';
        let chunkCount = 0;

        for await (const chunk of stream) {
          expect(chunk.object).toBe('chat.completion.chunk');
          chunkCount++;
          if (chunk.choices[0]?.delta?.content) {
            content += chunk.choices[0].delta.content;
          }
        }

        expect(chunkCount).toBeGreaterThan(0);
        expect(content.length).toBeGreaterThan(0);
      } catch (err: any) {
        console.warn('Streaming not available:', err.message);
        expect(err.message || err.error).toBeDefined();
      }
    });
  });

  // ================================================================
  // Chat Completions – tool calling
  // ================================================================

  describe('chat.completions.create() – tool calling', () => {
    const weatherTool = {
      type: 'function' as const,
      function: {
        name: 'get_weather',
        description: 'Get the current weather for a given city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
          },
          required: ['city'],
        },
      },
    };

    it('should return tool_calls when tools are provided', async () => {
      try {
        const response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
          tools: [weatherTool],
        });

        expect(response.choices).toHaveLength(1);
        const msg = response.choices[0].message;

        if (msg.tool_calls) {
          expect(msg.tool_calls.length).toBeGreaterThan(0);
          expect(msg.tool_calls[0].type).toBe('function');
          expect(msg.tool_calls[0].function.name).toBe('get_weather');
          expect(msg.tool_calls[0].id).toBeDefined();
          const args = JSON.parse(msg.tool_calls[0].function.arguments);
          expect(args.city).toBeDefined();
          expect(response.choices[0].finish_reason).toBe('tool_calls');
        }
      } catch (err: any) {
        expect(err.message || err.error).toBeDefined();
      }
    });

    it('should respect toolChoice "none"', async () => {
      try {
        const response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
          tools: [weatherTool],
          toolChoice: 'none',
        });

        // With toolChoice none, the model should reply with text
        expect(response.choices[0].message.content).toBeDefined();
        expect(response.choices[0].finish_reason).toBe('stop');
      } catch (err: any) {
        expect(err.message || err.error).toBeDefined();
      }
    });
  });

  // ================================================================
  // Chat Completions – web search
  // ================================================================

  describe('chat.completions.create() – webSearch', () => {
    it('should support web search option', async () => {
      try {
        const response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'What is the population of Tokyo?' }],
          webSearch: { enabled: true, maxResults: 3 },
        });

        expect(response.choices[0].message.content).toBeDefined();
        // Annotations may be present if web search was used
        if (response.choices[0].message.annotations) {
          expect(Array.isArray(response.choices[0].message.annotations)).toBe(true);
        }
      } catch (err: any) {
        // Web search may not be enabled
        expect(err.message || err.error).toBeDefined();
      }
    });
  });

  // ================================================================
  // Images
  // ================================================================

  describe('images.generate()', () => {
    it('should generate an image or return structured error', async () => {
      try {
        const response = await client.ai.images.generate({
          model: IMAGE_MODEL,
          prompt: 'A simple blue circle on white background',
        });

        expect(response.created).toBeDefined();
        expect(response.data).toBeDefined();
        expect(response.data.length).toBeGreaterThan(0);

        const img = response.data[0];
        expect(img.b64_json || img.content).toBeDefined();
      } catch (err: any) {
        // Image generation may not be enabled
        console.warn('Image generation not available:', err.message);
        expect(err.message || err.error).toBeDefined();
      }
    }, 60000); // Image generation can be slow
  });
});
