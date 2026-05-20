# IssueFlow Project Context

## Stack
- NestJS 10, TypeScript 5
- TypeORM with PostgreSQL (via docker-compose)
- JWT auth via @nestjs/passport + @nestjs/jwt + passport-jwt
- bcrypt for password hashing
- class-validator + class-transformer for DTO validation
- Jest for unit and e2e tests

## Database
- PostgreSQL 16 via docker-compose (compose.yml in project root)
- DB name: issueflow, user: issueflow, password: issueflow, port: 5432
- Connection config read from environment variables via @nestjs/config

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
