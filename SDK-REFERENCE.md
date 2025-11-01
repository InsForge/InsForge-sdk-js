# InsForge SDK Reference

## Install
```bash
npm install @insforge/sdk
```

## Initialize
```javascript
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'http://localhost:7130'
});
```

## OAuth Auto-Detection (v0.0.14+)

The SDK automatically detects and handles OAuth callback parameters when initialized. This feature works seamlessly with the InsForge backend OAuth flow.

**How it works:**
1. User calls `signInWithOAuth()` and is redirected to OAuth provider
2. After authentication, provider redirects back to your app with tokens in URL
3. SDK automatically detects these parameters on initialization
4. Session is saved and URL is cleaned - no manual handling needed!

**Example:**
```javascript
// Just initialize the client - OAuth is handled automatically
const insforge = createClient({
  baseUrl: 'http://localhost:7130'
});

// If the URL contains OAuth callback parameters like:
// ?access_token=xxx&user_id=yyy&email=user@example.com&name=John
// The SDK will:
// - Save the session to localStorage
// - Set the auth token for API calls
// - Clean the URL (remove sensitive parameters)

// You can then immediately use authenticated methods:
const { data } = await insforge.auth.getCurrentUser();
```

## Auth Methods

### `signUp()`
```javascript
await insforge.auth.signUp({
  email: 'user@example.com',
  password: 'password123',
  name: 'John Doe'  // optional
})
// Response: { data: { user, accessToken }, error }
// user: { id, email, name, emailVerified, createdAt, updatedAt }
// accessToken: JWT token string
```

### `signInWithPassword()`
```javascript
await insforge.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123'
})
// Response: { data: { user, accessToken }, error }
// user: { id, email, name, emailVerified, createdAt, updatedAt }
// accessToken: JWT token string
```

### `signInWithOAuth()`
```javascript
await insforge.auth.signInWithOAuth({
  provider: 'google',  // or 'github'
  redirectTo: 'http://localhost:3000/dashboard',
  skipBrowserRedirect: true  // optional, returns URL instead of redirecting
})
// Response: { data: { url, provider }, error }
// Auto-redirects in browser unless skipBrowserRedirect: true

// AUTOMATIC OAuth Callback Detection (v0.0.14+):
// When users are redirected back from OAuth provider, the SDK automatically:
// 1. Detects OAuth parameters (access_token, user_id, email, name) in URL
// 2. Saves the session to localStorage
// 3. Cleans the URL of sensitive parameters
// No manual handling needed - just initialize the client!
```

### `signOut()`
```javascript
await insforge.auth.signOut()
// Response: { error }
// Clears stored tokens
```

### `getCurrentSession()`
```javascript
await insforge.auth.getCurrentSession()
// Response: { data: { session }, error }
// session: { accessToken, user }
// Gets from local storage, no API call
```

### `getCurrentUser()`
```javascript
await insforge.auth.getCurrentUser()
// Response: { data: { user, profile }, error }
// user: { id, email, role }  // Auth info from API
// profile: { id, nickname, avatar_url, bio, birthday, ... }  // Profile from users table
// Returns null if not authenticated
```

### `getProfile()`
```javascript
await insforge.auth.getProfile(userId)
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
  birthday: '1990-01-01'
})
// Response: { data: profile, error }
// Updates current user's profile in users table
```

### `getOAuthProviders()`
```javascript
await insforge.auth.getOAuthProviders()
// Response: { data: PublicOAuthProvider[], error }
// data: Array of configured OAuth providers
// Each provider: { provider: ['google','github'] }
// This is a public endpoint that doesn't require authentication
```

### `getEmailAuthConfig()`
```javascript
await insforge.auth.getEmailAuthConfig()
// Response: { data: GetPublicEmailAuthConfigResponse, error }
// data: {
//   requireEmailVerification: boolean,
//   passwordMinLength: number,
//   requireNumber: boolean,
//   requireLowercase: boolean,
//   requireUppercase: boolean,
//   requireSpecialChar: boolean
// }
// This is a public endpoint that doesn't require authentication
// Useful for displaying password requirements and email verification settings in your UI
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

## Storage
- **Browser**: localStorage
- **Node.js**: In-memory Map
- **Custom**: Provide via `storage` option in config

## Database Methods

**Note:** Database operations use [@supabase/postgrest-js](https://github.com/supabase/postgrest-js) under the hood, providing full PostgREST compatibility including advanced features like OR conditions, complex joins, and aggregations.

### `from()`
Create a query builder for a table:
```javascript
const query = insforge.database.from('posts')
// Returns a PostgREST query builder with all Supabase features
```

### SELECT Operations
```javascript
// Basic select
await insforge.database
  .from('posts')
  .select()  // Default: '*'

