# InsForge SDK Reference

## Install

```bash
npm install @insforge/sdk
```

## Initialize

```javascript
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'http://localhost:7130',
  anonKey: 'your-anon-key',
});
```

`createClient()` is for public and user-scoped clients. Use `createAdminClient()` for project-admin API keys.

## Admin Client

```typescript
import { createAdminClient } from '@insforge/sdk';

const admin = createAdminClient({
  baseUrl: 'http://localhost:7130',
  apiKey: process.env.INSFORGE_API_KEY!,
});
```

Use this only in trusted server code. The admin client sends `apiKey` as the bearer token for every request.

## SSR Auth Mode

Use `@insforge/sdk/ssr` for Next.js/SSR. The helpers keep the refresh token server-owned while still making the short-lived access token available to browser-only SDK surfaces such as Storage and Realtime.

Default env resolution:

- Browser and server: `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`

Explicit `baseUrl` / `anonKey` values win. Missing SSR config throws a clear error.

Default cookies:

- `insforge_access_token`: `httpOnly: false`, `sameSite: "lax"`, `path: "/"`, expires at the JWT `exp`
- `insforge_refresh_token`: `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, expires at the JWT `exp`

### `createBrowserClient()`

```typescript
import { createBrowserClient } from '@insforge/sdk/ssr';

const insforge = createBrowserClient({
  refreshUrl: '/api/auth/refresh', // default
});
```

The browser client reads the access-token cookie, uses it for Database, Storage, Functions, and Realtime, and calls the refresh route when the access token is missing or near expiry.

The browser client consumes an existing SSR session. Its TypeScript surface does
not include auth mutations such as `signInWithPassword()`, `signUp()`, or
`signOut()`.

### `createServerClient()`

```typescript
import { cookies } from 'next/headers';
import { createServerClient } from '@insforge/sdk/ssr';

const insforge = createServerClient({
  cookies: await cookies(),
});
```

The server client reads only the access-token cookie and passes it as the per-request bearer token.

### `createRefreshAuthRouter()`

```typescript
// app/api/auth/refresh/route.ts
import { createRefreshAuthRouter } from '@insforge/sdk/ssr';

export const { POST } = createRefreshAuthRouter();
```

For server-owned refresh cookies, sign-in, sign-up, and sign-out should run
through a Server Action or Route Handler that can set cookies. Do not return
raw auth responses from Server Actions; return only the user or app-specific
safe fields.

```typescript
// app/actions.ts
'use server';

import { cookies } from 'next/headers';
import { createAuthActions } from '@insforge/sdk/ssr';

export async function signIn(formData: FormData) {
  const auth = createAuthActions({ cookies: await cookies() });

  const { data, error } = await auth.signInWithPassword({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
  });

  return { user: data?.user ?? null, error };
}
```

In Route Handlers, pass `requestCookies` and `responseCookies` to the same
helper when request and response cookie stores are separate.

For OAuth, initiate and exchange on the server. Use
`createAuthActions().signInWithOAuth(provider, { redirectTo, skipBrowserRedirect: true })`
in a Server Action, store the returned `codeVerifier` in an httpOnly app cookie,
redirect to `data.url`, then call `createAuthActions().exchangeOAuthCode(code,
codeVerifier)` from the callback Route Handler. SSR browser clients do not
auto-exchange OAuth callbacks.

Use `refreshAuth()` directly when the route needs app-specific logic:

```typescript
import { refreshAuth } from '@insforge/sdk/ssr';

export async function POST(request: Request) {
  await beforeRefresh(request);
  const result = await refreshAuth({ request });
  await afterRefresh(result);
  return result.response;
}
```

### `updateSession()`

Import `updateSession()` from `@insforge/sdk/ssr/middleware` in Proxy/Middleware
files. This subpath only includes the session refresh helpers and avoids
bundling the full SDK client.

```typescript
// proxy.ts on Next.js 16+, middleware.ts on Next.js 15 and earlier
import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@insforge/sdk/ssr/middleware';

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  await updateSession({
    requestCookies: request.cookies,
    responseCookies: response.cookies,
  });

  return response;
}
```

## OAuth Auto-Detection (Browser)

The SDK automatically detects and handles OAuth callback parameters when initialized. This feature works seamlessly with the InsForge backend OAuth flow.

**How it works:**

1. User calls `signInWithOAuth()` and is redirected to OAuth provider
2. After authentication, InsForge redirects back to your app with an `insforge_code` in the URL
3. SDK automatically exchanges that code for a session on initialization
4. Session is saved and the URL is cleaned - no manual handling needed

**Example:**

```javascript
// Just initialize the client - OAuth is handled automatically
const insforge = createClient({
  baseUrl: 'http://localhost:7130',
});

