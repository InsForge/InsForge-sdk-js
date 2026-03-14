import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should be disabled by default', () => {
      const logger = new Logger();
      expect(logger.enabled).toBe(false);
    });

    it('should be disabled when debug is false', () => {
      const logger = new Logger(false);
      expect(logger.enabled).toBe(false);
    });

    it('should be enabled when debug is true', () => {
      const logger = new Logger(true);
      expect(logger.enabled).toBe(true);
    });

    it('should be enabled when debug is a function', () => {
      const logger = new Logger(() => {});
      expect(logger.enabled).toBe(true);
    });
  });

  describe('log/warn/error', () => {
    it('should not output when disabled', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const logger = new Logger(false);
      logger.log('test');
      logger.warn('test');
      logger.error('test');

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should output to console when enabled', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const logger = new Logger(true);
      logger.log('hello world');

      expect(logSpy).toHaveBeenCalledOnce();
      expect(logSpy.mock.calls[0][0]).toContain('[InsForge Debug]');
      expect(logSpy.mock.calls[0][0]).toContain('hello world');
    });

    it('should use custom log function when provided', () => {
      const customFn = vi.fn();
      const logger = new Logger(customFn);

      logger.log('test message');

      expect(customFn).toHaveBeenCalledOnce();
      expect(customFn.mock.calls[0][0]).toContain('[InsForge Debug]');
      expect(customFn.mock.calls[0][0]).toContain('test message');
    });

    it('should route warn and error through custom function', () => {
      const customFn = vi.fn();
      const logger = new Logger(customFn);

      logger.warn('warn msg');
      logger.error('error msg');

      expect(customFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('logRequest', () => {
    it('should format request with method and URL', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger(true);

      logger.logRequest('GET', 'http://localhost:7130/api/test');

      expect(logSpy).toHaveBeenCalledOnce();
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('GET');
      expect(output).toContain('http://localhost:7130/api/test');
    });

    it('should redact Authorization header', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger(true);

      logger.logRequest('GET', 'http://localhost/api', {
        'Authorization': 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.secret',
        'Content-Type': 'application/json',
      });

      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('***REDACTED***');
      expect(output).not.toContain('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.secret');
      expect(output).toContain('application/json');
    });

    it('should include body when present', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger(true);

      logger.logRequest('POST', 'http://localhost/api', {}, JSON.stringify({ email: 'test@test.com' }));

      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('test@test.com');
    });

    it('should not output when disabled', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger(false);

      logger.logRequest('GET', 'http://localhost/api');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('logResponse', () => {
    it('should format response with status and duration', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger(true);

      logger.logResponse('GET', 'http://localhost/api', 200, 42, { ok: true });

      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('200');
      expect(output).toContain('42ms');
    });

    it('should use error level for 4xx/5xx responses', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = new Logger(true);

      logger.logResponse('POST', 'http://localhost/api', 401, 10, { error: 'Unauthorized' });

      expect(errorSpy).toHaveBeenCalledOnce();
      const output = errorSpy.mock.calls[0][0] as string;
      expect(output).toContain('401');
    });

    it('should truncate large response bodies', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger(true);

      const largeBody = 'x'.repeat(2000);
      logger.logResponse('GET', 'http://localhost/api', 200, 5, largeBody);

      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('[truncated]');
    });
  });
});
