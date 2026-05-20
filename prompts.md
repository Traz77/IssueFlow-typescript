# Prompts
Models and roles:
- Claude Sonnet 4.6 and Claude Opus 4.7: architecture and prompt drafting
- Gemini 3.1 Pro: critical review
- Claude-Code: execution in repo
- Codex 5.2: review of Claude-Code output

Workflow: draft → review → execute → verify → log results.

---

## Phase 1: Foundation (Auth, Users)

### Prompt 1 — Project Bootstrap: CLAUDE.md

**Goal:** Establish project conventions before writing any code by creating a CLAUDE.md file capturing the stack, architecture patterns, API conventions, testing conventions, and anti-patterns to avoid.

**Prompt:**

I'm building IssueFlow, a ticket management backend API, as a take-home assignment for AT&T's TDP 2026 program.

Before we write any code, create a CLAUDE.md file at the repo root that captures the conventions we'll follow throughout the project. Use this content:

---
# IssueFlow Project Context

## Stack
- NestJS 11, TypeScript 5
- TypeORM with PostgreSQL (via docker-compose)
- JWT auth via @nestjs/passport + @nestjs/jwt + passport-jwt
- bcrypt for password hashing
- class-validator + class-transformer for DTO validation
- Jest for unit and e2e tests

## Architecture conventions
- Module-per-domain: auth, users, projects, tickets, comments, audit-log, attachments
- Each module has: *.module.ts, *.controller.ts, *.service.ts, entities/, dto/
- Shared code lives in src/common/ (enums, guards, decorators, filters, interceptors)
- All entities use auto-increment integer primary keys
- Timestamps: createdAt, updatedAt on every entity (TypeORM @CreateDateColumn, @UpdateDateColumn)
- Soft delete: nullable `deletedAt` column on Ticket and Project; manually filtered (don't use TypeORM's @DeleteDateColumn auto-magic — we want explicit control)
- Concurrency: optimistic locking via @VersionColumn on Ticket and Comment
- Audit logging: a shared AuditLogService is called from any state-changing service method

## API conventions
- Global ValidationPipe with whitelist: true, forbidNonWhitelisted: true, transform: true
- Global exception filter returns: { statusCode, message, error, timestamp, path }
- All endpoints require JWT except POST /auth/login
- Role guard for ADMIN-only endpoints (soft-delete restore, audit log read)
- DTOs are explicit per operation (CreateUserDto, UpdateUserDto — never reuse)

## Testing conventions
- Unit tests next to source files (*.spec.ts)
- E2E tests in test/ directory
- Use in-memory or test-container Postgres for integration tests

## Things NOT to do
- Don't use `any` type — use `unknown` and narrow, or define a proper type
- Don't put business logic in controllers — controllers only validate and delegate
- Don't write to the database without writing a corresponding audit log entry (where applicable)
- Don't hard-delete tickets or projects — soft delete only
---

Just create the file. Don't write any other code yet.

---

### Prompt 2 — Dependency Installation

**Goal:** Install all required runtime and dev dependencies (TypeORM, config, auth, validation, bcrypt) and confirm a clean package.json before writing any application code.

**Prompt:**

We're starting Phase 1 of IssueFlow. Before writing any code, install the runtime and dev dependencies we'll need for the foundation: database, config, auth, validation.

Run these in the issueflow-typescript directory:

Runtime:
npm install @nestjs/typeorm typeorm pg @nestjs/config @nestjs/passport @nestjs/jwt passport passport-jwt bcrypt class-validator class-transformer

Dev:
npm install -D @types/passport-jwt @types/bcrypt @types/pg

Then show me the updated package.json dependencies section so I can confirm everything installed cleanly. Don't write any other code yet.

---

### Prompt 3 — Configuration & Database Wiring

**Goal:** Wire @nestjs/config and TypeORM for Postgres connectivity via environment variables, set up the global ValidationPipe and global exception filter, and verify a clean boot with no connection errors.

**Prompt:**

Phase 1, Step 1: wire up @nestjs/config and TypeORM so the app can connect to Postgres on startup. Reference CLAUDE.md and DECISIONS.md for conventions.

Tasks:

1. Create src/config/database.config.ts — a registerAs('database', ...) factory that reads DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME from process.env and returns a TypeOrmModuleOptions object:
   - type: 'postgres'
   - host, port (parseInt), username, password, database from env
   - autoLoadEntities: true
   - synchronize: process.env.NODE_ENV === 'development'  (with a comment explaining this MUST be false in production and we'd use migrations there)
   - logging: ['error', 'warn']

2. Create src/config/jwt.config.ts — a registerAs('jwt', ...) factory returning { secret: process.env.JWT_SECRET, signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '3600s' } }.

3. Update src/app.module.ts:
   - Import ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig, jwtConfig], envFilePath: '.env' })
   - Import TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: (cs: ConfigService) => cs.get('database') })
   - Keep AppController and AppService for now

4. Update src/main.ts to:
   - Enable global ValidationPipe: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } })
   - Read PORT from env (default 3000)

5. Verify boot:
   - Run `docker compose up -d` from the issueflow-typescript directory
   - Run `npm run start:dev`
   - Confirm "Nest application successfully started" with NO TypeORM connection errors

Show me database.config.ts, jwt.config.ts, the updated app.module.ts, main.ts, and the startup logs.

Do NOT create any entities, services, controllers, or auth code yet — that comes next.

---

### Prompt 4 — Users Module

**Goal:** Build the complete Users module — entity with bcrypt password hashing, DTOs, service (with ConflictException on duplicate), controller following the exact API contract, and unit tests.

**Prompt:**

Phase 1, Step 2: build the Users module — entity, DTOs, service, controller, basic tests. Follow CLAUDE.md conventions and DECISIONS.md D1 (password on POST /users).

API contract (from README.md, follow exactly):
- GET /users → 200, returns User[] (no passwordHash field)
- GET /users/:userId → 200, returns User
- POST /users body { username, email, fullName, role, password } → 200, returns created User
- POST /users/update/:userId body { fullName?, role? } → 200, no body
- DELETE /users/:userId → 200, no body

Note: the spec uses POST /users/update/:userId (not PATCH) and POST for create returns 200 (not 201). Follow the spec literally.

Tasks:

1. Create src/common/enums/user-role.enum.ts:
   export enum UserRole { ADMIN = 'ADMIN', DEVELOPER = 'DEVELOPER' }

2. Create src/users/entities/user.entity.ts with TypeORM decorators:
   - id: number (PK, generated)
   - username: string, unique, indexed, length 30
   - email: string, unique, indexed, length 255
   - fullName: string, length 100
   - role: UserRole (postgres enum type, column name "role")
   - passwordHash: string, length 255, { select: false } so it never leaks accidentally
   - createdAt, updatedAt via @CreateDateColumn / @UpdateDateColumn

3. Create DTOs in src/users/dto/:
   - create-user.dto.ts: 
       username @IsString @Length(3,30) @Matches(/^[a-zA-Z0-9_]+$/) 
       email @IsEmail 
       fullName @IsString @Length(1,100) 
       role @IsEnum(UserRole) 
       password @IsString @MinLength(8)
   - update-user.dto.ts: fullName @IsOptional @IsString @Length(1,100); role @IsOptional @IsEnum(UserRole)
   - user-response.dto.ts: plain object shape { id, username, email, fullName, role } — NO passwordHash, NO timestamps in response unless asked

4. Create src/users/users.service.ts:
   - findAll(): User[] mapped to UserResponseDto
   - findOne(id): User or throws NotFoundException
   - create(dto): hashes password with bcrypt cost 10, persists, returns UserResponseDto. Throw ConflictException on duplicate username or email (catch the Postgres unique-violation 23505).
   - update(id, dto): updates fullName/role only, throws NotFoundException if missing
   - remove(id): hard-delete (users are NOT soft-deleted per spec — only tickets/projects are)
   - findByUsernameWithPassword(username): internal helper that selects passwordHash too, used by AuthService later. Returns full entity or null.

5. Create src/users/users.controller.ts following the exact route shapes above. Use @HttpCode(200) on POST handlers since the spec wants 200 not the Nest default of 201 on POST.

6. Create src/users/users.module.ts: TypeOrmModule.forFeature([User]), export UsersService so AuthModule can use it later.

7. Register UsersModule in AppModule.