// If the URL contains OAuth callback parameters like:
// ?insforge_code=...
// The SDK will:
// - Exchange the code for a session
// - Save the session in memory
// - Set the auth token for API calls
// - Clean the URL

// You can then immediately use authenticated methods:
const { data } = await insforge.auth.getCurrentUser();
```

## Auth Methods

### `signUp()`

```javascript
await insforge.auth.signUp({
  email: 'user@example.com',
  password: 'password123',
  name: 'John Doe', // optional
  redirectTo: 'http://localhost:3000/sign-in', // optional, recommended for link-based verification
});
// Response: { data: { user, accessToken }, error }
// user: { id, email, name, emailVerified, createdAt, updatedAt }
// accessToken: JWT token string
```

If the backend uses link-based email verification, the emailed link opens:

```text
GET /api/auth/email/verify-link?token=...
```

InsForge validates the token first, then redirects the browser to your `redirectTo` URL.
Recommended: use your sign-in page as `redirectTo`, then show a success message and ask the user to sign in with email and password.

### `signInWithPassword()`

```javascript
await insforge.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123',
});
// Response: { data: { user, accessToken }, error }
// user: { id, email, name, emailVerified, createdAt, updatedAt }
// accessToken: JWT token string
```

### `signInWithOAuth()`

```javascript
await insforge.auth.signInWithOAuth('google', {
  redirectTo: 'http://localhost:3000/dashboard',
  additionalParams: { prompt: 'select_account' }, // optional provider-specific OAuth params
  skipBrowserRedirect: true, // optional, returns URL instead of redirecting
});
// Response: { data: { url, provider }, error }
// Auto-redirects in browser unless skipBrowserRedirect: true
// additionalParams is for provider-specific hints only. Do not pass client_id, scope,
// redirect_uri, code_challenge, state, or response_type; InsForge sets those server-side
// and ignores colliding client-provided keys.

