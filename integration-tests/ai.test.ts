import { describe, it, expect, beforeAll } from "vitest";
import { InsForgeClient } from "../src/client";

// Test configuration - connect to local server
const TEST_CONFIG = {
  baseUrl: "http://localhost:7130",
  anonKey: "your_anon_key_here",
};

describe("AI Module - Integration Tests", () => {
  let client: InsForgeClient;

  beforeAll(() => {
    client = new InsForgeClient(TEST_CONFIG);
  });

  describe("Embeddings", () => {
    describe.skip("create", () => {
      it("should create embeddings for single text input", async () => {
        const response = await client.ai.embeddings.create({
          model: "openai/text-embedding-3-small",
          input: "Hello world",
        });

        // Verify response format
        expect(response.object).toBe("list");
        expect(response.data).toHaveLength(1);
        expect(response.data[0].object).toBe("embedding");
        expect(Array.isArray(response.data[0].embedding)).toBe(true);
        expect(response.data[0].embedding.length).toBeGreaterThan(0);
        expect(response.data[0].index).toBe(0);
        expect(response.model).toBeDefined();
        expect(response.usage).toBeDefined();
        expect(response.usage.prompt_tokens).toBeGreaterThanOrEqual(0);
        expect(response.usage.total_tokens).toBeGreaterThanOrEqual(0);

        console.log("Single input embedding dimensions:", response.data[0].embedding.length);
        console.log("Model used:", response.model);
        console.log("Token usage:", response.usage);
      });

      it("should create embeddings for multiple text inputs", async () => {
        const response = await client.ai.embeddings.create({
          model: "openai/text-embedding-3-small",
          input: ["Hello world", "Goodbye world"],
        });

        // Verify response format
        expect(response.object).toBe("list");
        expect(response.data).toHaveLength(2);

        // First embedding
        expect(response.data[0].object).toBe("embedding");
        expect(Array.isArray(response.data[0].embedding)).toBe(true);
        expect(response.data[0].index).toBe(0);

        // Second embedding
        expect(response.data[1].object).toBe("embedding");
        expect(Array.isArray(response.data[1].embedding)).toBe(true);
        expect(response.data[1].index).toBe(1);

        // Both should have same dimensions
        expect(response.data[0].embedding.length).toBe(response.data[1].embedding.length);

        console.log("Multiple inputs - embedding count:", response.data.length);
        console.log("Embedding dimensions:", response.data[0].embedding.length);
      });

      it("should support custom dimensions parameter", async () => {
        const customDimensions = 256;

        const response = await client.ai.embeddings.create({
          model: "openai/text-embedding-3-small",
          input: "Hello world",
          dimensions: customDimensions,
        });

        // Verify embedding has requested dimensions
        expect(response.data[0].embedding.length).toBe(customDimensions);

        console.log("Custom dimensions requested:", customDimensions);
        console.log("Actual dimensions returned:", response.data[0].embedding.length);
      });

      it("should work with different embedding models", async () => {
        // Test with a different model (if available)
        const response = await client.ai.embeddings.create({
          model: "openai/text-embedding-3-large",
          input: "Test embedding with large model",
        });

        expect(response.object).toBe("list");
        expect(response.data).toHaveLength(1);
        expect(Array.isArray(response.data[0].embedding)).toBe(true);

        console.log("Large model embedding dimensions:", response.data[0].embedding.length);
      });
    });
  });

  // Note: ChatCompletions and Images tests are skipped by default
  // because they require specific models to be enabled on the server.
  // Uncomment and configure the model names to run these tests.

  describe("ChatCompletions", () => {
    // Skip these tests if models are not enabled on your server
    // Change the model names to match your server configuration
    const CHAT_MODEL = "openai/gpt-4o"; // Change this to an enabled model
    const THINKING_MODEL = "anthropic/claude-sonnet-4"; // Change this to an enabled Anthropic model

    describe.skip("create with basic request", () => {
      it("should create a chat completion", async () => {
        const response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: "user", content: "Say hello in one word" }],
        });

        expect(response.object).toBe("chat.completion");
        expect(response.choices).toHaveLength(1);
        expect(response.choices[0].message.role).toBe("assistant");
        expect(response.choices[0].message.content).toBeDefined();
        expect(response.choices[0].finish_reason).toBe("stop");

        console.log("Chat response:", response.choices[0].message.content);
      });
    });

    describe.skip("create with webSearch", () => {
      it("should perform web search and return annotations", async () => {
        const response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: "user", content: "What is the current weather in Beijing today?" },
          ],
          webSearch: { enabled: true, maxResults: 3 },
        });

        expect(response.choices[0].message.content).toBeDefined();

        // Web search should include annotations with citations
        if (response.choices[0].message.annotations) {
          console.log("Web search annotations count:", response.choices[0].message.annotations.length);
          response.choices[0].message.annotations.forEach((annotation: any, i: number) => {
            if (annotation.type === "url_citation") {
              console.log(`Citation ${i + 1}:`, annotation.urlCitation?.url);
            }
          });
        }

        console.log("Web search response:", response.choices[0].message.content.substring(0, 200) + "...");
      });
    });

    describe.skip("create with thinking mode", () => {
      it("should use thinking/reasoning mode", async () => {
        const response = await client.ai.chat.completions.create({
          model: THINKING_MODEL,
          messages: [
            { role: "user", content: "What is 15 * 17? Show your reasoning." },
          ],
          thinking: true,
        });

        expect(response.choices[0].message.content).toBeDefined();
        // The response should contain the calculation result (255)
        expect(response.choices[0].message.content).toContain("255");

        console.log("Thinking mode response:", response.choices[0].message.content);
      });
    });

    describe.skip("create with fileParser (PDF)", () => {
      const PDF_URL = "https://pdfco-test-files.s3.us-west-2.amazonaws.com/pdf-to-csv/sample.pdf";

      it("should parse PDF and summarize content using pdf-text engine", async () => {
        const response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Please summarize the content of this PDF document." },
                {
                  type: "file",
                  file: {
                    filename: "sample.pdf",
                    file_data: PDF_URL,
                  },
                },
              ],
            },
          ],
          fileParser: {
            enabled: true,
            pdf: {
              engine: "pdf-text",
            },
          },
        });

        expect(response.object).toBe("chat.completion");
        expect(response.choices).toHaveLength(1);
        expect(response.choices[0].message.content).toBeDefined();
        expect(response.choices[0].message.content.length).toBeGreaterThan(0);

        console.log("PDF summary response:", response.choices[0].message.content);
      }, 30000); // 30 second timeout for PDF processing

      it("should parse PDF using mistral-ocr engine", async () => {
        const response = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "What information can you extract from this PDF?" },
                {
                  type: "file",
                  file: {
                    filename: "sample.pdf",
                    file_data: PDF_URL,
                  },
                },
              ],
            },
          ],
          fileParser: {
            enabled: true,
            pdf: {
              engine: "mistral-ocr",
            },
          },
        });

        expect(response.object).toBe("chat.completion");
        expect(response.choices[0].message.content).toBeDefined();

        console.log("PDF OCR response:", response.choices[0].message.content);
      }, 60000); // 60 second timeout for OCR processing
    });

    describe.skip("create with streaming", () => {
      it("should stream chat completion chunks", async () => {
        const stream = await client.ai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [{ role: "user", content: "Count from 1 to 5" }],
          stream: true,
        });

        let fullContent = "";
        let chunkCount = 0;

        for await (const chunk of stream) {
          chunkCount++;
          if (chunk.choices[0]?.delta?.content) {
            fullContent += chunk.choices[0].delta.content;
          }
        }

        expect(chunkCount).toBeGreaterThan(0);
        expect(fullContent).toBeDefined();
        expect(fullContent.length).toBeGreaterThan(0);

        console.log("Stream chunks received:", chunkCount);
        console.log("Full streamed content:", fullContent);
      });
    });
  });

  describe("Images", () => {
    const IMAGE_MODEL = "openai/dall-e-3"; // Change this to an enabled image model

    describe.skip("generate", () => {
      it("should generate an image from text prompt", async () => {
        const response = await client.ai.images.generate({
          model: IMAGE_MODEL,
          prompt: "A simple red circle on white background",
        });

        expect(response.created).toBeDefined();
        expect(response.data).toBeDefined();
        expect(response.data.length).toBeGreaterThan(0);

        // Check if we got image data (b64_json) or URL
        const firstImage = response.data[0];
        expect(firstImage.b64_json || firstImage.content).toBeDefined();

        console.log("Image generated successfully");
        if (firstImage.b64_json) {
          console.log("Image data (base64) length:", firstImage.b64_json.length);
        }
      }, 60000); // 60 second timeout for image generation
    });
  });
});
