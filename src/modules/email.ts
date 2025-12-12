import { HttpClient } from '../lib/http-client';
import type { SendRawEmailRequest, SendEmailResponse } from '@insforge/shared-schemas';

export type { SendRawEmailRequest as SendEmailOptions, SendEmailResponse } from '@insforge/shared-schemas';

/**
 * Emails client for sending custom emails
 *
 * @example
 * ```typescript
 * // Send a simple email
 * const { error } = await client.emails.send({
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   html: '<h1>Welcome to our platform</h1>'
 * });
 *
 * if (error) {
 *   console.error('Failed to send:', error.message);
 *   return;
 * }
 * // Email sent successfully
 *
 * // Send to multiple recipients with CC
 * const { error: err } = await client.emails.send({
 *   to: ['user1@example.com', 'user2@example.com'],
 *   cc: 'manager@example.com',
 *   subject: 'Team Update',
 *   html: '<p>Here is the latest update...</p>',
 *   replyTo: 'support@example.com'
 * });
 * ```
 */
export class Emails {
  private http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /**
   * Send a custom HTML email
   * @param options Email options including recipients, subject, and HTML content
   */
  async send(
    options: SendRawEmailRequest
  ): Promise<{ data: SendEmailResponse | null; error: Error | null }> {
    try {
      const data = await this.http.post<SendEmailResponse>(
        '/api/email/send-raw',
        options
      );

      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  }
}