// AUTOMATIC OAuth Callback Detection (v0.0.14+):
// When users are redirected back from OAuth provider, the SDK automatically:
// 1. Detects insforge_code in the URL
// 2. Exchanges the code for a session
// 3. Saves the session in memory
// 4. Cleans the URL
// No manual handling needed - just initialize the client!
```

### `signOut()`

```javascript
await insforge.auth.signOut();
// Response: { error }
// Clears stored tokens
```

### `getCurrentUser()`

```javascript
await insforge.auth.getCurrentUser();
// Response: { data: { user }, error }
// user: { id, email, emailVerified, providers, createdAt, updatedAt, profile, metadata }
// Returns null if not authenticated
```

For browser apps, call `getCurrentUser()` during startup. The SDK will use the httpOnly refresh cookie automatically when it can refresh the session.

For SSR apps, use `@insforge/sdk/ssr`.

### `getProfile()`

```javascript
await insforge.auth.getProfile(userId);
// Response: { data: profile, error }
// profile: { id, nickname, avatar_url, bio, birthday, ... }
// Gets any user's profile from users table
```

### `setProfile()`

```javascript
await insforge.auth.setProfile({
  nickname: 'JohnDoe',
  avatar_url: 'https://...',
  bio: 'Software developer',
  birthday: '1990-01-01',
});
// Response: { data: profile, error }
// Updates current user's profile in users table
```

### `getPublicAuthConfig()`

```javascript
await insforge.auth.getPublicAuthConfig();
// Response: { data: GetPublicAuthConfigResponse, error }
// data: both OAuth providers and email authentication settings in one request
// This is a public endpoint that doesn't require authentication
```

### `resendVerificationEmail()`

```javascript
await insforge.auth.resendVerificationEmail({
  email: 'user@example.com',
  redirectTo: 'http://localhost:3000/sign-in', // optional, recommended for link-based verification
});
// Response: { data: { success, message }, error }
```

### `verifyEmail()`

```javascript
await insforge.auth.verifyEmail({
  email: 'user@example.com',
  otp: '123456',
});
// Response: { data: { user, accessToken, csrfToken?, refreshToken? }, error }
// POST /api/auth/email/verify is code-only
// Browser link verification uses GET /api/auth/email/verify-link
// Verification redirect params:
// - insforge_status=success|error
// - insforge_type=verify_email
// - insforge_error (only on error)
```

### `sendResetPasswordEmail()`

```javascript
await insforge.auth.sendResetPasswordEmail({
  email: 'user@example.com',
  redirectTo: 'http://localhost:3000/reset-password', // optional, recommended for link-based reset
});
// Response: { data: { success, message }, error }
```

### `exchangeResetPasswordToken()`

```javascript
await insforge.auth.exchangeResetPasswordToken({
  email: 'user@example.com',
  code: '123456',
});
// Response: { data: { token, expiresAt }, error }
```

### `resetPassword()`

```javascript
await insforge.auth.resetPassword({
  newPassword: 'newSecurePassword123',
  otp: 'reset-token',
});
// Response: { data: { message }, error }
// Browser reset links use GET /api/auth/email/reset-password-link first,
// then your app submits the new password with POST /api/auth/email/reset-password.
// Reset redirect params:
// - token (present only when ready)
// - insforge_status=ready|error
// - insforge_type=reset_password
// - insforge_error (only on error)
```

## Error Handling

### Auth/Storage/AI Errors (InsForgeError)

```javascript
{
  error: {
    statusCode: 401,
    error: 'INVALID_CREDENTIALS',
    message: 'Invalid login credentials',
    nextActions: 'Check email and password'
  }
}
```

### Database Errors (PostgrestError)

```javascript
{
  error: {
    code: 'PGRST116',  // PostgreSQL/PostgREST error code
    message: 'JSON object requested, multiple (or no) rows returned',
    details: 'The result contains 5 rows',
    hint: null
  }
}
```

## Auth Session Storage

- **Browser**: in-memory (per client instance)
- **Node.js**: in-memory (per request/client instance)

## Payments Methods

Payments methods are provider-scoped and intended for generated app frontends. They call runtime-safe backend routes using the current user token or anon key. Admin-only key, catalog, sync, transaction, and webhook configuration APIs are intentionally not exposed through this frontend SDK surface.

### `stripe.createCheckoutSession()`

```javascript
const { data, error } = await insforge.payments.stripe.createCheckoutSession('test', {
  mode: 'payment',
  lineItems: [{ priceId: 'price_123', quantity: 1 }],
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/pricing',
  idempotencyKey: 'cart_123', // optional, recommended for retry-safe checkout creation
});

if (!error && data?.checkoutSession.url) {
  window.location.assign(data.checkoutSession.url);
}
```

For one-time payments, `subject` is optional. For subscription checkout, `subject` is required because subscriptions represent ongoing entitlement for an app-defined billing owner.

```javascript
await insforge.payments.stripe.createCheckoutSession('test', {
  mode: 'subscription',
  subject: { type: 'team', id: 'team_123' },
  lineItems: [{ priceId: 'price_monthly_123', quantity: 1 }],
  successUrl: 'https://example.com/billing/success',
  cancelUrl: 'https://example.com/billing',
});
```

### `stripe.createCustomerPortalSession()`

```javascript
const { data, error } = await insforge.payments.stripe.createCustomerPortalSession('test', {
  subject: { type: 'team', id: 'team_123' },
  returnUrl: 'https://example.com/billing',
});

if (!error && data?.customerPortalSession.url) {
  window.location.assign(data.customerPortalSession.url);
}
```

Customer portal sessions require an authenticated user and an existing Stripe customer mapping for the billing subject.

### `razorpay.createOrder()`

Razorpay uses Checkout.js instead of a hosted redirect URL. Create an order through InsForge, pass `checkoutOptions` into Razorpay Checkout.js, then verify the signed payment response.

```javascript
const { data, error } = await insforge.payments.razorpay.createOrder('test', {
  amount: 200000,
  currency: 'INR',
  receipt: 'cart_123',
  subject: { type: 'team', id: 'team_123' },
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
});

