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
 * When a model is unavailable the API throws an error – those tests
 * catch only the request error and skip assertions rather than masking
 * assertion failures.
 */

const EMBEDDINGS_MODEL = 'openai/text-embedding-3-small';
const CHAT_MODEL = 'openai/gpt-4o-mini';
const IMAGE_MODEL = 'openai/dall-e-3';

/** Check if an error indicates the model is unavailable/disabled (not a real failure). */
function isModelUnavailable(err: any): boolean {
  const msg = (err?.message || '').toLowerCase();
  const code = err?.code || err?.error || '';
  return (
    code === 'model_not_found' ||
    msg.includes('not available') ||
    msg.includes('unavailable') ||
    msg.includes('disabled') ||
    msg.includes('not enabled') ||
    msg.includes('not found') ||
    msg.includes('not supported')
  );
}

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
      let response: any;
      try {
        response = await client.ai.embeddings.create({
          model: EMBEDDINGS_MODEL,
          input: 'Hello world',
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Embeddings model not available:', err.message);
        return;
      }

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
    });

    it('should create embeddings for multiple string inputs', async () => {
      let response: any;
      try {
        response = await client.ai.embeddings.create({
          model: EMBEDDINGS_MODEL,
          input: ['Hello world', 'Goodbye world', 'Testing embeddings'],
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Embeddings model not available:', err.message);
        return;
      }

      expect(response.object).toBe('list');
      expect(response.data).toHaveLength(3);
      expect(response.data[0].index).toBe(0);
      expect(response.data[1].index).toBe(1);
      expect(response.data[2].index).toBe(2);

      // All embeddings should have the same dimensions
      const dim = response.data[0].embedding.length;
      expect(response.data[1].embedding.length).toBe(dim);
      expect(response.data[2].embedding.length).toBe(dim);
    });

    it('should support custom dimensions parameter', async () => {
      let response: any;
      try {
        response = await client.ai.embeddings.create({
          model: EMBEDDINGS_MODEL,
          input: 'Test custom dimensions',
          dimensions: 256,
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Embeddings model not available:', err.message);
        return;
      }

      expect(response.data[0].embedding.length).toBe(256);
    });
  });

  // ================================================================
  // Chat Completions – non-streaming
  // ================================================================

  describe('chat.completions.create() – non-streaming', () => {
    it('should create a chat completion with standard response shape', async () => {
      let response: any;
      try {
        response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Chat model not available:', err.message);
        return;
      }

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
    });

    it('should support system messages', async () => {
      let response: any;
      try {
        response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: 'system', content: 'You are a calculator. Reply with only numbers.' },
            { role: 'user', content: 'What is 2 + 2?' },
          ],
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Chat model not available:', err.message);
        return;
      }

      expect(response.choices[0].message.content).toBeDefined();
    });

    it('should support multi-turn conversations', async () => {
      let response: any;
      try {
        response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: 'user', content: 'My name is SDK-Test.' },
            { role: 'assistant', content: 'Hello SDK-Test!' },
            { role: 'user', content: 'What did I say my name is? Reply in one word.' },
          ],
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Chat model not available:', err.message);
        return;
      }

      expect(response.choices[0].message.content).toBeDefined();
    });
  });

  // ================================================================
  // Chat Completions – streaming
  // ================================================================

  describe('chat.completions.create() – streaming', () => {
    it('should stream chunks and accumulate content', async () => {
      let stream: any;
      try {
        stream = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'Count from 1 to 5, separated by commas.' }],
          stream: true,
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Streaming not available:', err.message);
        return;
      }

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
      let response: any;
      try {
        response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
          tools: [weatherTool],
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Chat model not available:', err.message);
        return;
      }

      expect(response.choices).toHaveLength(1);
      const msg = response.choices[0].message;

      expect(msg.tool_calls).toBeDefined();
      expect(msg.tool_calls!.length).toBeGreaterThan(0);
      expect(msg.tool_calls![0].type).toBe('function');
      expect(msg.tool_calls![0].function.name).toBe('get_weather');
      expect(msg.tool_calls![0].id).toBeDefined();
      const args = JSON.parse(msg.tool_calls![0].function.arguments);
      expect(args.city).toBeDefined();
      expect(response.choices[0].finish_reason).toBe('tool_calls');
    });

    it('should respect toolChoice "none"', async () => {
      let response: any;
      try {
        response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
          tools: [weatherTool],
          toolChoice: 'none',
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Chat model not available:', err.message);
        return;
      }

      // With toolChoice none, the model should reply with text
      expect(response.choices[0].message.content).toBeDefined();
      expect(response.choices[0].finish_reason).toBe('stop');
    });
  });

  // ================================================================
  // Chat Completions – web search
  // ================================================================

  describe('chat.completions.create() – webSearch', () => {
    it('should support web search option', async () => {
      let response: any;
      try {
        response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'What is the population of Tokyo?' }],
          webSearch: { enabled: true, maxResults: 3 },
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Web search not available:', err.message);
        return;
      }

      expect(response.choices[0].message.content).toBeDefined();
      if (response.choices[0].message.annotations) {
        expect(Array.isArray(response.choices[0].message.annotations)).toBe(true);
      }
    });
  });

  // ================================================================
  // Images
  // ================================================================

  describe('images.generate()', () => {
    it('should generate an image or return structured error', async () => {
      let response: any;
      try {
        response = await client.ai.images.generate({
          model: IMAGE_MODEL,
          prompt: 'A simple blue circle on white background',
        });
      } catch (err: any) {
        if (!isModelUnavailable(err)) throw err;
        console.warn('Image generation not available:', err.message);
        return;
      }

      expect(response.created).toBeDefined();
      expect(response.data).toBeDefined();
      expect(response.data.length).toBeGreaterThan(0);

      const img = response.data[0];
      expect(img.b64_json || img.content).toBeDefined();
    }, 60000); // Image generation can be slow
  });
});
