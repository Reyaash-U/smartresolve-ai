# API reference

JSON everywhere. Auth is `Authorization: Bearer <token>` from `/auth/login` or `/auth/register`.
Errors look like `{ "error": "message", "details": [{ "field": "...", "message": "..." }] }`.
Status codes: 400 invalid input · 401 not signed in · 403 not allowed for your role · 404 not found **or not visible to you** · 409 conflicting state or illegal transition · 413 body too large · 429 too many logins · 500 generic message (no stack traces).

| Method & path | Who | Purpose |
|---|---|---|
| `GET /health` | anyone | `{ status, db, time }` |
| `POST /auth/register` | anyone | Create a **reporter** (`displayName`, `email`, `password`; unknown fields such as `role` are rejected) |
| `POST /auth/login` | anyone | Returns `{ token, user }`. Rate limited (10 / 15 min / IP) |
| `GET /me` | signed in | Current user |
| `POST /issues` | reporter, admin | Create issue. Body: `title` 5–120, `description` 20–1000, `building` (list), `room` 2–80, `urgency` LOW/MEDIUM/HIGH, `affectedCount` int 1–500, `hazardFlag` bool. Runs priority, classification, duplicate check and routing |
| `GET /issues` | signed in | Scoped list: reporter = own, staff = own department, admin = all. Filters `status`, `department`, `priority`, `overdue`, `unassigned`, `limit` |
| `GET /issues/:id` | owner, dept staff, admin | Detail incl. prediction, priority factors, SLA, safe duplicate summaries |
| `GET /issues/:id/activity` | same | Append-only history |
| `PATCH /issues/:id/status` | see below | Body `{ status, note?, reason? }` |
| `POST /issues/:id/acknowledge` | staff (own dept) | Counts as first response |
| `POST /issues/:id/notes` | staff (own dept) | Progress note; counts as first response |
| `PATCH /issues/:id/assignment` | admin | `{ assigneeId, reason? }`; reason required when reassigning |
| `PATCH /issues/:id/priority` | admin (override) / staff (suggest only) | `{ level, reason }`, reason required |
| `POST /issues/:id/links` | admin | Link two possible duplicates (`otherId`); both records are kept |
| `GET /analytics` | signed in | Role-scoped analytics (`?department=` for admin) |
| `GET /admin/analytics` | admin | Same figures, admin only |
| `GET /admin/users` | admin | Staff/admin roster with current workload |

**Status rules (`PATCH /issues/:id/status`)**

| Move | Allowed for | Extra requirement |
|---|---|---|
| ASSIGNED → IN_PROGRESS | assigned-department staff, admin | — |
| IN_PROGRESS → RESOLVED | assigned-department staff, admin | `note` ≥ 15 chars |
| RESOLVED → CLOSED | owning reporter; admin | admin needs `reason` |
| RESOLVED → IN_PROGRESS (reopen) | owning reporter; admin | `reason` ≥ 5 chars |
| any unresolved → CLOSED (exceptional) | admin | `reason` |
| anything else | — | 409 (illegal) or 403 (not permitted) |

Assigning (OPEN → ASSIGNED) is done through the assignment action, never a plain status change.