if (!error && data) {
  const checkout = new Razorpay({
    ...data.checkoutOptions,
    handler: async (response) => {
      await insforge.payments.razorpay.verifyOrder('test', {
        orderId: response.razorpay_order_id,
        paymentId: response.razorpay_payment_id,
        signature: response.razorpay_signature,
      });
    },
  });

  checkout.open();
}
```

### `razorpay.createSubscription()`

```javascript
const { data, error } = await insforge.payments.razorpay.createSubscription('test', {
  planId: 'plan_123',
  totalCount: 12,
  subject: { type: 'team', id: 'team_123' },
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
});

if (!error && data) {
  const checkout = new Razorpay({
    ...data.checkoutOptions,
    handler: async (response) => {
      await insforge.payments.razorpay.verifySubscription('test', {
        subscriptionId: response.razorpay_subscription_id,
        paymentId: response.razorpay_payment_id,
        signature: response.razorpay_signature,
      });
    },
  });

  checkout.open();
}
```

### `razorpay.cancelSubscription()`

```javascript
await insforge.payments.razorpay.cancelSubscription('test', 'sub_123', {
  cancelAtCycleEnd: false,
});
```

### `razorpay.pauseSubscription()` / `razorpay.resumeSubscription()`

```javascript
await insforge.payments.razorpay.pauseSubscription('test', 'sub_123');
await insforge.payments.razorpay.resumeSubscription('test', 'sub_123');
```

Razorpay webhook setup is manual in the Razorpay dashboard. Configure keys and copy the webhook URL, secret, and recommended events from the InsForge payments settings UI.

## Database Methods

**Note:** Database operations use [@supabase/postgrest-js](https://github.com/supabase/postgrest-js) under the hood, providing full PostgREST compatibility including advanced features like OR conditions, complex joins, and aggregations.

### `from()`

Create a query builder for a table:

```javascript
const query = insforge.database.from('posts');
// Returns a PostgREST query builder with all Supabase features
```

### SELECT Operations

```javascript
// Basic select
await insforge.database.from('posts').select(); // Default: '*'

// Select specific columns
await insforge.database.from('posts').select('id, title, created_at');

// With filters
await insforge.database
  .from('posts')
  .select()
  .eq('user_id', '123')
  .order('created_at', { ascending: false })
  .limit(10);

// With joins (PostgREST syntax)
await insforge.database.from('posts').select('*, users!inner(*)'); // Inner join with users table

// Join with specific columns
await insforge.database.from('posts').select('id, title, users(nickname, avatar_url)');

// Aliased joins
await insforge.database.from('posts').select('*, author:users(*)'); // Alias users as author
// Response: { data: [...], error }
```

### INSERT Operations

```javascript
// Single record - use .select() to return inserted data
await insforge.database.from('posts').insert({ title: 'Hello', content: 'World' }).select();

// Multiple records
await insforge.database
  .from('posts')
  .insert([
    { title: 'Post 1', content: 'Content 1' },
    { title: 'Post 2', content: 'Content 2' },
  ])
  .select();

// Upsert
await insforge.database.from('posts').upsert({ id: '123', title: 'Updated or New' }).select();
// Response: { data: [...], error }

// Note: Without .select(), mutations return { data: null, error }
```

### UPDATE Operations

```javascript
await insforge.database.from('posts').update({ title: 'Updated Title' }).eq('id', '123').select();
// Response: { data: [...], error }
```

### DELETE Operations

```javascript
await insforge.database.from('posts').delete().eq('id', '123').select();
// Response: { data: [...], error }
```

### Filter Methods

```javascript
.eq('column', value)        // Equals
.neq('column', value)       // Not equals
.gt('column', value)        // Greater than
.gte('column', value)       // Greater than or equal
.lt('column', value)        // Less than
.lte('column', value)       // Less than or equal
.like('column', '%pattern%')  // Pattern match (case-sensitive)
.ilike('column', '%pattern%') // Pattern match (case-insensitive)
.is('column', null)         // IS NULL / IS boolean
.in('column', [1, 2, 3])    // IN array

// Logical operators (v0.0.22+)
.or('status.eq.active,status.eq.pending')  // OR condition
.and('price.gte.100,price.lte.500')        // Explicit AND
.not('deleted', 'is.true')                 // NOT condition
```

#### OR Condition Examples

```javascript
// Simple OR: status = 'active' OR status = 'pending'
await insforge.database.from('posts').select().or('status.eq.active,status.eq.pending');

