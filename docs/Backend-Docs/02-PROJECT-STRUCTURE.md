# Project Structure

```
backend/
├── .env                          # Local environment variables (gitignored)
├── .env.example                  # Template — copy to .env
├── nest-cli.json
├── package.json
├── tsconfig.json
└── src/
    ├── main.ts                   # Bootstrap: helmet, compression, CORS, pipes, filters
    ├── app.module.ts             # Root module — wires all feature modules
    │
    ├── config/
    │   ├── env.validation.ts     # class-validator env validation (runs at startup)
    │   └── supabase.module.ts    # @Global SupabaseModule — SUPABASE_ADMIN + SUPABASE_CLIENT
    │
    ├── common/
    │   ├── decorators/
    │   │   ├── current-user.decorator.ts   # @CurrentUser() — extracts req.user
    │   │   ├── personas.decorator.ts       # @Personas(...) — sets PERSONAS_KEY metadata
    │   │   └── public.decorator.ts         # @Public() — skips auth guard
    │   │
    │   ├── entities/
    │   │   └── index.ts          # All TypeScript entity interfaces (30+ types)
    │   │
    │   ├── filters/
    │   │   └── http-exception.filter.ts    # Global error → { error: { message, status } }
    │   │
    │   ├── guards/
    │   │   ├── supabase-auth.guard.ts      # JWT Bearer + x-guest-user-id fallback
    │   │   ├── persona.guard.ts            # Checks profiles.active_persona
    │   │   └── admin.guard.ts              # Checks admin_profiles.is_active
    │   │
    │   ├── interceptors/
    │   │   └── response.interceptor.ts     # Wraps all responses in { data: ... }
    │   │
    │   └── interfaces/
    │       └── authenticated-request.interface.ts  # AuthenticatedUser + AuthenticatedRequest
    │
    └── modules/
        ├── auth/                 # JWT profile, onboarding, persona switch
        ├── users/                # User account management
        ├── profile/              # Full consultant profile (28+ sub-entity endpoints)
        ├── projects/             # Project CRUD + membership
        ├── payments/             # Escrow checkpoints, wallets, transactions
        ├── admin/                # Admin actions, vetting, match-candidates
        ├── consultants/          # Public consultant discovery
        ├── applications/         # Consultant job applications
        ├── uploads/              # Signed URL generation, avatar/banner confirmation
        ├── guests/               # Guest session management + roadmap migration
        ├── roadmaps/             # Roadmaps, milestones, epics, features, tasks, comments
        └── roadmap-shares/       # Share token generation, shared-content comments
```

---

## Module Internal Structure

### Standard module (with repository pattern)

```
modules/payments/
├── dto/
│   └── payment.dto.ts                        # DTOs for all endpoints
├── repositories/
│   ├── payments.repository.interface.ts      # TypeScript interface (contract)
│   └── payments.repository.supabase.ts       # Concrete Supabase implementation
├── payments.service.ts                       # Business logic + PAYMENTS_REPOSITORY token
├── payments.controller.ts                    # HTTP routes
└── payments.module.ts                        # DI wiring — { provide: PAYMENTS_REPOSITORY, useClass: ... }
```

### Roadmaps module (multi-controller variant)

```
modules/roadmaps/
├── controllers/
│   ├── roadmaps.controller.ts
│   ├── milestones.controller.ts
│   ├── epics.controller.ts
│   ├── features.controller.ts
│   ├── tasks.controller.ts
│   └── task-extras.controller.ts
├── dto/
│   └── roadmaps.dto.ts                       # All DTOs for all sub-entities
├── repositories/
│   ├── roadmaps.repository.{interface,supabase}.ts
│   ├── milestones.repository.{interface,supabase}.ts
│   ├── epics.repository.{interface,supabase}.ts
│   ├── features.repository.{interface,supabase}.ts
│   ├── tasks.repository.{interface,supabase}.ts
│   └── task-extras.repository.{interface,supabase}.ts
├── services/
│   ├── roadmaps.service.ts        # exports ROADMAPS_REPOSITORY token
│   ├── milestones.service.ts      # exports MILESTONES_REPOSITORY token
│   ├── epics.service.ts           # exports EPICS_REPOSITORY token
│   ├── features.service.ts        # exports FEATURES_REPOSITORY token
│   ├── tasks.service.ts           # exports TASKS_REPOSITORY token
│   └── task-extras.service.ts     # exports TASK_EXTRAS_REPOSITORY token
└── roadmaps.module.ts             # Registers all 6 controllers + 6 service/repo pairs
```
