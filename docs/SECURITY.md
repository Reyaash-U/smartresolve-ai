# Security notes and risk list

Scope: a demo system with synthetic data. This is a self-assessment with automated checks, not an independent penetration test.

## Controls and how they are verified

| Risk | Control | Evidence (automated test) |
|---|---|---|
| Privilege escalation at registration | Registration is always `reporter`; schema rejects unknown fields (`role`) | `auth.test` › rejects role elevation attempts |
| Guessing another user's ticket ID (IDOR) | Server checks ownership/department on every read and write; invisible tickets return 404 | `issues.test` › Reporter B cannot read Reporter A's ticket by ID or its history |
| Calling admin APIs as non-admin | `requireRole` on the server | `auth.test` › reporter/staff cannot call admin routes (403) |
| Cross-department action by staff | Department checked on status, notes, priority | `routing.test`, `status.test` (staff of another department get 404) |
| Illegal status jumps via direct API calls | Server-side state machine | `status.test` › rejects skipping IN_PROGRESS, closed issues are final |
| NoSQL injection | zod schemas accept only strings/enums; `{"$ne":null}` and `status[$ne]=OPEN` are rejected | `auth.test` › blocks NoSQL operator injection; `issues.test` › rejects injected filters |
| Password storage | bcrypt (cost 10), `select:false` on the hash field | `auth.test` › hashes the password; admin roster has no hashes |
| Brute-force login | `express-rate-limit` 10 attempts / 15 min / IP; `trust proxy` set for Render | `auth.test` › returns 429 |
| User enumeration | Same message for unknown email and wrong password; dummy hash compare | `auth.test` › same message |
| Forged / expired token | JWT verified, user reloaded from DB each request, deactivated accounts rejected | `auth.test` › forged token, deactivated accounts |
| Information leaks | Generic 500 message; malformed JSON → 400; helmet headers; reporter email never in API responses | `auth.test` › malformed JSON; `issues.test` › no emails in staff list |
| Privacy of duplicate suggestions | "Safe summary" only (code, title, status, location); history stores only a count | `routing.test` › safe summary contains no reporter identity |
| Tampering with history | Activity log has no update/delete route; timestamps server-side | design; no endpoint exists |
| Secrets in the repo | `.env` git-ignored; secrets only in environment variables | `.gitignore`, `.env.example` |
| Unprotected seed/reset | CLI script only; no HTTP route | design |
| CORS | Allow-list from `CLIENT_ORIGIN` (no wildcard) | config |

## Known risks (not fixed)

1. **JWT in `localStorage`** — an XSS bug would expose tokens. Mitigation: React escapes output, no `dangerouslySetInnerHTML`, helmet defaults. A production system should use HttpOnly cookies.
2. **No server-side token revocation** besides deactivating the user (checked every request). Tokens last 8 hours.
3. **Rate limiter is in memory** — resets on restart and is per instance (fine for one free-tier instance).
4. **Atlas network access `0.0.0.0/0`** — required because Render's free tier has no fixed outbound IP. Mitigation: a dedicated database user with a strong password and synthetic data only.
5. **No account lockout, MFA or email verification**; password rule is length only (8–72 characters).
6. **Demo credentials are public** by design (dummy data). Never reuse them.
7. **No automated dependency scan** configured yet (`npm audit` can be run manually).
8. **Classifier can be wrong** — mitigated by review threshold and human override, not eliminated.

## How to reproduce

```bash
cd server && npm test        # includes all access-control and injection checks above
```