// OR with other filters (implicit AND)
await insforge.database
  .from('posts')
  .select()
  .eq('user_id', '123') // AND
  .or('status.eq.draft,status.eq.published'); // OR

// Complex OR with NOT
await insforge.database.from('users').select().or('age.lt.18,age.gt.65');
// age < 18 OR age > 65

// Combining AND and OR
await insforge.database
  .from('products')
  .select()
  .eq('category', 'electronics')
  .or('price.lt.100,rating.gte.4.5');
// category = 'electronics' AND (price < 100 OR rating >= 4.5)
```

### Modifiers

```javascript
.order('column', { ascending: false })  // Order by
.limit(10)                              // Limit results
.offset(20)                             // Skip results
.range(0, 9)                            // Get specific range
.single()                               // Return single object
.maybeSingle()                          // Return single object or null
```

### Count Options

Use with `select()` to get counts:

```javascript
// Get exact count with data
const { data, count, error } = await insforge.database
  .from('posts')
  .select('*', { count: 'exact' });

// Get count without data (HEAD request)
const { count, error } = await insforge.database
  .from('posts')
  .select('*', { count: 'exact', head: true });

// Count strategies:
// 'exact' - Accurate but slower for large tables
// 'planned' - Fast estimate from query planner
// 'estimated' - Very fast but rough estimate
```

### Method Chaining

All methods return the query builder for chaining:

```javascript
const { data, error } = await insforge.database
  .from('posts')
  .select('id, title, content')
  .eq('status', 'published')
  .gte('likes', 100)
  .order('created_at', { ascending: false })
  .limit(10);

// With count (Supabase-style)
const { data, error, count } = await insforge.database
  .from('posts')
  .select('*', { count: 'exact' }) // Request exact count
  .eq('status', 'published')
  .range(0, 9); // Get first 10
// Returns: data (array), error (PostgrestError), count (number)

// Count without data (head request)
const { count, error } = await insforge.database
  .from('posts')
  .select('*', { count: 'exact', head: true })
  .eq('status', 'published');
// Returns only count, no data
```

## Storage Methods

### `storage.from()`

```javascript
const bucket = insforge.storage.from('avatars');
// Returns StorageBucket instance for file operations
```

### `bucket.upload()`

```javascript
await bucket.upload('path/file.jpg', file);
// Response: { data: StorageFileSchema, error }
// data: { bucket, key, size, mimeType, uploadedAt, url }
```

### `bucket.uploadAuto()`

```javascript
await bucket.uploadAuto(file);
// Response: { data: StorageFileSchema, error }
// Auto-generates unique filename
```

### `bucket.download()`

```javascript
await bucket.download('path/file.jpg');
// Response: { data: Blob, error }
```

### `bucket.list()`

```javascript
await bucket.list({ prefix: 'users/', limit: 10 });
// Response: { data: ListObjectsResponseSchema, error }
// data: { bucketName, objects[], pagination }
```

### `bucket.remove()`

```javascript
await bucket.remove('path/file.jpg');
// Response: { data: { message }, error }
```

### `bucket.getPublicUrl()`

```javascript
bucket.getPublicUrl('path/file.jpg');
// Returns: string URL (no API call)
```

## AI Methods

### `ai.chat.completions.create()`

Create AI chat completions with support for both streaming and non-streaming responses.

#### Non-Streaming

```javascript
const completion = await insforge.ai.chat.completions.create({
  model: 'anthropic/claude-3.5-haiku',
  messages: [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'Hello, how are you?' },
  ],
  temperature: 0.7,
  maxTokens: 500,
});
// Returns an OpenAI-like completion object directly (not a { data, error } envelope):
// completion.choices[0].message.content - the complete AI response text
// completion.usage                      - token usage information
// completion.model                      - the model used for generation
console.log(completion.choices[0].message.content);
```

#### Streaming

```javascript
// Returns an async iterable of OpenAI-like chunks for real-time streaming
const stream = await insforge.ai.chat.completions.create({
  model: 'anthropic/claude-3.5-haiku',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true,
});