8. Tests in src/users/users.service.spec.ts (Jest, mock the repository):
   - create() hashes the password (the stored entity's passwordHash !== the input password, and bcrypt.compare matches)
   - create() throws ConflictException on duplicate username
   - findOne() throws NotFoundException when missing
   - findAll() never returns passwordHash in the response objects

9. Verify it works end-to-end:
   - npm run start:dev
   - curl -X POST http://localhost:3000/users -H "Content-Type: application/json" -d '{"username":"jdoe","email":"jdoe@example.com","fullName":"John Doe","role":"DEVELOPER","password":"password123"}'
   - confirm 200 response, response body has no passwordHash field
   - curl http://localhost:3000/users → confirm user appears, no passwordHash
   - Try to create the same username again → confirm 409 Conflict

Show me the entity, the DTOs, the service, the controller, the spec file, and the curl outputs.

Do NOT build the auth module yet — that's the next step.

---

### Prompt 5 — Auth Module (JWT + Logout Deny-list)

**Goal:** Build the Auth module with JWT strategy, login/logout/me endpoints, global JwtAuthGuard with a @Public() escape hatch, and an in-memory token deny-list for invalidating tokens on logout (D4).

**Prompt:**

Phase 1, Step 3: build the Auth module — JWT strategy, login/logout/me endpoints, global JwtAuthGuard with a @Public() escape hatch, and a token deny-list for logout. Follow CLAUDE.md and DECISIONS.md.

First add this entry to DECISIONS.md:

---
## D2: POST /users is public; all other endpoints require JWT

**Context:** Spec section 2.2 says all endpoints except POST /auth/login require JWT. This creates a bootstrapping problem — no user can exist to log in with until one is created, and creating one requires a token.

**Decision:** Mark POST /users as @Public(). All other endpoints (including the rest of /users) require a valid JWT. Role-based authorization (ADMIN-only operations like soft-delete restore) is layered on top in later phases via a separate RolesGuard.

**Rationale:** Self-service signup is the standard real-world pattern. Seeding an initial admin via migration is more "spec-strict" but adds infrastructure for one user. The deviation is documented and narrow.

**Trade-off:** Anyone can create a user. In production we'd add CAPTCHA, email verification, and/or admin-only user creation. Out of scope here.
---

API contract (from README.md):
- POST /auth/login body { username, password } → 200 { accessToken, tokenType: "Bearer", expiresIn: 3600 }
- POST /auth/logout → 200, no body. Subsequent requests with the same token must return 401.
- GET /auth/me → 200, returns the authenticated user (UserResponseDto shape — no passwordHash)

Tasks:

1. Create src/common/decorators/public.decorator.ts:
   export const IS_PUBLIC_KEY = 'isPublic';
   export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

2. Create src/common/decorators/current-user.decorator.ts:
   - Param decorator that returns req.user (the validated JWT payload, narrowed to { sub: number, username: string, role: UserRole })

3. Create src/auth/jwt-payload.interface.ts:
   export interface JwtPayload { sub: number; username: string; role: UserRole; jti: string; iat?: number; exp?: number; }

4. Create src/auth/auth.service.ts:
   - Constructor injects UsersService, JwtService, ConfigService
   - Maintain a private in-memory deny-list: Map<string, number> (jti -> expiry epoch seconds)
   - Run a setInterval every 60s to evict expired entries from the deny-list (keep memory bounded)
   - validateUser(username, password): use UsersService.findByUsernameWithPassword, bcrypt.compare; return UserResponseDto on match, throw UnauthorizedException on miss. Use the same exception message ("Invalid credentials") for both "user not found" and "wrong password" to avoid user enumeration.
   - login(user): generate jti via crypto.randomUUID(), sign JWT with payload { sub, username, role, jti }, return { accessToken, tokenType: 'Bearer', expiresIn: 3600 } (number, not string)
   - logout(jti, exp): add to deny-list with expiry = exp
   - isDenied(jti): boolean
   - getProfile(userId): delegates to UsersService.findOne

5. Create src/auth/jwt.strategy.ts extending PassportStrategy(Strategy):
   - Constructor injects ConfigService and AuthService
   - jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()
   - ignoreExpiration: false
   - secretOrKey: configService.get('jwt.secret')
   - validate(payload: JwtPayload): if authService.isDenied(payload.jti) throw UnauthorizedException; otherwise return payload (this gets attached to req.user)

6. Create src/auth/guards/jwt-auth.guard.ts extending AuthGuard('jwt'):
   - Override canActivate: read IS_PUBLIC_KEY metadata via Reflector; if true, return true (skip auth); otherwise super.canActivate(context)

7. Create src/auth/auth.controller.ts:
   - POST /auth/login → @Public() @HttpCode(200): body { username, password } via LoginDto, calls authService.validateUser then authService.login. Returns the token response.
   - POST /auth/logout → @HttpCode(200): uses @CurrentUser() to get { jti, exp }, calls authService.logout
   - GET /auth/me: uses @CurrentUser() to get sub, calls authService.getProfile

8. Create src/auth/dto/login.dto.ts: username @IsString @IsNotEmpty; password @IsString @IsNotEmpty

9. Create src/auth/auth.module.ts:
   - imports: UsersModule, PassportModule, JwtModule.registerAsync({ inject: [ConfigService], useFactory: (cs) => cs.get('jwt') }), ConfigModule
   - providers: AuthService, JwtStrategy, AND register the global guard here:
     { provide: APP_GUARD, useClass: JwtAuthGuard }
   - exports: AuthService

10. In AppModule, import AuthModule. Delete the AppController, AppService, and app.controller.spec.ts — they're hello-world cruft we no longer need. Remove their references from AppModule.

11. Mark POST /users with @Public() in users.controller.ts so it works as a signup endpoint per D2.

12. Tests in src/auth/auth.service.spec.ts:
    - validateUser returns user on correct password
    - validateUser throws UnauthorizedException with "Invalid credentials" on wrong password
    - validateUser throws UnauthorizedException with "Invalid credentials" when user not found (same message — no enumeration)
    - login returns { accessToken, tokenType: 'Bearer', expiresIn: number }
    - logout adds jti to deny-list; isDenied returns true after logout

13. End-to-end verification (full flow):
    a. curl POST /users with a new user (should work — Public)
    b. curl POST /auth/login → grab the accessToken
    c. curl GET /auth/me with "Authorization: Bearer <token>" → 200 with user profile
    d. curl GET /auth/me with no header → 401 Unauthorized
    e. curl GET /users with the token → 200
    f. curl POST /auth/logout with the token → 200
    g. curl GET /auth/me with the same token again → 401 Unauthorized (deny-list working)
    h. curl POST /auth/login again → new token works fine

Show me: all new files, the AppModule diff, the test file results, and all 8 curl outputs.

---

## Phase 2: Core Domain (Projects, Tickets, Comments)

### Prompt 6 — Projects Module

**Goal:** Build the Projects module with soft-delete (deletedAt column), owner validation via UsersService, and the full CRUD API contract including explicit GET/POST/PATCH/DELETE routes.

**Prompt:**

Phase 2, Step 1: build the Projects module. Follow CLAUDE.md and DECISIONS.md.

API contract (from README.md, follow exactly):
- GET /projects → 200, returns Project[] (only non-deleted)
- GET /projects/:projectId → 200
- POST /projects body { name, description, ownerId } → 200, returns created Project
- PATCH /projects/:projectId body { name?, description? } → 200, no body
- DELETE /projects/:projectId → 200, no body (SOFT delete — sets deletedAt, doesn't remove the row)

All endpoints require JWT (global guard already handles this — do not add @Public()).

Tasks:

1. Create src/projects/entities/project.entity.ts with TypeORM decorators:
   - id: number (PK, generated)
   - name: string, length 100, not null
   - description: string, length 1000, nullable
   - ownerId: number, not null, with @JoinColumn FK to users.id and @ManyToOne(() => User) — but eager: false (don't auto-load). Add @Column({ name: 'owner_id' }) explicitly so the FK column is clean.
   - deletedAt: Date | null, nullable, default null, @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
   - createdAt, updatedAt via @CreateDateColumn / @UpdateDateColumn (snake_case column names)
   - Add an index on deletedAt to keep "WHERE deletedAt IS NULL" queries fast

2. Create DTOs in src/projects/dto/:
   - create-project.dto.ts: 
       name @IsString @Length(1,100) 
       description @IsOptional @IsString @MaxLength(1000) 
       ownerId @IsInt @IsPositive
   - update-project.dto.ts: 
       name @IsOptional @IsString @Length(1,100) 
       description @IsOptional @IsString @MaxLength(1000)
       (Notably: ownerId is NOT updatable — ownership changes would be a separate feature)
   - project-response.dto.ts: static from(project): { id, name, description, ownerId }

3. Create src/projects/projects.service.ts:
   - Constructor injects @InjectRepository(Project) and UsersService
   - findAll(): all projects where deletedAt IS NULL, mapped to response DTOs
   - findOne(id): the project where id matches AND deletedAt IS NULL, throws NotFoundException otherwise. Add a private findOneRaw(id) helper that does the same but is reused internally.
   - create(dto): first verify ownerId exists by calling usersService.findOne(ownerId) (which throws NotFound) — repackage that as BadRequestException with message "Owner user does not exist". Then persist and return response DTO.
   - update(id, dto): find non-deleted project, apply only the fields present in dto, save, return nothing (controller returns 200 empty)
   - softDelete(id): find non-deleted project, set deletedAt = new Date(), save. If already deleted, throw NotFoundException (same as if it didn't exist — don't leak soft-delete state to non-admins; the /deleted endpoint comes in Phase 4 for admins).

4. Create src/projects/projects.controller.ts:
   - GET / → findAll
   - GET /:projectId (ParseIntPipe) → findOne
   - POST / @HttpCode(200) → create, returns response DTO
   - PATCH /:projectId @HttpCode(200) → update, returns nothing
   - DELETE /:projectId @HttpCode(200) → softDelete, returns nothing

5. Create src/projects/projects.module.ts:
   - imports: TypeOrmModule.forFeature([Project]), UsersModule
   - exports: ProjectsService (TicketsModule will need it in Phase 2 Step 2)

6. Register ProjectsModule in AppModule.

7. Tests in src/projects/projects.service.spec.ts (Jest, mock repository AND mock UsersService):
   - create() throws BadRequestException with "Owner user does not exist" when owner not found
   - create() persists when owner exists, returns response DTO
   - findOne() throws NotFoundException for soft-deleted projects (deletedAt set)
   - findAll() excludes soft-deleted projects from results
   - softDelete() sets deletedAt and saves; calling it again on the now-deleted project throws NotFoundException

8. End-to-end verification (assume there's already a user with id=1 from earlier):
   a. Login as that user, capture token
   b. POST /projects { "name": "Test Project", "description": "A test", "ownerId": 1 } with token → 200, returns project with id
   c. POST /projects with ownerId: 999 → 400 BadRequest "Owner user does not exist"
   d. GET /projects → 200, includes the new project
   e. GET /projects/<id> → 200
   f. PATCH /projects/<id> { "name": "Updated" } → 200 empty
   g. GET /projects/<id> → confirms name changed
   h. DELETE /projects/<id> → 200 empty
   i. GET /projects → 200, project is GONE from the list
   j. GET /projects/<id> → 404 NotFound (looks like it never existed)
   k. GET /projects with NO token → 401

Show me all new files, the AppModule diff, the spec output, and all 11 curl results.

Do NOT build the Tickets or Comments modules yet — they're separate steps.

---

### Prompt 7 — Tickets Module (Status State Machine + Optimistic Locking)

**Goal:** Build the Tickets module with a strictly-adjacent forward-only status state machine (D5), optimistic locking via @VersionColumn (D6), soft-delete, and all validation constraints around DONE tickets.

**Prompt:**

Fresh Claude Code session. You should read CLAUDE.md and DECISIONS.md from the project root before starting — they contain conventions and prior architectural decisions you must follow.

Phase 2, Step 2: build the Tickets module. The Users and Projects modules are complete and follow patterns you should match (entity → enum → DTOs → service → controller → module → spec → register in AppModule). The Tickets module is more rule-heavy than either.

First, append D5 and D6 to DECISIONS.md:

---
## D5: Status transitions are strictly adjacent and forward-only

**Context:** Spec section 2.4 says "A ticket's status may only move forward in the lifecycle: TODO → IN_PROGRESS → IN_REVIEW → DONE. Backward transitions are not allowed." The literal reading is ambiguous on whether skipping levels (e.g., TODO directly to DONE) is allowed.

**Decision:** Only adjacent forward transitions are allowed. Same-status updates (no-op) are also allowed. Any skip or backward transition returns 400 Bad Request with a clear message.

Allowed transitions:
- TODO → IN_PROGRESS
- IN_PROGRESS → IN_REVIEW
- IN_REVIEW → DONE
- Any status → same status (no-op)

**Rationale:** Matches the arrow notation in the spec literally. Matches the workflow of mainstream issue trackers (Jira, Linear). Easier to audit and reason about.

**Trade-off:** Hotfix workflows that legitimately skip review must split the work across two PATCH calls. Acceptable cost for the discipline.

---
## D6: Ticket responses include a `version` field for optimistic locking

**Context:** Spec section 2.4 requires that "A ticket can't be updated simultaneously by two users." The spec's example response object does not include a version field. The client cannot enforce optimistic locking without knowing the current version.

**Decision:** All ticket responses include a `version` field (integer, increments on every save). Update requests (PATCH /tickets/:id) require a `version` field in the body; a mismatch returns 409 Conflict with a clear message instructing the client to refresh and retry.

**Rationale:** The constraint is unenforceable without a version-aware contract. ETag/If-Match headers would be more RESTful but are heavier to implement and test. Inline version is pragmatic and self-documenting.

**Trade-off:** Adds one field to every ticket response (additive — existing fields unchanged). Mirrors how many production APIs handle this (e.g., Kubernetes resource versions).
---

Now build the Tickets module:

API contract (from README.md, follow literally):
- GET /tickets?projectId=:projectId → 200, Ticket[]. projectId is REQUIRED — return 400 if missing.
- GET /tickets/:ticketId → 200
- POST /tickets body { title, description?, status, priority, type, projectId, assigneeId?, dueDate? } → 200, returns created Ticket
- PATCH /tickets/:ticketId body { title?, description?, status?, priority?, assigneeId?, version } → 200, no body. version is REQUIRED.
- DELETE /tickets/:ticketId → 200, no body (soft delete — even DONE tickets can be soft-deleted; the "can't update DONE" rule applies only to PATCH)

Tasks:

1. Create three enum files in src/common/enums/:
   - ticket-status.enum.ts: TODO, IN_PROGRESS, IN_REVIEW, DONE
   - ticket-priority.enum.ts: LOW, MEDIUM, HIGH, CRITICAL
   - ticket-type.enum.ts: BUG, FEATURE, TECHNICAL

2. Create src/tickets/entities/ticket.entity.ts:
   - id: number, PK, generated
   - title: string, length 200, not null
   - description: text, nullable
   - status: TicketStatus, postgres enum type, not null, default TODO
   - priority: TicketPriority, postgres enum type, not null, default MEDIUM
   - type: TicketType, postgres enum type, not null
   - projectId: number, with @ManyToOne(() => Project, { eager: false }) @JoinColumn({ name: 'project_id' }) — FK to projects.id. Add an index on projectId (heavily filtered).
   - assigneeId: number | null, nullable, with @ManyToOne(() => User, { eager: false }) @JoinColumn({ name: 'assignee_id' })
   - dueDate: Date | null, nullable, type 'timestamptz', column 'due_date'  (Phase 4 will read this; we just create the column now)
   - isOverdue: boolean, default false, column 'is_overdue' (Phase 4 will write this)
   - deletedAt: Date | null, nullable, type 'timestamptz', column 'deleted_at', indexed
   - version: integer, @VersionColumn() (TypeORM auto-increments on save; powers optimistic locking)
   - createdAt, updatedAt via @CreateDateColumn / @UpdateDateColumn

3. Create src/tickets/status-transitions.ts as a pure module — easy to unit test in isolation:
   - export const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> mapping each status to its allowed next states per D5.
   - export function isValidTransition(from: TicketStatus, to: TicketStatus): boolean

4. Create DTOs in src/tickets/dto/:
   - create-ticket.dto.ts:
       title @IsString @Length(1,200)
       description @IsOptional @IsString
       status @IsEnum(TicketStatus)
       priority @IsEnum(TicketPriority)
       type @IsEnum(TicketType)
       projectId @IsInt @IsPositive
       assigneeId @IsOptional @IsInt @IsPositive
       dueDate @IsOptional @IsDateString  (kept as string in DTO; service converts via new Date())
   - update-ticket.dto.ts:
       title @IsOptional @IsString @Length(1,200)
       description @IsOptional @IsString
       status @IsOptional @IsEnum(TicketStatus)
       priority @IsOptional @IsEnum(TicketPriority)
       assigneeId @IsOptional @IsInt @IsPositive  (use a separate dueDate handling later if needed; spec doesn't allow updating type)
       version @IsInt @IsPositive  (REQUIRED — no @IsOptional)
   - ticket-response.dto.ts: static from(ticket): { id, title, description, status, priority, type, projectId, assigneeId, dueDate (ISO string or null), isOverdue, version }

5. Create src/tickets/tickets.service.ts:
   - Constructor injects @InjectRepository(Ticket), ProjectsService, UsersService
   - findAllByProject(projectId): verify project exists (projectsService.findOne throws 404 if missing/deleted — let that propagate). Return tickets where projectId matches AND deletedAt IS NULL, mapped to response DTOs.
   - findOne(id): the ticket where id matches AND deletedAt IS NULL, throws NotFoundException otherwise.
   - create(dto):
       - Verify project exists (projectsService.findOne — let 404 propagate, OR repackage as BadRequest with "Project does not exist" — choose BadRequest for create, since the project is referenced input)
       - If assigneeId provided, verify the user exists (usersService.findOne — repackage as BadRequest "Assignee user does not exist")
       - Convert dueDate string to Date if provided
       - Persist, return response DTO
   - update(id, dto):
       - Load the ticket (non-deleted) — throw NotFoundException if missing
       - If current status is DONE: throw ConflictException with message "Ticket is DONE and cannot be modified"
       - If dto.version !== ticket.version: throw ConflictException "Ticket was modified by another request; refresh and retry"
       - If dto.status provided and !== current status: validate via isValidTransition — throw BadRequestException "Invalid status transition from X to Y" if not allowed
       - If dto.assigneeId provided (and not null), verify the user exists (BadRequest if not)
       - Apply provided fields, save (TypeORM will increment version atomically; if there's a concurrent save between our load and save, save() throws OptimisticLockVersionMismatchError — catch and convert to the same ConflictException)
   - softDelete(id):
       - Load non-deleted ticket — throw NotFoundException if missing
       - Set deletedAt = new Date(), save (version increments — that's fine)
       - Note: soft-delete IS allowed on DONE tickets per D5 (the "can't update DONE" rule applies to PATCH only)

6. Create src/tickets/tickets.controller.ts:
   - GET / with @Query('projectId', ParseIntPipe) projectId → findAllByProject. (ParseIntPipe on a query string param will reject "missing" with 400 automatically.)
   - GET /:ticketId (ParseIntPipe) → findOne
   - POST / @HttpCode(200) → create, returns response DTO
   - PATCH /:ticketId @HttpCode(200) → update, returns nothing
   - DELETE /:ticketId @HttpCode(200) → softDelete, returns nothing

7. Create src/tickets/tickets.module.ts:
   - imports: TypeOrmModule.forFeature([Ticket]), ProjectsModule, UsersModule
   - exports: TicketsService (Comments module and Phase 3 dependencies will need it)

8. Register TicketsModule in AppModule.

9. Tests in src/tickets/status-transitions.spec.ts (pure unit, no Nest):
   - All 4 valid forward transitions work
   - All same-status transitions work (TODO→TODO, etc.)
   - All 6 backward transitions are rejected
   - All 3 skip-forward transitions (TODO→IN_REVIEW, TODO→DONE, IN_PROGRESS→DONE) are rejected

10. Tests in src/tickets/tickets.service.spec.ts (mock repo + ProjectsService + UsersService):
    - create() throws BadRequest when project missing
    - create() throws BadRequest when assignee missing (but only if provided)
    - create() persists and returns response DTO with version field
    - update() throws Conflict when status is DONE
    - update() throws Conflict when version mismatch
    - update() throws BadRequest on invalid status transition
    - update() succeeds on valid forward transition
    - softDelete() works even when status is DONE

11. End-to-end verification (assume user id=1 exists; create a fresh project first):
    a. Login, capture token
    b. POST /projects { name, description, ownerId: 1 } → grab projectId
    c. POST /tickets { title: "Test", status: "TODO", priority: "HIGH", type: "BUG", projectId } → 200, version=1
    d. GET /tickets?projectId=<id> → 200, array of one
    e. GET /tickets (no projectId) → 400
    f. PATCH /tickets/<id> { status: "IN_PROGRESS", version: 1 } → 200
    g. GET /tickets/<id> → status=IN_PROGRESS, version=2
    h. PATCH /tickets/<id> { status: "IN_REVIEW", version: 1 } → 409 (stale version)
    i. PATCH /tickets/<id> { status: "TODO", version: 2 } → 400 (backward)
    j. PATCH /tickets/<id> { status: "DONE", version: 2 } → 400 (skip)
    k. PATCH /tickets/<id> { status: "IN_REVIEW", version: 2 } → 200
    l. PATCH /tickets/<id> { status: "DONE", version: 3 } → 200
    m. PATCH /tickets/<id> { title: "Updated", version: 4 } → 409 (DONE can't be modified)
    n. DELETE /tickets/<id> → 200 (soft-delete works on DONE)
    o. GET /tickets/<id> → 404
    p. POST /tickets with projectId: 9999 → 400 "Project does not exist"
    q. POST /tickets with assigneeId: 9999 → 400 "Assignee user does not exist"

Show me: all new files, the AppModule diff, the spec outputs, and all 17 curl results.

Do NOT build the Comments module yet — that's the next step.

---

### Prompt 8 — Comments Module (Author Authorization + Optimistic Locking)

**Goal:** Build the Comments module with JWT-derived authorId (D7), author-or-admin edit/delete authorization (D8), optimistic locking, and hard delete. Phase 4 mention wiring is scaffolded but left for later.

**Prompt:**

Phase 2, Step 3 (final Phase 2 step): build the Comments module. Read CLAUDE.md and DECISIONS.md for conventions and prior decisions. Users, Projects, and Tickets modules are complete — follow their patterns.

First, append D7 and D8 to DECISIONS.md:

---
## D7: Comment authorId is derived from the JWT, not the request body

**Context:** Spec section 2.5 says "Add a comment to a ticket with: content and authorId." Taken as an API contract, this would let any authenticated user post comments as any other user by spoofing authorId in the body.

**Decision:** Treat the spec's "content and authorId" as describing the *stored fields*, not the request shape. The request body contains only `content`. authorId is set server-side from the authenticated JWT (`req.user.sub`). Any `authorId` field in the body is silently ignored (or rejected by forbidNonWhitelisted).

**Rationale:** Eliminates an obvious impersonation vector. Matches how every production comment system works. Aligns with the principle that identity is established at the auth layer, not the data layer.

**Trade-off:** None of substance. The persisted record still has authorId; it's just sourced correctly.

---
## D8: Comment edit and delete are restricted to the author or any ADMIN

**Context:** Spec section 2.5 lists "Update the content of an existing comment" and "Delete a comment" but does not specify who may perform these actions.

**Decision:** PATCH /comments/:id and DELETE /comments/:id are allowed only when the requesting user is the comment's author OR has role ADMIN. All other authenticated users receive 403 Forbidden.

**Rationale:** Default-permissive (any authenticated user can modify any comment) is surprising and inconsistent with every comment system in production. Author-or-admin matches the principle of least privilege while keeping moderation paths open.

**Trade-off:** Adds a small permission check in CommentsService. Phase 4's ADMIN-only soft-delete restore endpoints will share the same RolesGuard pattern.
---

API contract (the README's middle section was truncated for comments; using standard REST nested-then-flat conventions):
- POST /tickets/:ticketId/comments body { content } → 200, returns created Comment
- GET /tickets/:ticketId/comments → 200, Comment[]
- PATCH /comments/:commentId body { content, version } → 200, no body
- DELETE /comments/:commentId → 200, no body (HARD delete — soft-delete applies only to tickets and projects per spec section 3.5)

Tasks:

1. Create src/comments/entities/comment.entity.ts:
   - id: number, PK, generated
   - ticketId: number, with @ManyToOne(() => Ticket, { eager: false }) @JoinColumn({ name: 'ticket_id' }), indexed (heavily filtered by ticket)
   - authorId: number, with @ManyToOne(() => User, { eager: false }) @JoinColumn({ name: 'author_id' })
   - content: text, not null, max length enforced at DTO layer (5000 chars)
   - version: @VersionColumn() for optimistic locking per D6 pattern
   - createdAt, updatedAt via @CreateDateColumn / @UpdateDateColumn

2. Create DTOs in src/comments/dto/:
   - create-comment.dto.ts:
       content @IsString @Length(1,5000)
       (NO authorId field — D7. forbidNonWhitelisted will reject any client attempt.)
   - update-comment.dto.ts:
       content @IsString @Length(1,5000)
       version @IsInt @IsPositive  (REQUIRED)
   - comment-response.dto.ts: static from(comment): { id, ticketId, authorId, content, version, createdAt, updatedAt }
     (Phase 4 will add mentionedUsers array per spec 3.6 — leave a comment in the file noting this.)

3. Create src/comments/comments.service.ts:
   - Constructor injects @InjectRepository(Comment) and TicketsService
   - findAllByTicket(ticketId): verify ticket exists (let ticketsService.findOne throw 404 — propagate). Return all comments for that ticket ordered by createdAt ASC.
   - create(ticketId, authorId, dto): verify ticket exists (propagate 404). Persist with content, ticketId, authorId. Return response DTO.
   - update(id, dto, currentUserId, currentUserRole): 
       - Load comment; throw NotFoundException if missing
       - Authorization check (D8): if comment.authorId !== currentUserId AND currentUserRole !== 'ADMIN', throw ForbiddenException "You may only modify your own comments"
       - Version check (D6 pattern): if dto.version !== comment.version, throw ConflictException "Comment was modified by another request; refresh and retry"
       - Apply content, save (catch OptimisticLockVersionMismatchError → same ConflictException for the race-condition case)
   - remove(id, currentUserId, currentUserRole):
       - Load comment; throw NotFoundException if missing
       - Same authorization check as update
       - Hard-delete via repo.remove() (or repo.delete by id — either works; remove() is more explicit about loading first)

4. Create src/comments/comments.controller.ts:
   - @Controller() with NO prefix — we have two different URL roots (/tickets/:id/comments and /comments/:id), so prefix each method explicitly:
     - @Post('tickets/:ticketId/comments') @HttpCode(200) → calls service.create with ticketId from param, authorId from @CurrentUser().sub, body dto
     - @Get('tickets/:ticketId/comments') → calls service.findAllByTicket
     - @Patch('comments/:commentId') @HttpCode(200) → calls service.update with id, dto, current user's sub, current user's role
     - @Delete('comments/:commentId') @HttpCode(200) → calls service.remove with id, current user's sub, current user's role
   - All :id params use ParseIntPipe

5. Create src/comments/comments.module.ts:
   - imports: TypeOrmModule.forFeature([Comment]), TicketsModule
   - exports: CommentsService (Phase 4 mentions feature may need it)

6. Register CommentsModule in AppModule.

7. Tests in src/comments/comments.service.spec.ts (mock repo + TicketsService):
   - create() throws NotFound when ticket missing
   - create() persists when ticket exists, returns response DTO with version=1
   - update() throws Forbidden when caller is not author and not ADMIN
   - update() succeeds when caller is author
   - update() succeeds when caller is ADMIN (even if not author)
   - update() throws Conflict on stale version
   - remove() throws Forbidden when caller is not author and not ADMIN
   - remove() succeeds when caller is author

8. End-to-end verification:
   Set up: create two DEVELOPER users (devA, devB) and one ADMIN user (admin1) via POST /users. Login as devA, create a project, create a ticket. Capture: tokenA, tokenB (login as devB), tokenAdmin (login as admin1), ticketId.

   Then:
   a. POST /tickets/<ticketId>/comments { content: "First comment" } with tokenA → 200, capture commentId, version=1
   b. POST same with body { content: "x", authorId: 999 } → 400 (forbidNonWhitelisted rejects extra field, proving D7)
   c. GET /tickets/<ticketId>/comments with tokenA → 200, array with the comment
   d. PATCH /comments/<commentId> { content: "Updated", version: 1 } with tokenA → 200 (author updates own)
   e. PATCH /comments/<commentId> { content: "Hacked", version: 2 } with tokenB → 403 "You may only modify your own comments"
   f. PATCH /comments/<commentId> { content: "Mod edit", version: 2 } with tokenAdmin → 200 (admin can edit anyone's)
   g. PATCH /comments/<commentId> { content: "Stale", version: 1 } with tokenA → 409 (stale version after admin edit)
   h. DELETE /comments/<commentId> with tokenB → 403 (not author, not admin)
   i. DELETE /comments/<commentId> with tokenA → 200 (author deletes own)
   j. GET /tickets/<ticketId>/comments → empty array
   k. POST /tickets/99999/comments { content: "x" } with tokenA → 404 (ticket doesn't exist)

Show me: all new files, the AppModule diff, the spec output, and all 11 curl results.

This completes Phase 2. Confirm at the end: "Phase 2 complete — Projects, Tickets, Comments all functional with soft-delete, optimistic locking, and authorization where applicable."

---

## Phase 3: Extended Features (Audit log, Dependencies, Attachments, CSV)

### Prompt 9 — Audit Log + RolesGuard

**Goal:** Build the audit log infrastructure (entity, append-only service, ADMIN-only query endpoint), RolesGuard + @Roles() decorator, and wire audit logging into all four existing state-changing services (D9, D10).

**Prompt:**

Fresh phase context: read CLAUDE.md and DECISIONS.md. Phase 2 is complete — Users, Projects, Tickets, Comments are functional. Phase 3 adds extended features. This is Phase 3, Step 1.

Build:
1. Audit log infrastructure (entity, service, ADMIN-only query endpoint)
2. RolesGuard + @Roles() decorator (reused by audit and by Phase 4 soft-delete restore endpoints)
3. Wire audit logging into every state-changing method across Users, Projects, Tickets, Comments

First add D9 and D10 to DECISIONS.md:

---
## D9: Audit log uses direct service calls, not events

**Context:** Spec section 3.1 requires recording all state-changing actions. Two architectural patterns exist: event-driven (services emit events, audit service listens) or direct calls (services explicitly invoke audit service).

**Decision:** Direct calls. Each state-changing service method calls `auditLog.log(...)` after a successful persist. AuditLogService catches its own errors internally so a logging failure never causes the business operation to fail.

**Rationale:** Direct calls keep the audit context explicit and obvious in the code that produces it. Event-driven would decouple cleanly but adds infrastructure (event types, handlers, error semantics) without commensurate benefit at this scope. Future change to events is straightforward if needed.

**Trade-off:** Tight coupling: every state-changing service has AuditLogService as a dependency. Acceptable — the dependency is narrow (one method: `log`).

---
## D10: Audit log is append-only at the API level

**Context:** Spec section 3.1 specifies "persistent, append-only" audit log.

**Decision:** The audit log controller exposes only GET. There are no PATCH, DELETE, or PUT endpoints for audit entries. Entries are written internally by services; reads are ADMIN-only.

**Rationale:** Append-only is enforced by simply not exposing mutation endpoints. A database-level constraint or trigger would be additional defense in depth but adds operational complexity for marginal benefit.

**Trade-off:** A bug in the codebase could technically write garbage entries (or none). Mitigated by tests that verify audit entries are created for each state-changing action.
---

Now build:

PART 1 — RolesGuard infrastructure (reusable across modules):

1. Create src/common/decorators/roles.decorator.ts:
   export const ROLES_KEY = 'roles';
   export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

2. Create src/common/guards/roles.guard.ts:
   - Implements CanActivate
   - Constructor injects Reflector
   - canActivate(): read ROLES_KEY metadata from handler. If absent, allow (no role restriction).
     Get req.user.role from request (set by JwtStrategy). If user.role not in allowed roles, throw ForbiddenException with message "Insufficient role; required: ADMIN" (or similar — keep generic).

3. RolesGuard is applied per-controller-method via @UseGuards(RolesGuard) + @Roles(UserRole.ADMIN). Do NOT make it global — it's opt-in for endpoints that need it.

PART 2 — Audit log module:

4. Create src/audit-log/audit-action.enum.ts:
   export enum AuditAction {
     USER_CREATED, USER_UPDATED, USER_DELETED,
     PROJECT_CREATED, PROJECT_UPDATED, PROJECT_DELETED,
     TICKET_CREATED, TICKET_UPDATED, TICKET_DELETED,
     COMMENT_CREATED, COMMENT_UPDATED, COMMENT_DELETED,
   }
   (Use string-valued enum — 'USER_CREATED' = 'USER_CREATED' — so DB values are readable. Phase 4 will add AUTO_ASSIGN and AUTO_ESCALATE.)

   Also: export enum AuditActorType { USER = 'USER', SYSTEM = 'SYSTEM' }
   export enum AuditResourceType { USER, PROJECT, TICKET, COMMENT }  (string-valued)

5. Create src/audit-log/entities/audit-log.entity.ts:
   - id: number, PK
   - actorType: AuditActorType (postgres enum)
   - actorId: number | null (nullable — null for SYSTEM)
   - action: AuditAction (postgres enum)
   - resourceType: AuditResourceType (postgres enum)
   - resourceId: number
   - metadata: jsonb (type: 'jsonb', nullable: true) — flexible payload
   - createdAt via @CreateDateColumn (timestamptz)
   - Index on (resourceType, resourceId) for "history of this ticket" lookups
   - Index on actorId for "what did this user do" lookups
   - Index on createdAt for time-range queries

6. Create src/audit-log/audit-log.service.ts:
   - Constructor injects @InjectRepository(AuditLog)
   - log(params: { actorType, actorId, action, resourceType, resourceId, metadata? }): Promise<void>
     - Wrap the save in try/catch — on error, console.error('Audit log write failed', err) but do NOT rethrow. Business operation must not fail because audit failed.
   - query(filter: AuditLogQueryDto): paginated results, sorted by createdAt DESC

7. Create src/audit-log/dto/audit-log-query.dto.ts (all optional, AND'd together):
   - actorType @IsOptional @IsEnum(AuditActorType)
   - actorId @IsOptional @Type(() => Number) @IsInt
   - action @IsOptional @IsEnum(AuditAction)
   - resourceType @IsOptional @IsEnum(AuditResourceType)
   - resourceId @IsOptional @Type(() => Number) @IsInt
   - page @IsOptional @Type(() => Number) @IsInt @Min(1) (default 1)
   - pageSize @IsOptional @Type(() => Number) @IsInt @Min(1) @Max(100) (default 50)

8. Create src/audit-log/audit-log.controller.ts:
   - GET /audit-logs with @Query() AuditLogQueryDto
   - Guarded: @UseGuards(RolesGuard) @Roles(UserRole.ADMIN) — ADMIN only
   - Returns { data: AuditLog[], total: number, page: number, pageSize: number }

9. Create src/audit-log/audit-log.module.ts:
   - imports: TypeOrmModule.forFeature([AuditLog])
   - providers: AuditLogService
   - controllers: AuditLogController
   - exports: AuditLogService (so other modules can inject it)

10. Register AuditLogModule in AppModule (BEFORE the modules that need it as a dependency — TypeScript module order doesn't matter at runtime, but list it before Users for readability).

PART 3 — Wire audit logging into existing services:

11. Inject AuditLogService into each of: UsersService, ProjectsService, TicketsService, CommentsService. For each, add the AuditLogModule import to its module's `imports` array.

12. In each state-changing method, AFTER a successful persist, call `auditLog.log({ ... })`. The actorType/actorId comes from the caller (controller passes through @CurrentUser()). For methods that don't currently receive the caller (most don't), update the signature to accept a `requester: { sub: number }` (or { sub, role } where needed) and have the controller pass @CurrentUser().

    Actions to log:
    - UsersService.create → USER_CREATED, resourceId = new user's id, metadata: { username, role }. For public signup (no requester), use actorType: USER and actorId equal to the new user's own id (self-action).
    - UsersService.update → USER_UPDATED, metadata: the dto applied
    - UsersService.remove → USER_DELETED
    - ProjectsService.create → PROJECT_CREATED, metadata: { name, ownerId }
    - ProjectsService.update → PROJECT_UPDATED, metadata: dto applied
    - ProjectsService.softDelete → PROJECT_DELETED
    - TicketsService.create → TICKET_CREATED, metadata: { title, projectId, status, priority, type, assigneeId }
    - TicketsService.update → TICKET_UPDATED, metadata: { changes: <the dto fields that changed, with old→new where it matters, especially for status> }
    - TicketsService.softDelete → TICKET_DELETED
    - CommentsService.create → COMMENT_CREATED, metadata: { ticketId, contentLength: content.length } (don't log full content for privacy; the source-of-truth is the comments table itself)
    - CommentsService.update → COMMENT_UPDATED, metadata: { ticketId }
    - CommentsService.remove → COMMENT_DELETED, metadata: { ticketId, formerAuthorId }

13. Important: audit log entries must include actorType. For all user-initiated actions, actorType = USER and actorId = requester.sub. SYSTEM is reserved for Phase 4 (auto-escalation, auto-assignment).

PART 4 — Tests:

14. src/audit-log/audit-log.service.spec.ts (mock repo):
    - log() persists with the given params
    - log() swallows repo errors (does NOT throw) — verify console.error called, function resolves
    - query() applies filter clauses (verify the find/findAndCount call args)

15. Update existing service specs to mock AuditLogService. Add at least one assertion per service: "audit.log was called after successful create" — confirms wiring is in place. (Don't make existing tests pass-or-fail on audit; just one focused test per service.)

PART 5 — End-to-end verification:

Assume admin user 'carol' (ADMIN) and developer 'alice' (DEVELOPER) exist from Phase 2 tests.

a. Login as alice, capture aliceToken
b. POST /projects { name: "AuditTest", description: "...", ownerId: alice.id } as alice
c. POST /tickets { ... projectId: <new> } as alice → ticket created
d. PATCH /tickets/<id> { status: "IN_PROGRESS", version: 1 } as alice
e. Login as carol (ADMIN), capture carolToken
f. GET /audit-logs as carol → 200, returns at minimum: PROJECT_CREATED, TICKET_CREATED, TICKET_UPDATED entries from steps b/c/d, plus all user creations from earlier in the test run
g. GET /audit-logs?action=TICKET_UPDATED&resourceId=<ticketId> as carol → 200, filtered to just that update with metadata.changes.status = { from: 'TODO', to: 'IN_PROGRESS' }
h. GET /audit-logs as alice (DEVELOPER) → 403 Forbidden (RolesGuard working)
i. GET /audit-logs?page=1&pageSize=5 as carol → 200, max 5 entries, total reflects real count

Show me: all new files, the diffs to existing services and modules, the spec output (total test count should jump), and all 9 curl outputs.

This completes Phase 3 Step 1. The audit log is the foundation that the rest of Phase 3 and Phase 4 also write to.

---

### Prompt 10 — Ticket Dependencies

**Goal:** Build ticket dependencies — TicketDependency join entity, dependency CRUD endpoints with self-block and direct-cycle detection (D11), and the DONE-transition blocker check in TicketsService.

**Prompt:**

Fresh phase context: read CLAUDE.md and DECISIONS.md. Phase 3 Step 1 (audit log) is complete and wired into all four core services. This is Phase 3, Step 2: ticket dependencies.

First add D11 to DECISIONS.md:

---
## D11: Direct cycles rejected; transitive cycles allowed

**Context:** Spec section 3.2 specifies dependencies between tickets but is silent on cycle detection. A cycle in the dependency graph creates a deadlock (no ticket in the cycle can ever go DONE).

**Decision:** Reject self-blocking (A blocked by A) and direct cycles (A blocked by B + B blocked by A). Transitive cycles (A→B→C→A) are NOT detected — too expensive to enforce on every dependency add, and a real-world admin can untangle them.

**Rationale:** Direct cycles are the most common foot-gun and are detectable with a single query. Transitive cycle detection requires graph traversal on every insert; cost grows with graph size. The DONE-blocking rule still applies, so a transitive cycle simply leaves the cycle's tickets unable to move to DONE — visible and fixable, not silent corruption.

**Trade-off:** A misuse can still create a transitive deadlock. Acceptable — fixable via DELETE on any dependency in the cycle.
---

API contract (from spec section 3.2):
- POST /tickets/:ticketId/dependencies body { blockedBy: 42 } → 200, ticket :ticketId is now blocked by ticket 42
- GET /tickets/:ticketId/dependencies → 200, returns the array of blocker tickets (full ticket objects)
- DELETE /tickets/:ticketId/dependencies/:blockerId → 200, no body

Constraints (mix of spec and D11):
- Both tickets must exist and not be soft-deleted (404 otherwise)
- Both tickets must belong to the same project (400)
- Self-blocking rejected (400)
- Direct cycle rejected (400)
- Duplicate dependency rejected (409)
- A ticket cannot transition to DONE if it has any blockers whose status !== DONE — 409 Conflict with message listing the blocker IDs

Tasks:

1. Create src/tickets/entities/ticket-dependency.entity.ts:
   - id: number, PK
   - ticketId: number, @ManyToOne(() => Ticket, { eager: false }) @JoinColumn({ name: 'ticket_id' }), indexed
   - blockerId: number, @ManyToOne(() => Ticket, { eager: false }) @JoinColumn({ name: 'blocker_id' })
   - createdAt via @CreateDateColumn
   - Add @Unique(['ticketId', 'blockerId']) — DB-level uniqueness as the source of truth for duplicate detection
   - Add @Index on (ticketId) for "blockers of this ticket" queries
   - Add @Index on (blockerId) for "what does this ticket block" queries

2. Add new audit actions to src/audit-log/audit-action.enum.ts (extend the existing AuditAction enum):
   - DEPENDENCY_ADDED = 'DEPENDENCY_ADDED'
   - DEPENDENCY_REMOVED = 'DEPENDENCY_REMOVED'

3. Create src/tickets/dto/add-dependency.dto.ts:
   - blockedBy @IsInt @IsPositive

4. Create src/tickets/ticket-dependencies.service.ts (keep separate from TicketsService — clean separation, easier to test, but in the same module):
   - Constructor injects @InjectRepository(TicketDependency), TicketsRepository (re-inject from TypeOrmModule.forFeature), AuditLogService
   - Note: don't depend on TicketsService here — that would create a circular dependency. Use the Ticket repository directly. Add a private helper findActiveTicket(id) that mirrors TicketsService.findOne's filter (id matches AND deletedAt IS NULL, NotFound otherwise).
   - addDependency(ticketId, blockedBy, requesterSub):
       - Reject if ticketId === blockedBy → BadRequest "A ticket cannot block itself"
       - Find both tickets (NotFound propagates per D3)
       - If their projectIds differ → BadRequest "Dependency tickets must belong to the same project"
       - Check direct cycle: SELECT 1 FROM ticket_dependencies WHERE ticketId = blockedBy AND blockerId = ticketId — if exists → BadRequest "Direct cycle detected: ticket {blockedBy} is already blocked by ticket {ticketId}"
       - Insert. Catch Postgres 23505 → ConflictException "Dependency already exists"
       - Audit DEPENDENCY_ADDED { actorType: USER, actorId: requesterSub, resourceType: TICKET, resourceId: ticketId, metadata: { blockedBy } }
   - listDependencies(ticketId):
       - Verify ticket exists (NotFound propagates)
       - Find all dependencies where ticketId matches; for each, fetch the blocker ticket
       - Return TicketResponseDto[] of the blockers
   - removeDependency(ticketId, blockerId, requesterSub):
       - Verify ticket exists (NotFound propagates)
       - Delete by composite (ticketId, blockerId). If affected === 0 → NotFoundException "Dependency not found"
       - Audit DEPENDENCY_REMOVED { ... metadata: { blockedBy: blockerId } }
   - getUnresolvedBlockers(ticketId): Ticket[] — used by TicketsService when checking DONE transition. Returns blocker tickets whose status !== DONE AND deletedAt IS NULL.

5. Modify TicketsService.update — add a check before applying the status change:
   - When the requested transition is to DONE specifically:
     - Call ticketDependenciesService.getUnresolvedBlockers(ticketId)
     - If non-empty → ConflictException "Cannot mark ticket as DONE; unresolved blockers: [<comma-separated blocker IDs>]"
   - Inject TicketDependenciesService into TicketsService. This is the one new cross-service dependency. Wire it via the same module (TicketsModule) so there's no module-level circular import.

6. Create src/tickets/ticket-dependencies.controller.ts (separate controller in the tickets module):
   - POST 'tickets/:ticketId/dependencies' @HttpCode(200) → addDependency, returns nothing (or a small ack body — your choice; spec is silent. Return { ticketId, blockedBy } for clarity.)
   - GET 'tickets/:ticketId/dependencies' → listDependencies
   - DELETE 'tickets/:ticketId/dependencies/:blockerId' @HttpCode(200) → removeDependency

7. Update src/tickets/tickets.module.ts:
   - Add TicketDependency to TypeOrmModule.forFeature
   - Add TicketDependenciesService to providers (and export if Phase 4 needs it — probably not)
   - Add TicketDependenciesController to controllers

8. Tests in src/tickets/ticket-dependencies.service.spec.ts (mock repos + AuditLogService):
   - addDependency rejects self-block (ticketId === blockedBy) → BadRequest
   - addDependency rejects cross-project → BadRequest
   - addDependency rejects direct cycle → BadRequest
   - addDependency rejects duplicate → Conflict (mock the 23505 Postgres error)
   - addDependency succeeds for valid case; audit log called
   - getUnresolvedBlockers returns only blockers whose status !== DONE
   - removeDependency returns NotFound when no rows affected

9. Update src/tickets/tickets.service.spec.ts:
   - Mock TicketDependenciesService
   - Add test: update() to DONE throws Conflict when getUnresolvedBlockers returns non-empty
   - Add test: update() to DONE succeeds when getUnresolvedBlockers returns empty
   - Add test: update() to IN_REVIEW (non-DONE) does NOT call getUnresolvedBlockers (no need to check blockers for non-DONE transitions)

10. End-to-end verification:
    Setup: alice (DEVELOPER) exists, two projects, three tickets:
    - Project P1: ticket T1 (TODO) and T2 (TODO)
    - Project P2: ticket T3 (TODO)
    Login as alice.

    a. POST /tickets/T1/dependencies { blockedBy: T1 } → 400 "cannot block itself"
    b. POST /tickets/T1/dependencies { blockedBy: T3 } → 400 "must belong to the same project"
    c. POST /tickets/T1/dependencies { blockedBy: T2 } → 200 (T1 blocked by T2)
    d. POST /tickets/T1/dependencies { blockedBy: T2 } again → 409 "Dependency already exists"
    e. POST /tickets/T2/dependencies { blockedBy: T1 } → 400 "Direct cycle detected"
    f. GET /tickets/T1/dependencies → 200, array containing T2 (full ticket DTO)
    g. Move T1 forward: PATCH T1 to IN_PROGRESS → 200 (non-DONE transitions ignore blockers)
    h. Move T1: IN_REVIEW (200), then PATCH to DONE → 409 "unresolved blockers: [T2]"
    i. Move T2 through to DONE (TODO→IN_PROGRESS→IN_REVIEW→DONE)
    j. PATCH T1 to DONE → 200 (all blockers resolved)
    k. DELETE /tickets/T1/dependencies/T2 → 200
    l. GET /tickets/T1/dependencies → 200, []
    m. As ADMIN, GET /audit-logs?action=DEPENDENCY_ADDED → entry present
    n. As ADMIN, GET /audit-logs?action=DEPENDENCY_REMOVED → entry present

Show me: all new files, the diffs to TicketsService and TicketsModule, the spec output (count should jump again), and all 14 curl results.

---

### Prompt 11 — Attachments + CSV Export/Import

**Goal:** Build file attachment handling (multer/diskStorage, MIME type and 10 MB size validation, local filesystem storage per D12) and CSV export/import for bulk ticket operations (per-row best-effort semantics per D13).

**Prompt:**

Fresh Claude Code session. Read CLAUDE.md and DECISIONS.md before starting. Phase 3 Steps 1 and 2 are complete (audit log + ticket dependencies). This prompt covers Phase 3 Steps 3 and 4 — two independent features shipped together:

PART 1: Attachments (spec section 3.3)
PART 2: CSV export/import for tickets (spec section 3.4)

Build them sequentially: Attachments first end-to-end (entity → service → controller → module → tests), then CSV. Do not interleave the two features.

First, append D12 and D13 to DECISIONS.md:

---
## D12: Attachments stored on local filesystem under ./uploads/

**Context:** Spec section 3.3 requires file attachments but does not specify storage backend.

**Decision:** Files are persisted to `./uploads/` (relative to the application working directory) with UUIDv4 filenames; the original user-supplied filename is preserved in the database column `filename`, the disk filename is stored in `storedName`. No extension is appended to the disk file — the MIME type is the source of truth and lives in the DB.

**Rationale:** Simplest persistent storage with no external dependencies. UUID filenames eliminate collisions and path-traversal attack vectors. Decoupling original filename from disk filename allows safe display while sanitizing what hits the filesystem.

**Trade-off:** Files do not survive container/instance replacement and are not shared across instances. Production would use object storage (S3, GCS, Azure Blob) via a thin adapter. The current implementation is a single-instance development pattern.

---
## D13: CSV import is per-row best-effort, not transactional

**Context:** Spec section 3.4 shows the import response as `{ created: 42, failed: 3, errors: [...] }`, implying partial success is reported. The spec does not specify transactional semantics.

**Decision:** Each row is validated and persisted independently. Successful rows are committed; failed rows produce error entries with `{ row: <1-based row number>, error: <message> }`. The response summary reports counts of both.

**Rationale:** Matches the spec's response shape literally. Transactional all-or-nothing semantics would force the user to fix every error before any data lands — bad UX for bulk migration scenarios. Partial success is the industry norm for bulk import (matches Stripe, Salesforce, Jira import flows).

**Trade-off:** A malformed file can result in mixed state. Mitigated by per-row error reporting so the caller knows exactly which rows did and did not persist.
---

Add new audit actions to src/audit-log/audit-action.enum.ts:
   ATTACHMENT_ADDED = 'ATTACHMENT_ADDED'
   ATTACHMENT_REMOVED = 'ATTACHMENT_REMOVED'

Add ATTACHMENT to AuditResourceType enum.

Add ./uploads/ to .gitignore.

============================================================
PART 1 — ATTACHMENTS
============================================================

Spec section 3.3 constraints (enforce literally):
- Max file size: 10 MB. Uploads exceeding this rejected.
- Allowed MIME: image/png, image/jpeg, application/pdf, text/plain. Reject all others.

API contract (from README.md):
- POST /tickets/:ticketId/attachments multipart/form-data: `file` → 200, { id, ticketId, filename, contentType }
- DELETE /tickets/:ticketId/attachments/:attachmentId → 200, no body

Minor extension (justified): GET /tickets/:ticketId/attachments → 200, array of { id, ticketId, filename, contentType, size, uploadedById, createdAt }. Any UI integration needs list-by-ticket; the spec is silent rather than prohibitive. Not adding a download endpoint — the spec doesn't require one.

Tasks:

1. Create src/attachments/entities/attachment.entity.ts:
   - id: number, PK
   - ticketId: number, @ManyToOne(() => Ticket, { eager: false }) @JoinColumn({ name: 'ticket_id' }), indexed
   - filename: varchar(255), original user-supplied name (sanitized via path.basename)
   - storedName: varchar(64), the UUID used as the actual disk filename
   - contentType: varchar(100), the MIME type from upload
   - size: bigint (use { type: 'bigint', transformer: { to: (v) => v, from: (v) => parseInt(v, 10) } } so it returns as a JS number; Postgres bigint comes back as a string by default)
   - uploadedById: number, @ManyToOne(() => User, { eager: false }) @JoinColumn({ name: 'uploaded_by_id' })
   - createdAt via @CreateDateColumn

2. Create src/attachments/dto/attachment-response.dto.ts: static from(attachment): the response shape per the spec. For GET list, include size, uploadedById, createdAt; for POST response, the spec only shows {id, ticketId, filename, contentType} — include only those four for POST. Have two factories: from() (full) and fromCreate() (minimal per spec).

3. Create src/attachments/attachments.service.ts:
   - Constructor injects @InjectRepository(Attachment), TicketsService (for ticket-exists validation), AuditLogService
   - On module init (use OnModuleInit lifecycle): ensure ./uploads/ directory exists via fs.mkdir({ recursive: true })
   - create(ticketId, file: Express.Multer.File, requesterSub):
       - Verify ticket exists and not soft-deleted (ticketsService.findOne — let 404 propagate)
       - The disk file is already written by multer (with UUID filename); persist the DB row with file.filename (UUID) as storedName, sanitized original as filename, mimetype as contentType, size, uploaderId.
       - sanitize original filename: import * as path from 'path'; const safeName = path.basename(file.originalname).replace(/[\x00-\x1f]/g, '').slice(0, 255);
       - Audit ATTACHMENT_ADDED { metadata: { ticketId, filename: safeName, contentType, size } }
       - Return fromCreate() — only {id, ticketId, filename, contentType}
   - listByTicket(ticketId):
       - Verify ticket exists
       - Return all attachments for that ticket, ORDER BY createdAt DESC, mapped via from()
   - remove(ticketId, attachmentId, requesterSub):
       - Verify ticket exists
       - Find attachment by id; throw NotFound if missing
       - Verify attachment.ticketId === ticketId (defense against ID-confusion attacks); throw NotFound if mismatch (don't leak existence of the attachment on a different ticket)
       - Delete the disk file at ./uploads/<storedName> — best-effort: catch fs errors and console.warn, do not fail the API call. The DB row is the source of truth; an orphaned disk file is preferable to a successful API call with a stale DB row.
       - Delete the DB row
       - Audit ATTACHMENT_REMOVED { metadata: { ticketId, filename, contentType } }

4. Create src/attachments/attachments.controller.ts:
   - @Controller() with full paths declared per method (matches the comments-controller pattern from Phase 2)
   - POST 'tickets/:ticketId/attachments' @HttpCode(200):
       - @UseInterceptors(FileInterceptor('file', {
           storage: diskStorage({
             destination: './uploads',
             filename: (req, file, cb) => cb(null, randomUUID()),  // import { randomUUID } from 'crypto'
           }),
           limits: { fileSize: 10 * 1024 * 1024 },
           fileFilter: (req, file, cb) => {
             const allowed = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'];
             if (allowed.includes(file.mimetype)) return cb(null, true);
             cb(new BadRequestException(`Unsupported file type: ${file.mimetype}. Allowed: ${allowed.join(', ')}`), false);
           },
         }))
       - @UploadedFile() file (no ParseFilePipe — multer's fileFilter already validated)
       - If no file provided (Multer didn't catch it), throw BadRequest "File is required"
       - Call service.create
   - GET 'tickets/:ticketId/attachments' → listByTicket
   - DELETE 'tickets/:ticketId/attachments/:attachmentId' @HttpCode(200) → remove

5. Create src/attachments/attachments.module.ts:
   - imports: TypeOrmModule.forFeature([Attachment]), TicketsModule, AuditLogModule
   - providers, controllers as expected

6. Register AttachmentsModule in AppModule.

7. Important: Multer's LIMIT_FILE_SIZE error is thrown asynchronously and isn't automatically converted to a clean 400 by Nest. Add a small exception filter or handle this via a global pipe. Simplest fix: register a global filter that maps MulterError instances to BadRequestException with a clear message. Create src/common/filters/multer-exception.filter.ts implementing ExceptionFilter, catching MulterError, returning 400 with appropriate message ('File too large' for LIMIT_FILE_SIZE; generic for others). Register globally in main.ts via app.useGlobalFilters() (alongside any existing filters).

8. Tests in src/attachments/attachments.service.spec.ts (mock repo + TicketsService + AuditLogService; mock fs.promises with jest.mock('fs/promises') or jest.spyOn):
   - create() throws if ticket missing (NotFound from TicketsService propagates)
   - create() persists with sanitized filename; audit called
   - remove() throws NotFound when attachment missing OR when attachment.ticketId !== route ticketId (verify both branches separately — the ID-confusion guard is security-relevant)
   - remove() proceeds even when fs.unlink rejects (filesystem error doesn't block API success)
   - listByTicket() returns mapped response DTOs

9. End-to-end verification for Part 1:
   Setup: alice (DEVELOPER) exists, one project, one ticket. Login as alice.

   a. Create a small PNG file locally: `printf '\x89PNG\r\n\x1a\n' > /tmp/tiny.png` (8-byte minimal PNG header — enough for content-type sniffing)
   b. POST /tickets/<id>/attachments with -F "file=@/tmp/tiny.png" → 200, returns { id, ticketId, filename: "tiny.png", contentType: "image/png" }
   c. GET /tickets/<id>/attachments → 200, array of one with full fields (id, ticketId, filename, contentType, size, uploadedById, createdAt)
   d. Confirm ./uploads/<uuid> exists on disk
   e. Try uploading a fake .exe: `echo "MZ" > /tmp/bad.exe; curl ... -F "file=@/tmp/bad.exe"` → 400 "Unsupported file type" (multer sniffs as application/octet-stream or similar — verify it gets rejected)
   f. Try uploading a >10MB file: `dd if=/dev/zero of=/tmp/big.bin bs=1M count=11 && curl ... -F "file=@/tmp/big.bin;type=image/png"` → 400 "File too large"
   g. DELETE /tickets/<id>/attachments/<attId> → 200, the disk file is gone
   h. GET /tickets/<id>/attachments → 200, empty array
   i. As ADMIN (carol), GET /audit-logs?action=ATTACHMENT_ADDED → entry present with metadata
   j. As ADMIN, GET /audit-logs?action=ATTACHMENT_REMOVED → entry present

============================================================
PART 2 — CSV EXPORT/IMPORT
============================================================

Spec section 3.4:
- GET /tickets/export?projectId={id} → CSV with fields: id, title, description, status, priority, type, assigneeId
- POST /tickets/import multipart/form-data: CSV file + `projectId` form field → { created, failed, errors }
- CSV format MUST handle commas and quotes inside field values correctly (RFC 4180-compliant, which csv-stringify and csv-parse handle by default with proper config)

Tasks:

1. Create src/tickets/tickets-import-export.service.ts:
   - Constructor injects @InjectRepository(Ticket), ProjectsService (for project-exists), TicketsService (for create — the import goes through normal create() so it inherits validation and audit logging)
   - exportProject(projectId): Promise<string>
       - Verify project exists (projectsService.findOne)
       - Fetch all tickets where projectId matches AND deletedAt IS NULL
       - Use csv-stringify (sync) with columns: ['id', 'title', 'description', 'status', 'priority', 'type', 'assigneeId'] and header: true
       - Return the CSV string
   - importProject(projectId, csvBuffer: Buffer, requesterSub): Promise<{ created: number, failed: number, errors: Array<{ row: number, error: string }> }>
       - Verify project exists
       - Parse with csv-parse (sync mode or promise mode): columns: true, skip_empty_lines: true, trim: true
       - For each parsed row (i, starting from index 0; the "row" in errors is i + 2 to account for header row + 1-based humans):
         - Construct a CreateTicketDto-compatible plain object: { title, description, status, priority, type, projectId: <forced from form field>, assigneeId: row.assigneeId ? parseInt(row.assigneeId, 10) : undefined, dueDate: row.dueDate || undefined }
           Note: even if the CSV has a projectId column, OVERRIDE it with the form's projectId. The form field is the contract; the CSV column is incidental data.
         - Run class-validator on it (use plainToInstance + validate from class-validator/class-transformer) to enforce the same rules as the regular create endpoint
         - If validation fails: push { row: i + 2, error: <first constraint message> } to errors, increment failed, continue
         - If validation passes: call ticketsService.create(...). If it throws (e.g., assignee missing), catch and push { row: i + 2, error: error.message }, increment failed, continue
         - If create succeeds: increment created
       - Return { created, failed, errors }

2. Create src/tickets/dto/import-tickets.dto.ts (for the form field):
   - projectId @Type(() => Number) @IsInt @IsPositive

3. Create src/tickets/tickets-import-export.controller.ts:
   - @Controller('tickets')
   - GET 'export' with @Query('projectId', ParseIntPipe) projectId, @Res() res:
       - csv = await service.exportProject(projectId)
       - res.set('Content-Type', 'text/csv; charset=utf-8')
       - res.set('Content-Disposition', `attachment; filename="tickets-project-${projectId}.csv"`)
       - res.send(csv)
   - POST 'import' @HttpCode(200):
       - @UseInterceptors(FileInterceptor('file', {
           storage: memoryStorage(),  // we parse immediately; no need to persist
           limits: { fileSize: 25 * 1024 * 1024 },  // generous cap, matches spec D13's "real-world bulk import" framing
           fileFilter: (req, file, cb) => {
             const allowed = ['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain'];
             if (allowed.includes(file.mimetype)) return cb(null, true);
             cb(new BadRequestException(`Unsupported file type for import: ${file.mimetype}`), false);
           },
         }))
       - @UploadedFile() file
       - @Body() body validated against ImportTicketsDto (for the projectId form field)
       - @CurrentUser() user — passed to service for audit
       - Reject if no file
       - Call service.importProject(body.projectId, file.buffer, user.sub)

4. Update src/tickets/tickets.module.ts:
   - Add TicketsImportExportService to providers
   - Add TicketsImportExportController to controllers

5. Tests in src/tickets/tickets-import-export.service.spec.ts:
   - exportProject() returns RFC 4180-compliant CSV; specifically test a description containing a comma and a description containing an embedded double-quote — these are exactly the cases the spec calls out. (Easiest: assert the output round-trips through csv-parse back to the original objects.)
   - importProject() with valid rows creates them; calls ticketsService.create per row
   - importProject() with one invalid row (e.g., missing title) returns failed: 1 with the row number in error
   - importProject() reports row numbers correctly: header is row 1, data rows start at row 2

6. End-to-end verification for Part 2:
   Setup: alice exists, one project P with at least 3 tickets including one whose description contains a comma ("Fix bug, urgent") and one whose description contains a quote ("She said \"yes\""). Login as alice.

   k. GET /tickets/export?projectId=<P> → 200, Content-Type: text/csv, body is valid CSV. Save the response to /tmp/exported.csv. Inspect: the comma-containing description is wrapped in quotes, the quote-containing description has its quote doubled (RFC 4180).
   l. Create a fresh project P2. POST /tickets/import with -F "file=@/tmp/exported.csv" -F "projectId=<P2>" → 200, { created: 3, failed: 0, errors: [] }
   m. GET /tickets?projectId=<P2> → 200, three tickets present with descriptions correctly round-tripped (commas/quotes intact)
   n. Construct a bad CSV with one invalid row (missing title): printf "title,description,status,priority,type\n,desc1,TODO,HIGH,BUG\nValid,desc2,TODO,HIGH,BUG\n" > /tmp/mixed.csv
   o. POST /tickets/import with /tmp/mixed.csv to a fresh project → 200, { created: 1, failed: 1, errors: [{ row: 2, error: "..." }] }
   p. POST /tickets/import without a file → 400
   q. POST /tickets/import with projectId of a non-existent project → 404 (project missing) — or BadRequest, depending on where the check fires; either is acceptable as long as it's not 500

============================================================
COMBINED SUMMARY
============================================================

Show me, organized clearly:
1. Part 1 (Attachments): all new files, AppModule diff, spec output, curls (a) through (j)
2. Part 2 (CSV): all new files, TicketsModule diff, spec output, curls (k) through (q)
3. Combined test count (should be in the 80+ range)
4. DECISIONS.md confirmation (D12 and D13 appended)

---

## Phase 4: Advanced Features (Soft-delete admin, Mentions, Auto-assign, Auto-escalate)

### Prompt 12 — Admin Soft-Delete Restore Endpoints

**Goal:** Add ADMIN-only endpoints to list and restore soft-deleted tickets and projects, with correct controller registration order to prevent the "deleted" route from colliding with the `/:id` ParseIntPipe.

**Prompt:**

Read CLAUDE.md and DECISIONS.md. Phases 1–3 are complete (90 tests passing). This is Phase 4, Step 1: admin endpoints for soft-deleted tickets and projects.

API contract (spec section 3.5):
- GET /tickets/deleted?projectId={id} → 200, array of soft-deleted tickets in that project (ADMIN only)
- POST /tickets/:id/restore → 200, no body. Restores a soft-deleted ticket (ADMIN only)
- GET /projects/deleted → 200, array of all soft-deleted projects (ADMIN only)
- POST /projects/:id/restore → 200, no body. Restores a soft-deleted project (ADMIN only)

All four endpoints are guarded by JwtAuthGuard (global) + RolesGuard with @Roles(UserRole.ADMIN).

Important routing constraint:
- /tickets/deleted MUST be matched before /tickets/:ticketId. If declared in the wrong order, ParseIntPipe on :ticketId will fire first and return 400 "Validation failed" for the literal string "deleted".
- Same for /projects/deleted vs /projects/:projectId.
- Solution: put admin endpoints in their own controllers (TicketsAdminController, ProjectsAdminController) and register those controllers BEFORE the main TicketsController/ProjectsController in each module's `controllers` array. NestJS processes controllers in array order; this guarantees the literal route registers before the wildcard.

Tasks:

1. Add to src/audit-log/audit-action.enum.ts:
   TICKET_RESTORED = 'TICKET_RESTORED'
   PROJECT_RESTORED = 'PROJECT_RESTORED'

2. Extend src/projects/projects.service.ts:
   - findDeleted(): returns Project[] where deletedAt IS NOT NULL, mapped via response DTO. NO project-exists check upstream — admins can list deleted projects without naming one.
   - restore(id, requesterSub):
       - Find project with id AND deletedAt IS NOT NULL (raw query bypassing the standard findOne filter — or add a private helper findOneDeleted)
       - If not found → NotFoundException "Deleted project not found"
       - Set deletedAt = null, save
       - Audit PROJECT_RESTORED { actorType: USER, actorId: requesterSub, resourceType: PROJECT, resourceId: id }

3. Extend src/tickets/tickets.service.ts:
   - findDeletedByProject(projectId): 
       - Verify project exists AND is not soft-deleted (use projectsService.findOne — if the project itself is deleted, return 404 for its deleted-tickets list. The admin must restore the project first before listing its deleted tickets. Document this as a deliberate behavior in a code comment, not a full DECISIONS.md entry — it's a natural consequence of D3.)
       - Return tickets where projectId matches AND deletedAt IS NOT NULL, mapped via response DTO
   - restore(id, requesterSub):
       - Same pattern as projects: find the deleted ticket (deletedAt IS NOT NULL), throw NotFound otherwise
       - Set deletedAt = null, save (the version column auto-increments — that's fine; the restored ticket has a higher version, which is correct)
       - Note: restoring a ticket whose project is currently soft-deleted is mechanically allowed but the ticket remains effectively inaccessible until the project is also restored. This is a natural consequence of D3 and doesn't require special handling.
       - Audit TICKET_RESTORED

4. Create src/projects/projects-admin.controller.ts:
   - @Controller('projects')
   - @UseGuards(RolesGuard)
   - @Roles(UserRole.ADMIN) — applied at the class level since all methods are ADMIN-only
   - @Get('deleted') → findDeleted
   - @Post(':projectId/restore') @HttpCode(200) with @Param('projectId', ParseIntPipe) and @CurrentUser() → restore

5. Create src/tickets/tickets-admin.controller.ts:
   - Same structure: @Controller('tickets') + @UseGuards(RolesGuard) + @Roles(UserRole.ADMIN) at class level
   - @Get('deleted') with @Query('projectId', ParseIntPipe) → findDeletedByProject
   - @Post(':ticketId/restore') @HttpCode(200) → restore

6. Update src/projects/projects.module.ts and src/tickets/tickets.module.ts:
   - Add the new admin controllers to the controllers array
   - CRITICAL: the admin controller MUST come BEFORE the main controller in the array. controllers: [ProjectsAdminController, ProjectsController] and controllers: [TicketsAdminController, TicketsController]. NestJS processes them in array order; this guarantees /tickets/deleted is registered before /tickets/:ticketId in the Express router.

7. Tests in src/projects/projects.service.spec.ts (extend the existing file):
   - findDeleted() returns only projects with deletedAt set
   - restore() throws NotFound for non-deleted project (deletedAt IS NULL means there's nothing to restore)
   - restore() clears deletedAt and saves; audit log called

8. Tests in src/tickets/tickets.service.spec.ts (extend):
   - findDeletedByProject() filters correctly
   - findDeletedByProject() throws NotFound when parent project is soft-deleted
   - restore() throws NotFound for non-deleted ticket
   - restore() works; audit log called

9. End-to-end verification:
   Setup: alice (DEVELOPER), carol (ADMIN). One project, one ticket. Login as alice and carol; capture aliceToken and adminToken.

   a. DELETE /projects/<projectId> as alice → 200 (existing flow)
   b. GET /projects as alice → does not include the deleted project (existing behavior)
   c. GET /projects/deleted as alice → 403 Forbidden (RolesGuard rejects non-ADMIN)
   d. GET /projects/deleted as carol → 200, array contains the deleted project
   e. POST /projects/<projectId>/restore as carol → 200
   f. GET /projects as alice → includes the project again (deletedAt cleared)
   g. Repeat with tickets: DELETE the ticket as alice
   h. GET /tickets/deleted?projectId=<id> as carol → 200, array of one (the deleted ticket)
   i. POST /tickets/<ticketId>/restore as carol → 200
   j. GET /tickets/<ticketId> as alice → 200 (visible again)
   k. POST /tickets/<ticketId>/restore again as carol → 404 (not deleted; nothing to restore)
   l. As carol, GET /audit-logs?action=TICKET_RESTORED → entry present
   m. As carol, GET /audit-logs?action=PROJECT_RESTORED → entry present
   n. Edge case: soft-delete the project, then try GET /tickets/deleted?projectId=<deletedProjectId> as carol → 404 (project must be restored first to access its deleted tickets — natural consequence of D3)

Show me: all new files, the module diffs, the extended spec output (test count should reach ~95+), and all 14 curl results.

---

### Prompt 13 — @Mentions

**Goal:** Build the @username mention system — Mention entity with cascade delete, mention parser (pure module), MentionsService (resolve/persist/sync), wired into CommentsService, and the GET /users/:userId/mentions paginated endpoint.

**Prompt:**

Read CLAUDE.md and DECISIONS.md. Phases 1–3 and Phase 4 Step 1 are complete (~95 tests passing). This is Phase 4, Step 2: @username mentions in comments.

Spec section 3.6:
- When @username appears in comment content, the mentioned user is associated and the link is persisted
- Mentions are case-insensitive when matching usernames
- Comment responses include `mentionedUsers: [{ id, username, fullName }]`
- On comment update, the mention list is re-evaluated (newly added created, removed deleted)
- On comment delete, mentions are removed (cascade)

API contract (from README.md):
- GET /users/:userId/mentions with optional query params page, pageSize → 200
  { data: [{ id, ticketId, authorId, content, mentionedUsers: [{id, username, fullName}], createdAt, version }], total: number, page: number }
- Comments returned from POST/GET/PATCH on comments now include `mentionedUsers` field

Tasks:

============================================================
PART 1 — Mentions module (new)
============================================================

1. Create src/mentions/entities/mention.entity.ts:
   - id: number, PK
   - commentId: number, @ManyToOne(() => Comment, c => c.mentions, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'comment_id' }), indexed
   - userId: number, @ManyToOne(() => User, { eager: false, onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }), indexed
   - createdAt via @CreateDateColumn
   - @Unique(['commentId', 'userId']) — exactly one row per (comment, user) pair
   - The onDelete: 'CASCADE' on commentId means: when a Comment row is deleted, Postgres deletes the Mention rows automatically. No service-level cleanup needed.

2. Create src/mentions/mention-parser.ts (pure module — no Nest decorators, no DI, testable in isolation like status-transitions.ts):
   - Export a single function: extractMentionedUsernames(content: string): string[]
   - Regex: /@([a-zA-Z0-9_]+)/g (matches our username pattern from Phase 1)
   - Extract all matches, lowercase each, deduplicate (use a Set), return as array
   - Examples:
     - "Hey @alice and @BOB" → ['alice', 'bob']
     - "@alice @ALICE" → ['alice'] (deduped after lowercasing)
     - "no mentions" → []
     - "@" alone or "@@alice" → ['alice'] for the latter; the standalone @ doesn't match

3. Create src/mentions/dto/mentioned-user.dto.ts:
   - Shape: { id, username, fullName }
   - Static from(user: User): MentionedUserDto

4. Create src/mentions/dto/mentions-query.dto.ts (for /users/:userId/mentions query params):
   - page @IsOptional @Type(() => Number) @IsInt @Min(1)  (default 1 in service)
   - pageSize @IsOptional @Type(() => Number) @IsInt @Min(1) @Max(100)  (default 20)

5. Create src/mentions/mentions.service.ts:
   - Constructor injects @InjectRepository(Mention), @InjectRepository(Comment), UsersService, and the User repository @InjectRepository(User) for the case-insensitive username lookup query.
   - resolveMentionedUsers(content: string): Promise<User[]>
       - Extract candidate usernames via extractMentionedUsernames
       - If empty array, return []
       - Query users with LOWER(username) IN (:...usernames) via QueryBuilder:
         repo.createQueryBuilder('u').where('LOWER(u.username) IN (:...names)', { names: usernames }).getMany()
       - Return matched users (silently drops non-existent usernames per spec — no error)
   - persistMentionsForComment(commentId: number, content: string): Promise<User[]>
       - Calls resolveMentionedUsers
       - For each user, insert Mention(commentId, userId) — wrap each insert in a try/catch for 23505 (duplicate) and silently ignore, in case of race conditions. Actually simpler: build all rows and use .insert().values([...]).orIgnore() (TypeORM supports orIgnore on Postgres which adds ON CONFLICT DO NOTHING). Use that.
       - Return the resolved users (for response shape)
   - syncMentionsForComment(commentId: number, content: string): Promise<User[]>
       - Used on comment update. Strategy: delete-all-then-recreate.
       - this.mentionRepo.delete({ commentId })
       - Then call persistMentionsForComment
       - Return new resolved users
   - findCommentsMentioningUser(userId: number, page: number, pageSize: number): Promise<{ data: Comment[], total: number, page: number }>
       - Verify user exists via usersService.findOne (throws 404 if missing — let it propagate)
       - Query: comments where any mention.userId === userId, ORDER BY comment.createdAt DESC, with pagination. Use leftJoinAndSelect to load comment.mentions and mentions.user so the response can include mentionedUsers.
       - findAndCount for total
       - Return { data, total, page }

6. Create src/mentions/user-mentions.controller.ts:
   - @Controller('users/:userId/mentions')  (explicit path with the parent userId)
   - @Get('') with @Param('userId', ParseIntPipe), @Query() MentionsQueryDto
   - Returns mapped response:
     {
       data: comments.map(c => CommentResponseDto.from(c)),  // CommentResponseDto already includes mentionedUsers
       total,
       page
     }

7. Create src/mentions/mentions.module.ts:
   - imports: TypeOrmModule.forFeature([Mention, Comment, User]), UsersModule
   - providers: MentionsService
   - controllers: UserMentionsController
   - exports: MentionsService (CommentsService needs it)

8. Register MentionsModule in AppModule.

============================================================
PART 2 — Wire mentions into Comments
============================================================

9. Modify src/comments/entities/comment.entity.ts:
   - Add: @OneToMany(() => Mention, m => m.comment) mentions?: Mention[];
   - This is a back-reference; doesn't change the schema (the FK lives on the Mention table). It just makes leftJoinAndSelect possible from the Comment side.
   - Import Mention from '../../mentions/entities/mention.entity' — confirm no circular import issue. (Entity-to-entity references via lambda `() => Mention` are lazy and don't cause module load cycles.)

10. Modify src/comments/dto/comment-response.dto.ts:
    - Add `mentionedUsers` field (MentionedUserDto[])
    - In from(comment): if comment.mentions is loaded (truthy), map each mention.user to MentionedUserDto. If not loaded (undefined), set mentionedUsers: [].
    - This makes existing call sites that don't load mentions still produce a valid response (empty array, not crash on undefined).

11. Modify src/comments/comments.service.ts:
    - Inject MentionsService in the constructor
    - create(ticketId, authorId, dto):
        - After persisting the comment, call mentionsService.persistMentionsForComment(savedComment.id, dto.content)
        - To include mentions in the returned response, the cleanest approach: after persist, refetch the comment with relations (this.repo.findOne({ where: { id }, relations: ['mentions', 'mentions.user'] }))
        - Return CommentResponseDto.from(refetchedComment)
    - update(commentId, dto, requester):
        - After the optimistic-lock-checked save, call mentionsService.syncMentionsForComment(comment.id, dto.content)
        - (controller returns no body, so no need to refetch — but make sure the sync happens BEFORE returning to maintain consistency)
    - findAllByTicket(ticketId):
        - Update query to leftJoinAndSelect('comment.mentions', 'mention').leftJoinAndSelect('mention.user', 'mentionedUser')
        - This populates mentionedUsers in every comment returned from GET /tickets/:id/comments

12. Update src/comments/comments.module.ts:
    - Import MentionsModule
    - No other changes (TicketsModule and AuditLogModule already imported)

============================================================
PART 3 — Tests
============================================================

13. Tests in src/mentions/mention-parser.spec.ts (pure unit, no Nest):
    - 'Hey @alice and @BOB' → ['alice', 'bob']  (case folded)
    - '@alice @ALICE @Alice' → ['alice']  (dedup after fold)
    - 'no mentions here' → []
    - '@' alone, '@@', '@!invalid' → empty or matching only the valid part
    - 'Email me at jdoe@example.com' → ['example']  (naive regex matches the post-@ token; per spec, this IS the documented behavior)
    - Order preservation: '@bob @alice' → ['bob', 'alice'] (Set preserves insertion order in JS)

14. Tests in src/mentions/mentions.service.spec.ts (mock all repos + UsersService):
    - resolveMentionedUsers returns [] for content with no mentions
    - resolveMentionedUsers returns matched users; silently drops unknown usernames
    - resolveMentionedUsers passes lowercased candidates to the QueryBuilder (verify the where clause arg)
    - persistMentionsForComment inserts via orIgnore (verify the builder call structure)
    - syncMentionsForComment deletes existing mentions before inserting new ones (verify delete + insert order)
    - findCommentsMentioningUser throws when user not found (UsersService.findOne rejects, propagates)
    - findCommentsMentioningUser returns { data, total, page } with correct pagination math

15. Update src/comments/comments.service.spec.ts:
    - Inject mock MentionsService
    - Existing tests: add expect.objectContaining({ mentionedUsers: [] }) where they assert the response shape, OR update equality assertions to include `mentionedUsers: []`
    - New test: create() calls mentionsService.persistMentionsForComment
    - New test: update() calls mentionsService.syncMentionsForComment

============================================================
PART 4 — End-to-end verification
============================================================

Setup: create three users — alice (DEVELOPER), bob (DEVELOPER), carol (ADMIN). One project owned by alice. One ticket in that project. Login as alice (aliceToken) and carol (adminToken).

a. POST /tickets/<T>/comments { "content": "Hey @bob and @CAROL, please review" } as alice → 200; response includes mentionedUsers with bob and carol (order: bob, carol per insertion). The carol entry has username "carol" not "CAROL" (we return the canonical stored username).

b. GET /tickets/<T>/comments as alice → 200; the comment has mentionedUsers populated.

c. POST /tickets/<T>/comments { "content": "@bob @bob @BOB please look" } as alice → 200; mentionedUsers contains bob exactly once (dedup working).

d. POST /tickets/<T>/comments { "content": "Hi @ghost and @bob" } as alice → 200; mentionedUsers contains only bob (ghost silently dropped per spec).

e. GET /users/<bobId>/mentions as alice → 200, { data: [3 comments mentioning bob], total: 3, page: 1 }. Newest first.

f. GET /users/<carolId>/mentions as alice → 200, { data: [1 comment], total: 1, page: 1 } (just the first comment, since the others don't mention carol)

g. PATCH /comments/<firstCommentId> { "content": "Updated: @bob only", "version": <current> } as alice → 200

h. GET /users/<carolId>/mentions as alice → 200, { data: [], total: 0 } (the carol mention was removed by the sync — D6-style optimistic-lock update + delete-all-recreate sync confirmed)

i. GET /users/<bobId>/mentions as alice → 200, total still 3 (bob is still mentioned in the updated content)

j. DELETE /comments/<firstCommentId> as alice → 200

k. GET /users/<bobId>/mentions as alice → 200, total now 2 (cascade delete: when the comment was hard-deleted, its mentions were dropped automatically)

l. GET /users/9999/mentions as alice → 404 (user does not exist)

m. GET /users/<bobId>/mentions?page=1&pageSize=1 as alice → 200, data has exactly 1 item, total=2, page=1

n. Verify audit log: GET /audit-logs?action=COMMENT_CREATED as carol → 3 entries (one per created comment); GET ?action=COMMENT_UPDATED → 1; GET ?action=COMMENT_DELETED → 1. No mention-specific audit entries (mentions are downstream effects, not standalone state changes).

Show me:
- All new files
- Diffs to Comment entity, CommentResponseDto, CommentsService, CommentsModule, AppModule
- The updated comments.service.spec.ts (highlight what changed)
- Spec output (total should reach ~105+)
- All 14 e2e curl results (a–n)

---

### Prompt 14 — Auto-Assignment by Workload

**Goal:** Build workload-based auto-assignment — WorkloadService with D14's linkage definition (ownership or prior assignment), integration into ticket creation when assigneeId is omitted, SYSTEM-actor audit entries, and GET /projects/:id/workload endpoint.

**Prompt:**

Read CLAUDE.md and DECISIONS.md. All other phases complete (115 tests). This is Phase 4, Step 3: auto-assignment by workload (spec section 3.8).

Spec features:
- On ticket creation, if assigneeId is not provided, system picks the least-loaded linked DEVELOPER
- Workload = count of non-DONE tickets currently assigned to each user IN THE SAME PROJECT
- Ties broken by user registration order (oldest first)
- Only DEVELOPER role candidates; ADMINs excluded
- If no DEVELOPERs are linked to the project: assigneeId = null, no error
- GET /projects/:projectId/workload returns [{ userId, username, openTicketCount }], sorted by openTicketCount ASC
- Each auto-assignment audited with actorType=SYSTEM, actorId=null, action=AUTO_ASSIGN
- Auto-assignment NOT triggered on update — only on create when assigneeId absent
- Manual override in PATCH /tickets/:id with explicit assigneeId always honored

Append D14 to DECISIONS.md:

---
## D14: Auto-assignment candidates are DEVELOPERs linked to the project via ownership or prior assignment

**Context:** Spec section 3.8 references "DEVELOPER users linked to the project". IssueFlow has no explicit project membership model — projects have an `ownerId` and tickets have an `assigneeId`, but no Project↔User join table.

**Decision:** A DEVELOPER is considered "linked" to a project if EITHER:
- They own the project (project.ownerId === user.id), OR
- They have at least one non-soft-deleted ticket assigned in the project (any status, including DONE)

Auto-assignment picks the least-loaded linked DEVELOPER. If no DEVELOPER is linked, the ticket is created with assigneeId = null. The GET /projects/:projectId/workload endpoint reports the same linked-DEVELOPER set with per-project workload counts.

**Rationale:** "Linked" is derived from existing facts (ownership and assignment history) rather than declared via a new join table. This avoids introducing a project-membership API surface the spec never describes (no POST /projects/:id/members endpoints, no removal semantics). The bootstrap case is handled naturally: any project with a DEVELOPER owner has the owner as a candidate; an ADMIN-owned project with no DEVELOPER assignments falls through to the spec's "assigneeId = null" branch.

**Trade-off:** A new DEVELOPER joining the team isn't automatically a candidate on any project — they become a candidate the first time they're manually assigned (or when they're made an owner). Explicit membership would be the next iteration in a real product.
---

Tasks:

1. Add to src/audit-log/audit-action.enum.ts:
   AUTO_ASSIGN = 'AUTO_ASSIGN'

2. Create src/tickets/workload.service.ts (lives in tickets module — workload is derived from ticket state):
   - Constructor injects @InjectRepository(Ticket), @InjectRepository(User)
   - getProjectWorkload(projectId: number): Promise<Array<{ userId, username, openTicketCount }>>
     Single QueryBuilder, returns all linked DEVELOPERs (per D14) with their open-ticket count in this project. Sorted by openTicketCount ASC, then user.createdAt ASC (the tie-break):

     return this.userRepo.createQueryBuilder('u')
       .select('u.id', 'userId')
       .addSelect('u.username', 'username')
       .addSelect('COUNT(t.id)', 'openTicketCount')
       .leftJoin(
         'tickets', 't',
         "t.assignee_id = u.id AND t.project_id = :projectId AND t.status != 'DONE' AND t.deleted_at IS NULL",
         { projectId }
       )
       .where('u.role = :role', { role: 'DEVELOPER' })
       // Linkage filter per D14
       .andWhere(`(
         EXISTS (
           SELECT 1 FROM projects p
           WHERE p.owner_id = u.id AND p.id = :projectId AND p.deleted_at IS NULL
         )
         OR
         EXISTS (
           SELECT 1 FROM tickets t2
           WHERE t2.assignee_id = u.id AND t2.project_id = :projectId AND t2.deleted_at IS NULL
         )
       )`, { projectId })
       .groupBy('u.id')
       .addGroupBy('u.username')
       .addGroupBy('u.created_at')
       .orderBy('"openTicketCount"', 'ASC')
       .addOrderBy('u.created_at', 'ASC')
       .getRawMany()
       .then(rows => rows.map(r => ({
         userId: Number(r.userId),
         username: r.username,
         openTicketCount: parseInt(r.openTicketCount, 10),  // Postgres bigint → JS number
       })));

   - pickAutoAssignee(projectId: number): Promise<number | null>
     - Calls getProjectWorkload
     - Returns the first entry's userId, or null if the list is empty (no linked DEVELOPER)
     - Note: re-runs the full workload query rather than caching. Auto-assignment runs at create time; one extra query per create is fine and avoids cache invalidation complexity.

   Critical SQL note: keep the project/status/deleted filters inside the LEFT JOIN's ON clause, NOT in WHERE. If those conditions are in WHERE, the LEFT JOIN behaves like an INNER JOIN — users with zero matching tickets would disappear from results. The linkage filter in andWhere() is the correct place for "must be linked"; the join filter is the correct place for "count only matching tickets".

3. Modify src/tickets/tickets.service.ts:
   - Inject WorkloadService in the constructor (alongside existing dependencies)
   - In create(dto, requesterSub):
     - After project and (if-provided) assignee validation, BEFORE persist:
       - Detect intent precisely: 
           const shouldAutoAssign = dto.assigneeId === undefined;
         This distinguishes "field omitted from request body" (undefined → auto-assign) from "explicit null" (intentional unassign — don't auto-assign).
       - If shouldAutoAssign:
           const autoAssigneeId = await this.workloadService.pickAutoAssignee(dto.projectId);
           // could be null if no DEVELOPER is linked — that's the spec's "create with assigneeId = null" branch
           Set the new ticket's assigneeId = autoAssigneeId.
     - After persist, BEFORE the existing TICKET_CREATED audit entry:
       - If shouldAutoAssign AND autoAssigneeId is not null:
           await this.auditLog.log({
             actorType: AuditActorType.SYSTEM,
             actorId: null,
             action: AuditAction.AUTO_ASSIGN,
             resourceType: AuditResourceType.TICKET,
             resourceId: savedTicket.id,
             metadata: { assignedUserId: autoAssigneeId, projectId: dto.projectId }
           });
       - The standard TICKET_CREATED audit entry still fires after this (actorType=USER, actorId=requesterSub). A ticket auto-assigned on create produces TWO audit entries — that's correct per spec ("each auto-assignment is recorded in the Audit Log").
   - DO NOT trigger auto-assignment from update(). Spec is explicit: create-only.

4. Create src/tickets/workload.controller.ts:
   - @Controller() with @Get('projects/:projectId/workload')
   - @Param('projectId', ParseIntPipe) → workloadService.getProjectWorkload
   - JWT-required (global guard). No role restriction — any authenticated user can see the workload.

5. Update src/tickets/tickets.module.ts:
   - Add User to TypeOrmModule.forFeature: [Ticket, TicketDependency, User]
   - Add WorkloadService to providers
   - Add WorkloadController to controllers
   - DO NOT export WorkloadService (nothing outside tickets needs it)

6. Tests in src/tickets/workload.service.spec.ts (mock Ticket and User repos via createQueryBuilder mocking):
   - getProjectWorkload returns linked DEVELOPERs sorted by load ASC, then by createdAt ASC
   - Tie-break specifically: two devs with equal load, older registrant comes first
   - Project owner who is a DEVELOPER but has zero tickets IS included (owner-linkage path)
   - DEVELOPER who has a DONE ticket in the project IS included with openTicketCount = 0 (assignment-linkage path; the DONE ticket doesn't add to the count but does establish linkage)
   - DEVELOPER who has NEVER owned or been assigned in this project is NOT included (linkage exclusion)
   - ADMIN users are NOT included regardless of ownership or assignment
   - pickAutoAssignee returns the first linked dev's id
   - pickAutoAssignee returns null when getProjectWorkload returns empty (no linked DEVELOPER)

7. Update src/tickets/tickets.service.spec.ts:
   - Mock WorkloadService
   - create() with undefined assigneeId calls pickAutoAssignee and uses the result
   - create() with assigneeId provided does NOT call pickAutoAssignee (verify .toHaveBeenCalledTimes(0))
   - create() with explicit null assigneeId does NOT call pickAutoAssignee (intentional unassignment)
   - create() emits AUTO_ASSIGN audit entry with actorType=SYSTEM when auto-assignment picks a real user
   - create() does NOT emit AUTO_ASSIGN audit entry when pickAutoAssignee returns null

8. End-to-end verification:

   Setup (register users in this exact order so createdAt ordering is predictable — names suffixed to avoid colliding with earlier-phase users):
   - Register devOldM (DEVELOPER) — let id = OLD
   - Register devMidM (DEVELOPER) — id = MID
   - Register devNewM (DEVELOPER) — id = NEW
   - Register devUnlinked (DEVELOPER) — id = UNLINKED — never gets assigned to a ticket and doesn't own anything
   - Register adminM (ADMIN) — id = ADMIN_ID
   - Login as adminM (admin token for audit reads); also login as devOldM for ticket creation.

   - Create project P_dev owned by devOldM
   - Seed workload by creating tickets with explicit assigneeId:
     - 2 tickets explicitly assigned to devOldM in P_dev (status=TODO) → devOldM load: 2
     - 1 ticket explicitly assigned to devMidM in P_dev → devMidM load: 1
     - 1 ticket assigned to devNewM in P_dev, then PATCHed through to DONE → devNewM load in P_dev: 0, but devNewM IS linked (has an assigned ticket, even though it's DONE)
     - 1 ticket assigned to devNewM in a different project P_other → does NOT contribute to P_dev workload, and is irrelevant to linkage on P_dev

   - Create project P_admin owned by adminM. Don't assign any tickets in it yet.

   Verify:

   a. GET /projects/<P_dev>/workload as devOldM → 200, exactly:
      [{ userId: NEW, openTicketCount: 0 },
       { userId: MID, openTicketCount: 1 },
       { userId: OLD, openTicketCount: 2 }]
      Notes to verify:
      - devUnlinked is NOT in the list (linkage exclusion — never assigned in P_dev)
      - adminM is NOT in the list (ADMIN excluded)
      - devNewM IS in the list with openTicketCount=0 (linked via the DONE ticket; DONE doesn't count toward load but does establish linkage)
      - The cross-project ticket doesn't change devNewM's load here

   b. POST /tickets into P_dev with NO assigneeId field (omit entirely) → 200; response.assigneeId === NEW (lowest load among linked devs)

   c. POST another (no assigneeId) → assigned to MID (devMidM and devNewM both at 1 now, devMidM is older)

   d. POST another (no assigneeId) → assigned to NEW (1 < 2)

   e. POST another (no assigneeId) → assigned to OLD (all three tied at 2, devOldM oldest)

   f. POST a ticket with explicit "assigneeId": null → 200, assigneeId === null (intentional unassignment, no auto-assign; verify no AUTO_ASSIGN audit for this ticket)

   g. POST a ticket with explicit "assigneeId": <ADMIN_ID> → 200, assigneeId === ADMIN_ID (manual ADMIN assignment is allowed; only AUTO-assignment excludes ADMINs)

   h. GET /audit-logs?action=AUTO_ASSIGN as adminM → exactly 4 entries (one each for b, c, d, e). For each: actorType === "SYSTEM", actorId === null, metadata.assignedUserId matches the expected pick.

   i. PATCH one auto-assigned ticket {assigneeId: OLD, version: <current>} as devOldM → 200 (manual override of an auto-assignment via update works the same as any other PATCH).

   j. GET /projects/<P_dev>/workload again → reflects all new assignments

   k. Linkage exclusion check: POST /tickets into P_admin (owned by ADMIN, no DEVELOPER linked yet) with NO assigneeId → 200, assigneeId === null. Verify: no AUTO_ASSIGN audit entry was emitted for this ticket (because pickAutoAssignee returned null — nothing to record). The standard TICKET_CREATED audit entry IS emitted, with the creator as actor.

   l. Now manually assign one ticket in P_admin to devMidM: POST /tickets into P_admin with assigneeId: MID → 200. After this, devMidM is "linked" to P_admin.

   m. POST another ticket into P_admin with NO assigneeId → 200, assigneeId === MID (devMidM is now the only linked DEVELOPER, so auto-assignment picks them despite their load).

   n. GET /projects/<P_admin>/workload → exactly:
      [{ userId: MID, openTicketCount: 2 }]
      (just devMidM, no one else linked yet)

Show me:
- All new files
- TicketsService and TicketsModule diffs
- Workload service spec output (should add 8 tests; total tests reach ~125+)
- All 14 curl results (a–n)

Pay particular attention to:
- (a) — the linkage filter working correctly: devUnlinked excluded, devNewM included via DONE-ticket linkage
- (k) — the no-linked-developer branch creating an unassigned ticket without AUTO_ASSIGN audit
- (m) — the linkage being established by step (l) and immediately taking effect in step (m)

---

### Prompt 15 — Auto-Escalation (Scheduled Job)

**Goal:** Build the auto-escalation cron job using @nestjs/schedule — EscalationService with the priority ladder (LOW→MEDIUM→HIGH→CRITICAL→isOverdue), full idempotency, SYSTEM-actor audit entries, and an ADMIN-only `POST /admin/escalation/run` manual trigger endpoint (D15).

**Prompt:**

Read CLAUDE.md and DECISIONS.md. All other phases complete (128 tests passing). This is Phase 4, Step 4 — the final feature: auto-escalation of overdue tickets (spec section 3.7).

Spec features:
- Ticket create and update accept optional dueDate (ISO-8601). The Ticket entity already has dueDate and isOverdue columns from Phase 2.
- For each overdue, non-DONE ticket with a dueDate set, priority is promoted one level per cycle: LOW → MEDIUM → HIGH → CRITICAL
- Once at CRITICAL and still overdue, isOverdue flag is set to true (visible in all GET responses)
- Escalation is idempotent: a CRITICAL+isOverdue ticket is not modified or re-audited
- Manual priority change via PATCH resets isOverdue to false (next cycle re-evaluates from new priority)
- Escalation does NOT transition status — only priority and isOverdue
- Each escalation step recorded in audit log with actorType=SYSTEM, action=AUTO_ESCALATE

Append D15 to DECISIONS.md:

---
## D15: Manual escalation trigger endpoint for testability and operational visibility

**Context:** Spec section 3.7 describes auto-escalation as a scheduled background job. A cron-only implementation works correctly but is hard to test end-to-end (would require waiting for the schedule) and difficult to operate (no way to verify the job is healthy without staring at logs).

**Decision:** The escalation logic lives in a public method `runEscalation()` on EscalationService. The cron handler calls it on schedule (every minute by default), and an ADMIN-only endpoint `POST /admin/escalation/run` calls the same method on demand. The endpoint returns a summary `{ promoted, markedOverdue, skipped }`.

**Rationale:** Same source of truth (one method, two callers) means the manual path and the scheduled path can never drift. The endpoint is a standard operational pattern in production systems for cron-driven workflows: forces explicit trigger during testing, lets ops re-run after deploys, and provides verifiable feedback.

**Trade-off:** Adds one endpoint not described in the spec. The endpoint is ADMIN-only and additive (no existing behavior changes). Documented here for transparency.
---

Tasks:

1. Install @nestjs/schedule:
   npm install @nestjs/schedule

2. Add to src/audit-log/audit-action.enum.ts:
   AUTO_ESCALATE = 'AUTO_ESCALATE'

3. Update src/tickets/dto/update-ticket.dto.ts:
   - Add: dueDate @IsOptional() @IsDateString() — the spec says create AND update accept dueDate. Currently update doesn't.
   - The service must handle this: convert dto.dueDate string to Date before save. Treat empty string or null as "clear the dueDate" (set to null).

4. Modify src/tickets/tickets.service.ts:
   - In update(id, dto, requester):
     - When dto.priority is provided (regardless of whether the value actually differs from current): set ticket.isOverdue = false. This implements the spec's "manual priority change resets auto-escalation state" rule. Document this with an inline comment citing spec section 3.7.
     - When dto.dueDate is provided: convert to Date (or null if cleared) and apply. Do NOT reset isOverdue based on dueDate alone — spec only says priority changes reset it.
   - These two changes are minimal additions to existing logic; the optimistic-lock and status-transition checks remain unchanged.

5. Create src/escalation/escalation.service.ts:
   - Constructor injects @InjectRepository(Ticket), AuditLogService
   - Public method runEscalation(): Promise<{ promoted: number, markedOverdue: number, skipped: number }>
     - Query overdue non-DONE non-deleted tickets with a dueDate:
       const overdueTickets = await this.ticketRepo.find({
         where: {
           dueDate: LessThan(new Date()),
           deletedAt: IsNull(),
           status: Not(TicketStatus.DONE),
         },
       });
       (Tickets with null dueDate are automatically excluded by LessThan — SQL NULL doesn't satisfy the comparison.)
     - Process each ticket sequentially. Track counters.
     - For each ticket:
       - If priority === CRITICAL:
         - If !isOverdue: set isOverdue = true, save, audit { reachedCritical: true, isOverdueSet: true, dueDate: ticket.dueDate.toISOString() }, increment markedOverdue
         - Else (already CRITICAL + isOverdue): increment skipped, continue. This is the idempotency case — no save, no audit.
       - Else (priority < CRITICAL):
         - Compute next priority via the ladder: LOW→MEDIUM, MEDIUM→HIGH, HIGH→CRITICAL.
         - Set ticket.priority = next, save, audit { from: oldPriority, to: nextPriority, dueDate: ticket.dueDate.toISOString() }, increment promoted
         - Note: do NOT also flip isOverdue in the same step when promoting TO CRITICAL. The isOverdue flip happens on the NEXT cycle (when the ticket is observed as CRITICAL+overdue+!isOverdue). This makes the audit log clean: one cycle per state transition.
     - The save calls go through the repository directly (no manual version check needed — TypeORM's @VersionColumn handles concurrency at the DB level; if a concurrent PATCH races against this, save throws and we let it propagate — the next cycle picks it up).
     - Return the summary.
   - Cron handler (separate method, decorated):
     @Cron(CronExpression.EVERY_MINUTE)
     async handleCron() {
       await this.runEscalation();
     }
     The cron is "every minute" by default. Document in run.md that this can be changed via the schedule expression. No env var indirection for the assignment — keep it simple.

6. Create src/escalation/escalation.controller.ts:
   - @Controller('admin/escalation')
   - @UseGuards(RolesGuard) @Roles(UserRole.ADMIN) at the class level
   - @Post('run') @HttpCode(200) — calls escalationService.runEscalation(), returns the summary
   - The endpoint name and prefix make the operational nature explicit ("admin", "run") — distinct from regular ticket CRUD.

7. Create src/escalation/escalation.module.ts:
   - imports: TypeOrmModule.forFeature([Ticket]), AuditLogModule
   - providers: EscalationService
   - controllers: EscalationController

8. Update src/app.module.ts:
   - Import ScheduleModule from @nestjs/schedule
   - Add ScheduleModule.forRoot() to the imports array
   - Add EscalationModule to the imports array

9. Tests in src/escalation/escalation.service.spec.ts (mock Ticket repo + AuditLogService — do NOT actually import ScheduleModule; we test runEscalation() directly):
   - LOW + overdue → promoted to MEDIUM; audit emitted with from/to; counter incremented
   - MEDIUM + overdue → promoted to HIGH
   - HIGH + overdue → promoted to CRITICAL; isOverdue stays false (the flip happens NEXT cycle)
   - CRITICAL + overdue + !isOverdue → isOverdue set to true; audit emitted with reachedCritical
   - CRITICAL + overdue + isOverdue → SKIPPED (no save, no audit, idempotency); counter incremented
   - The query filter excludes: DONE tickets (Not condition), soft-deleted tickets (IsNull condition), tickets with no dueDate (auto-excluded by LessThan), tickets with future dueDate (LessThan)
   - Counter summary returned correctly across mixed inputs (mix several tickets, verify final counts)

10. Tests in src/tickets/tickets.service.spec.ts (extend the existing file):
    - update() with dto.priority provided resets isOverdue to false (mock ticket starts with isOverdue=true; verify final saved entity has isOverdue=false)
    - update() with dto.dueDate provided updates dueDate but does NOT reset isOverdue (mock ticket starts with isOverdue=true; after update, isOverdue is still true)
    - update() with neither priority nor dueDate provided does not change isOverdue

11. End-to-end verification:

    Setup:
    - Login as adminN (ADMIN), capture adminToken. Login as devN (DEVELOPER), capture devToken.
    - Create one project P_esc owned by devN.
    - Create 7 tickets with controlled state. Use past dueDates several seconds before NOW (e.g., `new Date(Date.now() - 60000).toISOString()`) so they're definitively overdue:

      | Ticket | priority | dueDate | status | isOverdue |
      |--------|----------|---------|--------|-----------|
      | A      | LOW      | past    | TODO   | false     |
      | B      | MEDIUM   | past    | TODO   | false     |
      | C      | HIGH     | past    | TODO   | false     |
      | D      | CRITICAL | past    | TODO   | false     |
      | E      | LOW      | FUTURE  | TODO   | false     |
      | F      | LOW      | (none)  | TODO   | false     |
      | G      | LOW      | past    | DONE   | false     |  (move G through TODO→IN_PROGRESS→IN_REVIEW→DONE to set status; this overrides the default-MEDIUM priority of fresh tickets, so be careful — create G with explicit priority=LOW)

    Note: tickets need explicit priority on create to override the default MEDIUM. Confirm CreateTicketDto allows priority as a required field per the spec — it should.

    a. POST /admin/escalation/run as adminN → 200, returns { promoted: 3, markedOverdue: 1, skipped: 0 }
       Why these numbers:
       - A promoted (LOW→MEDIUM)
       - B promoted (MEDIUM→HIGH)
       - C promoted (HIGH→CRITICAL)
       - D markedOverdue (already CRITICAL, !isOverdue → flip)
       - E,F,G excluded by query

    b. GET /tickets?projectId=<P_esc> as devN → confirm:
       - A.priority === MEDIUM, A.isOverdue === false
       - B.priority === HIGH, B.isOverdue === false
       - C.priority === CRITICAL, C.isOverdue === false  (just hit CRITICAL; flag flips next cycle)
       - D.priority === CRITICAL, D.isOverdue === true
       - E,F,G unchanged

    c. POST /admin/escalation/run again as adminN → 200, { promoted: 2, markedOverdue: 1, skipped: 1 }
       Why:
       - A: MEDIUM→HIGH (promoted)
       - B: HIGH→CRITICAL (promoted)
       - C: CRITICAL+!isOverdue → flip (markedOverdue)
       - D: CRITICAL+isOverdue → SKIPPED (idempotency!)
       - E,F,G still excluded

    d. POST /admin/escalation/run third time → 200, { promoted: 1, markedOverdue: 1, skipped: 2 }
       Why:
       - A: HIGH→CRITICAL (promoted)
       - B: CRITICAL+!isOverdue → flip
       - C: skipped
       - D: skipped

    e. POST /admin/escalation/run fourth time → 200, { promoted: 0, markedOverdue: 1, skipped: 3 }
       Why:
       - A: CRITICAL+!isOverdue → flip
       - B,C,D: all CRITICAL+isOverdue → skipped

    f. POST /admin/escalation/run fifth time → 200, { promoted: 0, markedOverdue: 0, skipped: 4 }
       Full idempotency: nothing changes.

    g. Audit verification: GET /audit-logs?action=AUTO_ESCALATE as adminN → should be exactly 10 entries across runs a–e:
       - From a: 4 entries (A LOW→MEDIUM, B MEDIUM→HIGH, C HIGH→CRITICAL, D flip)
       - From c: 3 entries (A MEDIUM→HIGH, B HIGH→CRITICAL, C flip)
       - From d: 2 entries (A HIGH→CRITICAL, B flip)
       - From e: 1 entry (A flip)
       - From f: 0 entries (idempotency — no audit because no state changed)
       Total: 10. Each has actorType="SYSTEM", actorId=null.

    h. Manual priority reset: get current version of ticket A (now CRITICAL+isOverdue=true). PATCH /tickets/<A> { "priority": "LOW", "version": <current> } as devN → 200.

    i. GET /tickets/<A> as devN → priority === "LOW", isOverdue === false (the manual change reset both). Note version increased as expected.

    j. POST /admin/escalation/run → A is now LOW+overdue+!isOverdue → promoted to MEDIUM. Other tickets unchanged (still CRITICAL+isOverdue=true). Summary: { promoted: 1, markedOverdue: 0, skipped: 3 }

    k. Authorization check: POST /admin/escalation/run as devN (DEVELOPER) → 403 Forbidden (RolesGuard rejects).

    l. Update dueDate path: PATCH /tickets/<A> { "dueDate": <future date>, "version": <current> } as devN → 200. GET A → dueDate is in the future, isOverdue still false (dueDate change does not reset isOverdue per our policy — but it doesn't need to since the ticket isn't overdue anymore).

    m. POST /admin/escalation/run → A's dueDate is now future, so A is excluded from the overdue query. Summary: { promoted: 0, markedOverdue: 0, skipped: 3 } (just B, C, D as CRITICAL+isOverdue skipped).

Show me:
- All new files
- Diffs to update-ticket.dto.ts, tickets.service.ts, audit-action.enum.ts, app.module.ts
- Spec output (test count should reach ~140+)
- All 13 curl results (a–m)

Pay particular attention to:
- The summary counts at each run — they're tightly determined by the ladder logic, and any off-by-one or order-of-operations bug shows up immediately
- (g) — the audit entry count (exactly 10) verifies idempotency at the audit layer: no state change → no audit entry
- (i) — confirms the priority-change-resets-isOverdue rule
- (m) — confirms dueDate-in-future excludes the ticket from escalation

This is the final code prompt of the assignment. After this lands clean, the remaining work is documentation: run.md, README polish, and curating prompts.md.
