# Architectural Decisions

This document records non-obvious choices made during implementation and the reasoning behind them. It supplements the requirements spec.

---
## Summary of Deviations from the Assignment README

The PDF requirements (`TDP_issueflow_requirements.pdf`) are the source of truth for behavior; the README API table was provided with the assignment for reference. Where the implementation refines or extends what's shown in the README example rows, the deviation is intentional. All deviations below are additive (no existing fields removed or repurposed) and individually justified:

| Area | Deviation | Rationale |
|---|---|---|
| `POST /users` | Accepts a required `password` field | D1 |
| Authentication | `POST /users` is the only public endpoint; everything else requires JWT | D2 |
| Ticket / comment responses | Include a `version` field for optimistic locking | D6 |
| `POST /tickets/:id/comments` | `authorId` is derived from JWT, not the request body | D7 |
| Auto-assignment scope | "Linked DEVELOPER" defined as owner OR prior assignee (no project-membership table) | D14 |
| `POST /admin/escalation/run` | New ADMIN-only manual trigger for the escalation logic | D15 |
| Framework version | NestJS 10 retained from the provided skeleton (PDF specifies 11) | D16 |

Endpoint paths, HTTP verbs, and core field semantics follow the assignment README; the items above are where the implementation diverges from specific examples in the README's request/response bodies.

---

## D1: Password field on POST /users

**Context:** The requirements spec shows `POST /users` accepting `{ username, email, fullName, role }` and `POST /auth/login` accepting `{ username, password }`. The two are inconsistent — login requires a password that user creation never sets.

**Decision:** Extend `POST /users` to accept an additional required `password` field. The password is hashed with bcrypt (cost factor 10) before persistence and never returned in any API response.

**Rationale:** Treating the README table as illustrative rather than exhaustive. A separate registration endpoint would split user creation across two surfaces with no functional benefit at this scope. A default-password-with-force-change flow adds complexity unjustified by the assignment.

**Trade-off:** Slightly extends the documented API contract. The extension is additive (existing fields unchanged) and the password field is never exposed in responses.

## D2: POST /users is public; all other endpoints require JWT

**Context:** Spec section 2.2 requires JWT on all endpoints except POST /auth/login. This creates a bootstrapping problem — no user can exist to log in with until one is created, and creating one requires a token.

**Decision:** Mark POST /users as @Public(). All other endpoints (including the rest of /users) require a valid JWT. Role-based authorization (ADMIN-only operations) is layered on top in later phases via a separate RolesGuard.

**Rationale:** Self-service signup is the standard real-world pattern. Seeding an initial admin via migration is more "spec-strict" but adds infrastructure for one user. The deviation is documented and narrow.

**Trade-off:** Anyone can create a user. In production we'd add CAPTCHA, email verification, and/or admin-only user creation. Out of scope here.

## D3: Soft-deleted resources return 404 to non-admins

**Context:** Spec section 3.5 says soft-deleted records are hidden from standard API responses but can be recovered by ADMIN. Behavior for non-admin requests on a soft-deleted resource is unspecified.

**Decision:** GET, PATCH, and DELETE on a soft-deleted ticket or project return 404 NotFound — identical to a resource that never existed. The soft-delete state is only visible via the ADMIN-only `/deleted` endpoints introduced in a later phase.

**Rationale:** Privacy and least-surprise. Returning 410 Gone or 403 Forbidden would leak the existence of deleted records to users who shouldn't know about them. 404 is the privacy-preserving choice and matches how most production systems handle this.

**Trade-off:** Admins must use the `/deleted` endpoints to see deleted records — they don't surface in the normal API.

## D4: JWT logout uses an in-memory deny-list

**Context:** Spec section 2.2 allows logout to invalidate tokens via "server-side deny-list or stateless expiry." Pure stateless expiry means logout has no real effect — the token keeps working until it expires.

**Decision:** Use an in-memory `Map<jti, expiryEpoch>` deny-list. Tokens added on logout are rejected by JwtStrategy until they would naturally expire, at which point they're swept by a 60-second eviction timer.

**Rationale:** Provides real logout semantics during a session. The deny-list is bounded in size because expired entries are evicted. JWT-standard `jti` claim is used as the key — short, unique, and the canonical field for this purpose.

**Trade-off:** The deny-list lives in process memory: it's lost on restart and doesn't share state across multiple application instances. Production would replace this with Redis or a shared cache. For an assignment running a single instance, in-memory is appropriate.

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
## D11: Ticket dependencies reject direct cycles; transitive cycles are allowed