// Each chunk carries an incremental delta in choices[0].delta.content
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (delta) process.stdout.write(delta);
}
```

#### Parameters

- `model` (string, required): AI model to use (e.g., 'anthropic/claude-3.5-haiku', 'openai/gpt-4', etc.)
- `messages` (array): Conversation messages with role ('system', 'user', 'assistant') and content
- `temperature` (number): Sampling temperature (0-2)
- `maxTokens` (number): Maximum tokens to generate
- `topP` (number): Top-p sampling parameter (0-1)
- `stream` (boolean): Enable streaming mode
- `thinking` (boolean): Enable chain-of-thought reasoning (supported models)
- `webSearch`, `fileParser`, `tools`, `toolChoice`, `parallelToolCalls`: Optional plugin/tool-calling options — see the SDK source for their shapes

### `ai.images.generate()`

Generate images using AI models.

```javascript
// Text-to-image
const image = await insforge.ai.images.generate({
  model: 'google/gemini-3-pro-image-preview',
  prompt: 'A serene landscape with mountains at sunset',
});
// Returns an OpenAI-like image object directly (not a { data, error } envelope):
// image.data[i].b64_json - base64-encoded image (no `data:` URI prefix)
// image.data[i].content  - text output, for text-capable image models
// image.usage            - token usage (when reported by the model)
const base64Png = image.data[0].b64_json;

// Image-to-image — pass source images as URLs or base64 data URIs
const edited = await insforge.ai.images.generate({
  model: 'google/gemini-3-pro-image-preview',
  prompt: 'Turn this into a watercolor painting',
  images: [{ url: 'https://example.com/input.jpg' }],
});
```

#### Parameters

- `model` (string, required): Image generation model (e.g., 'google/gemini-3-pro-image-preview', 'openai/dall-e-3')
- `prompt` (string, required): Text description of the image to generate
- `images` (array): Optional source images for image-to-image, each `{ url: string }` (HTTPS URL or `data:` base64 URI)

> The SDK normalizes generated images to base64 and exposes them as `image.data[i].b64_json`.

### `ai.embeddings.create()`

Create embeddings for one or more text inputs.

```javascript
const embeddings = await insforge.ai.embeddings.create({
  model: 'openai/text-embedding-3-small',
  input: 'Hello world', // or string[] for batch input
});
// Returns an OpenAI-like embeddings object directly (not a { data, error } envelope):
// embeddings.data[i].embedding - the vector (number[]) for input i
// embeddings.usage             - token usage information
// embeddings.model             - the model used
console.log(embeddings.data[0].embedding);
```

#### Parameters

- `model` (string, required): Embedding model (e.g., 'openai/text-embedding-3-small')
- `input` (string | string[], required): Text(s) to embed
- `dimensions` (number): Output dimensions, if supported by the model
- `encoding_format` ('float' | 'base64'): Encoding of the returned vectors

### Complete AI Example

```javascript
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'http://localhost:7130',
});

// Chat completion
const chat = await insforge.ai.chat.completions.create({
  model: 'anthropic/claude-3.5-haiku',
  messages: [{ role: 'user', content: 'What is the capital of France?' }],
});
console.log(chat.choices[0].message.content); // "The capital of France is Paris."

// Streaming chat
const stream = await insforge.ai.chat.completions.create({
  model: 'anthropic/claude-3.5-haiku',
  messages: [{ role: 'user', content: 'Write a haiku about coding' }],
  stream: true,
});

let fullResponse = '';
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (delta) {
    fullResponse += delta;
    process.stdout.write(delta);
  }
}

// Image generation
const image = await insforge.ai.images.generate({
  model: 'google/gemini-3-pro-image-preview',
  prompt: 'A futuristic city with flying cars',
});
const base64Png = image.data[0].b64_json; // base64-encoded image

// Embeddings
const embeddings = await insforge.ai.embeddings.create({
  model: 'openai/text-embedding-3-small',
  input: 'Vectorize this sentence',
});
console.log(embeddings.data[0].embedding); // number[]
```

## Types (from @insforge/shared-schemas)

```typescript
import type {
  UserSchema,
  CreateUserRequest,
  CreateSessionRequest,
  GetCurrentSessionResponse,
  StorageFileSchema,
  StorageBucketSchema,
  ListObjectsResponseSchema,
  PublicOAuthProvider,
  GetPublicEmailAuthConfigResponse,
} from '@insforge/shared-schemas';

// Database response type
interface DatabaseResponse<T> {
  data: T | null;
  error: InsForgeError | null;
  count?: number;
}

// Storage response type
interface StorageResponse<T> {
  data: T | null;
  error: InsForgeError | null;
}
```
