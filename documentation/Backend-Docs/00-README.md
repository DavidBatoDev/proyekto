# Prdigy Backend — NestJS API Documentation

> **Framework**: NestJS 11 · **Language**: TypeScript 5.7 · **Database**: Supabase (PostgreSQL)  
> **Base URL**: `http://localhost:3001/api`

---

## Table of Contents

1. [Architecture Overview](./01-ARCHITECTURE.md)
2. [Project Structure](./02-PROJECT-STRUCTURE.md)
3. [Configuration & Environment](./03-CONFIGURATION.md)
4. [Authentication & Guards](./04-AUTH-GUARDS.md)
5. [Module Breakdown](./05-MODULES.md)
6. [Patterns & Conventions](./06-PATTERNS.md)
7. [API Reference](./07-API-REFERENCE.md)
8. [AI Roadmap Editor Architecture](./08-AI-ROADMAP-EDITOR-ARCHITECTURE.md)

---

## Quick Start

```bash
cd backend
cp .env.example .env        # fill in your values
npm install
npm run start:dev            # http://localhost:3001/api
```

### Required Environment Variables

| Variable                    | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `SUPABASE_URL`              | Project URL from Supabase dashboard                     |
| `SUPABASE_ANON_KEY`         | Public anon key (JWT verification)                      |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS)                         |
| `PORT`                      | Server port (default `3001`)                            |
| `NODE_ENV`                  | `development` \| `production` \| `test`                 |
| `CLIENT_URL`                | Frontend origin for CORS (e.g. `http://localhost:5173`) |

---

## Key Concepts at a Glance

| Concept              | Implementation                                                           |
| -------------------- | ------------------------------------------------------------------------ |
| Dependency Injection | Symbol-based DI tokens per module                                        |
| Authentication       | `SupabaseAuthGuard` — Bearer JWT or `x-guest-user-id` header             |
| Authorization        | `PersonaGuard` (active persona) + `AdminGuard` (admin profile)           |
| Data Access          | Repository pattern — Interface → Supabase implementation                 |
| Validation           | `class-validator` DTOs, global `ValidationPipe` with whitelist           |
| Response shape       | `{ data: ... }` for success, `{ error: { message, status } }` for errors |
| Rate limiting        | 100 requests / 60 seconds via `@nestjs/throttler`                        |
