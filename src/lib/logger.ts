type LogFunction = (message: string, ...args: any[]) => void;

const SENSITIVE_HEADERS = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      redacted[key] = value.slice(0, 10) + '***REDACTED***';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function formatBody(body: any): string {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return '[FormData]';
  }
  return JSON.stringify(body, null, 2);
}

export class Logger {
  public enabled: boolean;
  private customLog: LogFunction | null;

  constructor(debug?: boolean | LogFunction) {
    if (typeof debug === 'function') {
      this.enabled = true;
      this.customLog = debug;
    } else {
      this.enabled = !!debug;
      this.customLog = null;
    }
  }

  log(message: string, ...args: any[]): void {
    if (!this.enabled) return;
    const formatted = `[InsForge Debug] ${message}`;
    if (this.customLog) {
      this.customLog(formatted, ...args);
    } else {
      console.log(formatted, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (!this.enabled) return;
    const formatted = `[InsForge Debug] ${message}`;
    if (this.customLog) {
      this.customLog(formatted, ...args);
    } else {
      console.warn(formatted, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (!this.enabled) return;
    const formatted = `[InsForge Debug] ${message}`;
    if (this.customLog) {
      this.customLog(formatted, ...args);
    } else {
      console.error(formatted, ...args);
    }
  }

  logRequest(
    method: string,
    url: string,
    headers?: Record<string, string>,
    body?: any
  ): void {
    if (!this.enabled) return;
    const parts: string[] = [
      `→ ${method} ${url}`,
    ];
    if (headers && Object.keys(headers).length > 0) {
      parts.push(`  Headers: ${JSON.stringify(redactHeaders(headers))}`);
    }
    const formattedBody = formatBody(body);
    if (formattedBody) {
      parts.push(`  Body: ${formattedBody}`);
    }
    this.log(parts.join('\n'));
  }

  logResponse(
    method: string,
    url: string,
    status: number,
    durationMs: number,
    body?: any
  ): void {
    if (!this.enabled) return;
    const parts: string[] = [
      `← ${method} ${url} ${status} (${durationMs}ms)`,
    ];
    const formattedBody = formatBody(body);
    if (formattedBody) {
      const truncated = formattedBody.length > 1000
        ? formattedBody.slice(0, 1000) + '... [truncated]'
        : formattedBody;
      parts.push(`  Body: ${truncated}`);
    }
    if (status >= 400) {
      this.error(parts.join('\n'));
    } else {
      this.log(parts.join('\n'));
    }
  }
}
