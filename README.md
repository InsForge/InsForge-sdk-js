# insforge-sdk-js

[![npm version](https://img.shields.io/npm/v/@insforge/sdk.svg)](https://www.npmjs.com/package/@insforge/sdk)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Official TypeScript/JavaScript SDK for [InsForge](https://github.com/InsForge/InsForge) - A powerful, open-source Backend-as-a-Service (BaaS) platform.

## Features

- **Authentication** - Email/password, OAuth (Google, GitHub), session management
- **Database** - Full PostgreSQL database access with PostgREST
- **Storage** - File upload and management with S3-compatible storage
- **Edge Functions** - Serverless function invocation
- **AI Integration** - Built-in AI capabilities
- **TypeScript** - Full TypeScript support with type definitions
- **Automatic OAuth Handling** - Seamless OAuth callback detection

## Installation

```bash
npm install @insforge/sdk
```

Or with yarn:

```bash
yarn add @insforge/sdk
```

## Quick Start

### Initialize the Client

```javascript
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'http://localhost:7130' // Your InsForge backend URL
});
```

### Authentication

```javascript
// Sign up a new user
const { data, error } = await insforge.auth.signUp({
  email: 'user@example.com',
  password: 'securePassword123',
  name: 'John Doe' // optional
});

// Sign in with email/password
const { data, error } = await insforge.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'securePassword123'
});

// OAuth authentication (Google, GitHub)
await insforge.auth.signInWithOAuth({
  provider: 'google',
  redirectTo: 'http://localhost:3000/dashboard'
});

// Get current user
const { data: user } = await insforge.auth.getCurrentUser();

// Get any user's profile by ID (public endpoint)
const { data: profile, error } = await insforge.auth.getProfile('user-id-here');

// Update current user's profile (requires authentication)
const { data: updatedProfile, error } = await insforge.auth.setProfile({
  displayName: 'John Doe',
  bio: 'Software developer',
  avatarUrl: 'https://example.com/avatar.jpg'
});

// Sign out
await insforge.auth.signOut();
```

### Database Operations

```javascript
// Insert data
const { data, error } = await insforge.database
  .from('posts')
  .insert([
    { title: 'My First Post', content: 'Hello World!' }
  ]);

// Query data
const { data, error } = await insforge.database
  .from('posts')
  .select('*')
  .eq('author_id', userId);

// Update data
const { data, error } = await insforge.database
  .from('posts')
  .update({ title: 'Updated Title' })
  .eq('id', postId);

// Delete data
const { data, error } = await insforge.database
  .from('posts')
  .delete()
  .eq('id', postId);
```

### File Storage

```javascript
// Upload a file
const file = document.querySelector('input[type="file"]').files[0];
const { data, error } = await insforge.storage
  .from('avatars')
  .upload(file);

// Download a file
const { data, error } = await insforge.storage
  .from('avatars')
  .download('user-avatar.png');

// Delete a file
const { data, error } = await insforge.storage
  .from('avatars')
  .remove(['user-avatar.png']);

// List files
const { data, error } = await insforge.storage
  .from('avatars')
  .list();
```

### Edge Functions

```javascript
// Invoke an edge function
const { data, error } = await insforge.functions.invoke('my-function', {
  body: { key: 'value' }
});
```

### AI Integration

```javascript
// Generate text completion
const { data, error } = await insforge.ai.completion({
  model: 'gpt-3.5-turbo',
  prompt: 'Write a hello world program'
});

// Analyze an image
const { data, error } = await insforge.ai.vision({
  imageUrl: 'https://example.com/image.jpg',
  prompt: 'Describe this image'
});
```

## Documentation

For complete API reference and advanced usage, see:

- **[SDK Reference](./SDK-REFERENCE.md)** - Complete API documentation
- **[InsForge Main Repository](https://github.com/InsForge/InsForge)** - Backend platform and setup guides

## Configuration

The SDK supports the following configuration options:

```javascript
const insforge = createClient({
  baseUrl: 'http://localhost:7130',  // Required: Your InsForge backend URL
  storageStrategy: 'localStorage'     // Optional: 'localStorage' or 'memory' (default: 'localStorage')
});
```

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions:

```typescript
import { createClient, InsForgeClient, User, Session } from '@insforge/sdk';

const insforge: InsForgeClient = createClient({
  baseUrl: 'http://localhost:7130'
});

// Type-safe API calls
const response: { data: User | null; error: Error | null } =
  await insforge.auth.getCurrentUser();
```

## Error Handling

All SDK methods return a consistent response format:

```javascript
const { data, error } = await insforge.auth.signUp({...});

if (error) {
  console.error('Error:', error.message);
  console.error('Status:', error.statusCode);
} else {
  console.log('Success:', data);
}
```

## Browser Support

The SDK works in all modern browsers that support:
- ES6+ features
- Fetch API
- LocalStorage (for session management)

For Node.js environments, ensure you're using Node.js 18 or higher.

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/InsForge/insforge-sdk-js.git
cd insforge-sdk-js

# Install dependencies
npm install

# Build the SDK
npm run build

# Run tests
npm test

# Run integration tests
npm run test:integration
```

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](./LICENSE) file for details.

## Community & Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/InsForge/insforge-sdk-js/issues)
- **Documentation**: [https://docs.insforge.com](https://docs.insforge.com)
- **Main Repository**: [InsForge Backend Platform](https://github.com/InsForge/InsForge)

## Related Projects

- **[InsForge](https://github.com/InsForge/InsForge)** - The main InsForge backend platform
- **[InsForge MCP](https://github.com/InsForge/insforge-mcp)** - Model Context Protocol server for InsForge

---

Built with ❤️ by the InsForge team