// Select specific columns
await insforge.database
  .from('posts')
  .select('id, title, created_at')

// With filters
await insforge.database
  .from('posts')
  .select()
  .eq('user_id', '123')
  .order('created_at', { ascending: false })
  .limit(10)

// With joins (PostgREST syntax)
await insforge.database
  .from('posts')
  .select('*, users!inner(*)')  // Inner join with users table

// Join with specific columns
await insforge.database
  .from('posts')
  .select('id, title, users(nickname, avatar_url)')

// Aliased joins
await insforge.database
  .from('posts')
  .select('*, author:users(*)')  // Alias users as author
// Response: { data: [...], error }
```

### INSERT Operations
```javascript
// Single record - use .select() to return inserted data
await insforge.database
  .from('posts')
  .insert({ title: 'Hello', content: 'World' })
  .select()

// Multiple records
await insforge.database
  .from('posts')
  .insert([
    { title: 'Post 1', content: 'Content 1' },
    { title: 'Post 2', content: 'Content 2' }
  ])
  .select()

// Upsert
await insforge.database
  .from('posts')
  .upsert({ id: '123', title: 'Updated or New' })
  .select()
// Response: { data: [...], error }

// Note: Without .select(), mutations return { data: null, error }
```

### UPDATE Operations
```javascript
await insforge.database
  .from('posts')
  .update({ title: 'Updated Title' })
  .eq('id', '123')
  .select()
// Response: { data: [...], error }
```

### DELETE Operations
```javascript
await insforge.database
  .from('posts')
  .delete()
  .eq('id', '123')
  .select()
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
await insforge.database
  .from('posts')
  .select()
  .or('status.eq.active,status.eq.pending')

// OR with other filters (implicit AND)
await insforge.database
  .from('posts')
  .select()
  .eq('user_id', '123')  // AND
  .or('status.eq.draft,status.eq.published')  // OR
  
// Complex OR with NOT
await insforge.database
  .from('users')
  .select()
  .or('age.lt.18,age.gt.65')
  // age < 18 OR age > 65

// Combining AND and OR
await insforge.database
  .from('products')
  .select()
  .eq('category', 'electronics')
  .or('price.lt.100,rating.gte.4.5')
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
  .select('*', { count: 'exact' })

// Get count without data (HEAD request)
const { count, error } = await insforge.database
  .from('posts')
  .select('*', { count: 'exact', head: true })

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
  .limit(10)

// With count (Supabase-style)
const { data, error, count } = await insforge.database
  .from('posts')
  .select('*', { count: 'exact' })  // Request exact count
  .eq('status', 'published')
  .range(0, 9)  // Get first 10
// Returns: data (array), error (PostgrestError), count (number)

// Count without data (head request)
const { count, error } = await insforge.database
  .from('posts')
  .select('*', { count: 'exact', head: true })
  .eq('status', 'published')
