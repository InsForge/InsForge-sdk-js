export {};

declare global {
  // Published by the auto-generated Deno router (main.ts) inside an
  // InsForge functions deployment. The SDK probes this to short-circuit
  // function-to-function calls in-process and avoid Deno Subhosting's
  // 508 Loop Detected. Undefined everywhere else (browser, external server).
  // eslint-disable-next-line no-var
  var __insforge_dispatch__:
    | ((req: Request) => Promise<Response>)
    | undefined;
}
