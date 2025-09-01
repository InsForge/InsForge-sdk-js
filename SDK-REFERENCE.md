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
  apiKey: 'ik_xxx'  // optional
});
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

## Error Response
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

## Storage
- **Browser**: localStorage
- **Node.js**: In-memory Map
- **Custom**: Provide via `storage` option in config

## Database Methods

### `from()`
Create a query builder for a table:
```javascript
const query = insforge.database.from('posts')
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
```

### Modifiers
```javascript
.order('column', { ascending: false })  // Order by
.limit(10)                              // Limit results
.offset(20)                             // Skip results
.range(0, 9)                            // Get specific range
.single()                               // Return single object
.count('exact')                         // Get total count
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


## Types (from @insforge/shared-schemas)
```typescript
import type {
  UserSchema,
  CreateUserRequest,
  CreateSessionRequest,
  GetCurrentSessionResponse,
  StorageFileSchema,
  StorageBucketSchema,
  ListObjectsResponseSchema
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