// Returns only count, no data
```

## Storage Methods

### `storage.from()`
```javascript
const bucket = insforge.storage.from('avatars')
// Returns StorageBucket instance for file operations
```

### `bucket.upload()`
```javascript
await bucket.upload('path/file.jpg', file)
// Response: { data: StorageFileSchema, error }
// data: { bucket, key, size, mimeType, uploadedAt, url }
```

### `bucket.uploadAuto()`
```javascript
await bucket.uploadAuto(file)
// Response: { data: StorageFileSchema, error }
// Auto-generates unique filename
```

### `bucket.download()`
```javascript
await bucket.download('path/file.jpg')
// Response: { data: Blob, error }
```

### `bucket.list()`
```javascript
await bucket.list({ prefix: 'users/', limit: 10 })
// Response: { data: ListObjectsResponseSchema, error }
// data: { bucketName, objects[], pagination }
```

### `bucket.remove()`
```javascript
await bucket.remove('path/file.jpg')
// Response: { data: { message }, error }
```

### `bucket.getPublicUrl()`
```javascript
bucket.getPublicUrl('path/file.jpg')
// Returns: string URL (no API call)
```

## AI Methods

### `ai.chat.completions.create()`
Create AI chat completions with support for both streaming and non-streaming responses.

#### Non-Streaming
```javascript
const { data, error } = await insforge.ai.chat.completions.create({
  model: 'anthropic/claude-3.5-haiku',
  messages: [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'Hello, how are you?' }
  ],
  temperature: 0.7,
  maxTokens: 500
})
// Response: { data: { response, usage, model }, error }
// response: The complete AI response text
// usage: Token usage information
// model: The model used for generation
```

#### Streaming
```javascript
// Returns async iterable for real-time streaming
const stream = await insforge.ai.chat.completions.create({
  model: 'anthropic/claude-3.5-haiku',
  messages: [
    { role: 'user', content: 'Tell me a story' }
  ],
  stream: true
})

// Process stream events
for await (const event of stream) {
  if (event.chunk) {
    // Partial response chunk
    process.stdout.write(event.chunk);
  }
  if (event.done) {
    // Stream complete
    console.log('\nStream finished');
  }
}
```

#### Parameters
- `model` (string, required): AI model to use (e.g., 'anthropic/claude-3.5-haiku', 'openai/gpt-4', etc.)
- `messages` (array): Conversation messages with role ('system', 'user', 'assistant') and content
- `message` (string): Simple message string (alternative to messages array)
- `systemPrompt` (string): System prompt for the conversation
- `temperature` (number): Sampling temperature (0-1)
- `maxTokens` (number): Maximum tokens to generate
- `topP` (number): Top-p sampling parameter
- `stream` (boolean): Enable streaming mode

### `ai.images.generate()`
Generate images using AI models.

```javascript
const { data, error } = await insforge.ai.images.generate({
  model: 'google/gemini-2.5-flash-image-preview',
  prompt: 'A serene landscape with mountains at sunset',
  size: '1024x1024',
  numImages: 1,
  quality: 'hd',
  style: 'vivid'
})
// Response: { data: { images: [{ url, ... }] }, error }
// images: Array of generated images with URLs
```

#### Parameters
- `model` (string, required): Image generation model (e.g., 'google/gemini-2.5-flash-image-preview', 'openai/dall-e-3', 'stable-diffusion', etc.)
- `prompt` (string, required): Text description of the image to generate
- `negativePrompt` (string): What to avoid in the image (some models)
- `width` (number): Image width in pixels
- `height` (number): Image height in pixels  
- `size` (string): Predefined size (e.g., '1024x1024', '512x512')
- `numImages` (number): Number of images to generate
- `quality` ('standard' | 'hd'): Image quality setting
- `style` ('vivid' | 'natural'): Image style preference
- `responseFormat` ('url' | 'b64_json'): Response format for images

### Complete AI Example
```javascript
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'http://localhost:7130'
});

// Chat completion
const { data: chat } = await insforge.ai.chat.completions.create({
  model: 'anthropic/claude-3.5-haiku',
  messages: [
    { role: 'user', content: 'What is the capital of France?' }
  ]
});
console.log(chat.response); // "The capital of France is Paris."

// Streaming chat
const stream = await insforge.ai.chat.completions.create({
  model: 'anthropic/claude-3.5-haiku',
  messages: [
    { role: 'user', content: 'Write a haiku about coding' }
  ],
  stream: true
});

let fullResponse = '';
for await (const event of stream) {
  if (event.chunk) {
    fullResponse += event.chunk;
    process.stdout.write(event.chunk);
  }
}

// Image generation
const { data: images } = await insforge.ai.images.generate({
  model: 'google/gemini-2.5-flash-image-preview',
  prompt: 'A futuristic city with flying cars',
  size: '1024x1024',
  quality: 'hd'
});
console.log(images.images[0].url); // URL to generated image
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
  GetPublicEmailAuthConfigResponse
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