**Context:** Spec section 3.2 requires that a ticket can declare blockers (tickets that must be DONE before this one can move to DONE). The spec says "prevent circular dependencies" but does not define how deep the cycle check should go.

**Decision:** Only direct cycles are rejected. Attempting to add ticket B as a blocker of ticket B itself (self-loop), or adding A as a blocker of B when B is already a direct blocker of A, returns 400 Bad Request. Transitive cycles (A blocks B, B blocks C, C blocks A) are allowed — detecting them requires a full graph traversal (DFS/BFS) which is expensive and complex for an assignment scope.

**Rationale:** Direct cycles are the common mistake and trivially detectable with one query. Transitive cycle detection would require loading the full dependency graph or walking it recursively, adding significant complexity with low marginal value for this scope. The DONE-blocker check (TicketsService.update) only looks at direct unresolved blockers, so transitive deadlocks don't silently block progression — they just won't be caught preventively.

**Trade-off:** A pathological data set could construct a transitive deadlock that prevents any ticket in the cycle from reaching DONE. Acceptable at assignment scope; a production system would add a graph traversal on dependency creation or a background integrity check.

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
## D14: Auto-assignment candidates are DEVELOPERs linked to the project via ownership or prior assignment

**Context:** Spec section 3.8 references "DEVELOPER users linked to the project". IssueFlow has no explicit project membership model — projects have an `ownerId` and tickets have an `assigneeId`, but no Project↔User join table.

**Decision:** A DEVELOPER is considered "linked" to a project if EITHER:
- They own the project (project.ownerId === user.id), OR
- They have at least one non-soft-deleted ticket assigned in the project (any status, including DONE)

Auto-assignment picks the least-loaded linked DEVELOPER. If no DEVELOPER is linked, the ticket is created with assigneeId = null. The GET /projects/:projectId/workload endpoint reports the same linked-DEVELOPER set with per-project workload counts.

**Rationale:** "Linked" is derived from existing facts (ownership and assignment history) rather than declared via a new join table. This avoids introducing a project-membership API surface the spec never describes (no POST /projects/:id/members endpoints, no removal semantics). The bootstrap case is handled naturally: any project with a DEVELOPER owner has the owner as a candidate; an ADMIN-owned project with no DEVELOPER assignments falls through to the spec's "assigneeId = null" branch.

**Trade-off:** A new DEVELOPER joining the team isn't automatically a candidate on any project — they become a candidate the first time they're manually assigned (or when they're made an owner). Explicit membership would be the next iteration in a real product.

---
## D15: Manual escalation trigger endpoint for testability and operational visibility

**Context:** Spec section 3.7 describes auto-escalation as a scheduled background job. A cron-only implementation works correctly but is hard to test end-to-end (would require waiting for the schedule) and difficult to operate (no way to verify the job is healthy without staring at logs).

**Decision:** The escalation logic lives in a public method `runEscalation()` on EscalationService. The cron handler calls it on schedule (every minute by default), and an ADMIN-only endpoint `POST /admin/escalation/run` calls the same method on demand. The endpoint returns a summary `{ promoted, markedOverdue, skipped }`.

**Rationale:** Same source of truth (one method, two callers) means the manual path and the scheduled path can never drift. The endpoint is a standard operational pattern in production systems for cron-driven workflows: forces explicit trigger during testing, lets ops re-run after deploys, and provides verifiable feedback.

**Trade-off:** Adds one endpoint not described in the spec. The endpoint is ADMIN-only and additive (no existing behavior changes). Documented here for transparency.

---
## D16: Kept NestJS 10 from the provided skeleton

**Context:** The assignment requirements PDF specifies "TypeScript 5.x with NestJS 11 (skeleton provided)", but the actual skeleton AT&T provided ships with `@nestjs/core@^10.0.0`. The mismatch is in the original starter, not introduced by this implementation.

**Decision:** Stay on NestJS 10 throughout. The auth-related packages (`@nestjs/jwt@11`, `@nestjs/passport@11`) are at v11 because their versioning decoupled from core some time ago; they work cross-version with core 10.

**Rationale:** Upgrading core mid-build risks subtle behavior changes for negligible benefit at this scope. The framework's public API is essentially identical between 10 and 11 for everything we use (modules, controllers, guards, pipes, DI, ValidationPipe, TypeORM integration). The running skeleton (NestJS 10) is the more authoritative signal than a PDF line that contradicts the code AT&T shipped.

**Trade-off:** A strict reading of the requirements PDF would consider this a deviation. Migration to 11 would be a follow-up commit if required.
