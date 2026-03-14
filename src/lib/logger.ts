type LogFunction = (message: string, ...args: any[]) => void;

const SENSITIVE_HEADERS = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];

const SENSITIVE_BODY_KEYS = [
  'password', 'token', 'accesstoken', 'refreshtoken',
  'authorization', 'secret', 'apikey', 'api_key',
  'email', 'ssn', 'creditcard', 'credit_card',
];

/**
 * Replaces values of sensitive headers with a redaction mask.
 * @param headers - The headers object to redact
 * @returns A new headers object with sensitive values masked
 */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      redacted[key] = '***REDACTED***';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Recursively masks sensitive keys (e.g. password, token, email) in request/response bodies.
 * Handles objects, arrays, and JSON strings.
 * @param body - The body payload to sanitize
 * @returns A sanitized copy of the body with sensitive values masked
 */
function sanitizeBody(body: any): any {
  if (body === null || body === undefined) return body;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return sanitizeBody(parsed);
    } catch {
      return body;
    }
  }
  if (Array.isArray(body)) return body.map(sanitizeBody);
  if (typeof body === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      if (SENSITIVE_BODY_KEYS.includes(key.toLowerCase().replace(/[-_]/g, ''))) {
        sanitized[key] = '***REDACTED***';
      } else {
        sanitized[key] = sanitizeBody(value);
      }
    }
    return sanitized;
  }
  return body;
}

/**
 * Formats a body payload as a pretty-printed JSON string for debug output.
 * Safely handles circular references and FormData.
 * @param body - The body to format
 * @returns A formatted string representation of the body, or empty string if null/undefined
 */
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
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return '[Unserializable body]';
  }
}

/**
 * Debug logger for the InsForge SDK.
 * Logs HTTP request/response details with automatic redaction of sensitive data.
 *
 * @example
 * ```typescript
 * // Enable via SDK config
 * const client = new InsForgeClient({ debug: true });
 *
 * // Or with a custom log function
 * const client = new InsForgeClient({
 *   debug: (msg) => myLogger.info(msg)
 * });
 * ```
 */
export class Logger {
  /** Whether debug logging is currently enabled */
  public enabled: boolean;
  private customLog: LogFunction | null;

  /**
   * Creates a new Logger instance.
   * @param debug - Set to true to enable console logging, or pass a custom log function
   */
  constructor(debug?: boolean | LogFunction) {
    if (typeof debug === 'function') {
      this.enabled = true;
      this.customLog = debug;
    } else {
      this.enabled = !!debug;
      this.customLog = null;
    }
  }

  /**
   * Logs a debug message at the info level.
   * @param message - The message to log
   * @param args - Additional arguments to pass to the log function
   */
  log(message: string, ...args: any[]): void {
    if (!this.enabled) return;
    const formatted = `[InsForge Debug] ${message}`;
    if (this.customLog) {
      this.customLog(formatted, ...args);
    } else {
      console.log(formatted, ...args);
    }
  }

  /**
   * Logs a debug message at the warning level.
   * @param message - The message to log
   * @param args - Additional arguments to pass to the log function
   */
  warn(message: string, ...args: any[]): void {
    if (!this.enabled) return;
    const formatted = `[InsForge Debug] ${message}`;
    if (this.customLog) {
      this.customLog(formatted, ...args);
    } else {
      console.warn(formatted, ...args);
    }
  }

  /**
   * Logs a debug message at the error level.
   * @param message - The message to log
   * @param args - Additional arguments to pass to the log function
   */
  error(message: string, ...args: any[]): void {
    if (!this.enabled) return;
    const formatted = `[InsForge Debug] ${message}`;
    if (this.customLog) {
      this.customLog(formatted, ...args);
    } else {
      console.error(formatted, ...args);
    }
  }

  /**
   * Logs an outgoing HTTP request with method, URL, headers, and body.
   * Sensitive headers and body fields are automatically redacted.
   * @param method - HTTP method (GET, POST, etc.)
   * @param url - The full request URL
   * @param headers - Request headers (sensitive values will be redacted)
   * @param body - Request body (sensitive fields will be masked)
   */
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
    const formattedBody = formatBody(sanitizeBody(body));
    if (formattedBody) {
      const truncated = formattedBody.length > 1000
        ? formattedBody.slice(0, 1000) + '... [truncated]'
        : formattedBody;
      parts.push(`  Body: ${truncated}`);
    }
    this.log(parts.join('\n'));
  }

  /**
   * Logs an incoming HTTP response with method, URL, status, duration, and body.
   * Error responses (4xx/5xx) are logged at the error level.
   * @param method - HTTP method (GET, POST, etc.)
   * @param url - The full request URL
   * @param status - HTTP response status code
   * @param durationMs - Request duration in milliseconds
   * @param body - Response body (sensitive fields will be masked, large bodies truncated)
   */
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
    const formattedBody = formatBody(sanitizeBody(body));
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
