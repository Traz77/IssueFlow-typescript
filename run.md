# IssueFlow — Setup, Build, Run, and Test Guide

## Prerequisites
- Node.js 20 LTS or newer
- npm 10 or newer
- Docker Desktop (or Docker Engine + docker-compose-plugin on Linux)
- `jq` (optional, used in the smoke test below for token extraction)

## 1. Install dependencies
```bash
cd issueflow-typescript
npm install
```

## 2. Configure environment
```bash
cp .env.example .env
```
Then fill in the placeholder values in `.env` to match the docker-compose database:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=issueflow
DB_PASSWORD=issueflow
DB_NAME=issueflow
JWT_SECRET=dev-secret-change-in-prod-7f3a9c2e8b1d4a6f
JWT_EXPIRES_IN=3600s
NODE_ENV=development
```
Edit `JWT_SECRET` to any non-empty string. All other values match the docker-compose defaults and can stay as-is unless your Postgres port conflicts.

## 3. Start the database
```bash
docker compose up -d
```
This launches Postgres 16 on port 5432. Wait ~5 seconds for it to accept connections:
```bash
docker compose ps
```

## 4. Run the application
Development mode (hot reload):
```bash
npm run start:dev
```

Production-style:
```bash
npm run build
npm run start:prod
```

The server listens on http://localhost:3000. On first start, TypeORM creates all tables via `synchronize: true` (development only — production would use migrations).

## 5. Run the tests
```bash
npm test                    # all 141 unit/integration specs
npm run test:cov            # with coverage report
npm run test:watch          # watch mode for development
```

## 6. Smoke test (end-to-end auth flow)
The commands below use bash subshell syntax (`$(...)`) and require `jq`. Run them in bash (Git Bash, WSL, or macOS/Linux terminal), not PowerShell.

```bash
# Create a user — POST /users is public per DECISIONS.md D2 (signup bootstrap)
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","email":"demo@example.com","fullName":"Demo","role":"ADMIN","password":"demo1234"}'

# Log in
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo1234"}' | jq -r .accessToken)

# Verify token
curl -s http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"
```

## Operational notes
- Auto-escalation runs every minute by default (`@Cron(CronExpression.EVERY_MINUTE)` in `src/escalation/escalation.service.ts`). Manual trigger: `POST /admin/escalation/run` with an ADMIN token (see DECISIONS.md D15).
- Attachments are stored under `./uploads/` (gitignored). The directory is created on first upload.
- JWT logout deny-list is in-memory (DECISIONS.md D4); restart clears it. Multi-instance deployment would move this to Redis.

## Reset / cleanup
```bash
docker compose down -v       # stops Postgres and deletes its volume (data loss)
rm -rf uploads/              # clears stored attachments
```

## Project documentation
- `README.md` — Project overview and the API contract reference
- `DECISIONS.md` — 16 architectural decisions with context, rationale, and trade-offs. The top of the file summarizes deviations from the assignment README.
- `prompts.md` — Documented AI workflow used to build the project

## Tech stack
NestJS 10 · TypeScript 5 · TypeORM · PostgreSQL 16 · JWT (passport-jwt) · bcrypt · class-validator · @nestjs/schedule · multer · csv-parse/csv-stringify · Jest
