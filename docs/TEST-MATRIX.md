# Test matrix

Run the automated cases with `cd server && npm test` (Vitest + Supertest against an in-memory MongoDB). Result on 2026-10-20: **137 tests passing**. Manual cases below marked *Pending* have **not** been executed yet and are not claimed as working.

| ID | Case | Steps | Expected | Result | Test / evidence |
|---|---|---|---|---|---|
| TC-01 | Valid login | POST /auth/login with seeded reporter | 200 + token, no hash | Pass (auto) | `auth.test` accepts valid credentials |
| TC-02 | Invalid login | Wrong password / unknown email | 401, identical message | Pass (auto) | `auth.test` same message |
| TC-03 | Prohibited role elevation | Register with `role: "admin"` | 400, no account created | Pass (auto) | `auth.test` rejects role elevation attempts |
| TC-04 | Missing / invalid fields | Short title, short description, bad building, bad urgency | 400 with field details | Pass (auto) | `issues.test` rejects … with 400 |
| TC-05 | Overlong description | 1,001 characters | 400 | Pass (auto) | `issues.test` overlong description |
| TC-06 | Invalid affected count | 0, 501, 2.5, `"35"` | 400 | Pass (auto) | `issues.test` affected 0 / 501 / 2.5 / string |
| TC-07 | Safe user-facing errors | Malformed JSON body | 400, no stack trace | Pass (auto) | `auth.test` malformed JSON |
| TC-08 | Classification: IT Support | Wi-Fi outage text | IT Support, not in review | Pass (auto) | `intelligence.test` routes a clear IT issue |
| TC-09 | Classification: Facilities | Leaking tap text | Facilities | Pass (auto) | `intelligence.test` clear Facilities issue |
| TC-10 | Classification: Administration | ID card certificate text | Administration | Pass (auto) | `intelligence.test` clear Administration issue |
| TC-11 | Ambiguous classification (Journey C) | "Nothing is working in the main office" | Needs review, OPEN, unassigned | Pass (auto) | `routing.test` Journey C; `intelligence.test` |
| TC-12 | Held-out accuracy | 30 unseen cases | > 80% (observed 93.3%) | Pass (auto) | `intelligence.test`, `docs/ml-evaluation.md` |
| TC-13 | Similar issues (Journey B) | Reporter B reports same Wi-Fi outage in other words | Suggestion shown, both records kept | Pass (auto) | `routing.test`, `seed.test` acceptance |
| TC-14 | Unrelated issues | Facilities complaint vs Wi-Fi | No suggestion, not merged | Pass (auto) | `routing.test`, `intelligence.test` |
| TC-15 | Assignment, no available staff | Deactivate department staff, create issue | OPEN, "Unassigned — Admin Review" | Pass (auto) | `routing.test` never assigns inactive staff |
| TC-16 | Deterministic workload tie | Two IT staff, equal load | Lowest staff ID first, then balanced | Pass (auto) | `routing.test`, `intelligence.test` pickStaff |
| TC-17 | Priority thresholds | Scores 3, 4, 5, 7, 8, 9 | P4, P4, P3, P3, P2, P2 | Pass (auto) | `businessRules.test` |
| TC-18 | Hazard override | LOW urgency, 1 person, hazard | P1 + emergency guidance | Pass (auto) | `businessRules.test`, `issues.test` |
| TC-19 | Cross-user ticket read | Reporter B reads Reporter A's ID | 404 (history too) | Pass (auto) | `issues.test` access control |
| TC-20 | Reporter calls admin route | Reporter token on /admin/users | 403 | Pass (auto) | `auth.test` |
| TC-21 | Cross-department action | Facilities staff acts on IT ticket | 404 | Pass (auto) | `status.test`, `routing.test` |
| TC-22 | Illegal status transition | ASSIGNED → RESOLVED; any change after CLOSED | 409 | Pass (auto) | `status.test` |
| TC-23 | Missing resolution note | Resolve without / with short note | 400 | Pass (auto) | `status.test` |
| TC-24 | Reopening | Reporter reopens RESOLVED with a reason (and without) | 200 + logged / 400 without reason | Pass (auto) | `status.test` reopening, `seed.test` |
| TC-25 | Overdue — response | Backdated ticket, no acknowledgement | Flagged with elapsed time + department | Pass (auto) | `status.test` Journey D |
| TC-26 | Overdue — resolution | Acknowledged but unresolved past deadline | Flagged "resolution" | Pass (auto) | `status.test` |
| TC-27 | Accurate dashboard totals | Compare analytics with DB counts, with/without filter, after a status change | Reconciles; updates live | Pass (auto) | `status.test` analytics, `seed.test` |
| TC-28 | Staff can't close for reporter | Staff PATCH → CLOSED | 403 | Pass (auto) | `status.test` |
| TC-29 | Login rate limiting | 5 bad logins with limit 3 | 429 | Pass (auto) | `auth.test` |
| TC-30 | NoSQL injection | `{"$ne":null}` credentials, `status[$ne]` filter | 400 | Pass (auto) | `auth.test`, `issues.test` |
| TC-31 | Persistence across restart | Start a fresh API process against Atlas | Seeded data still present | Pass (manual, 2026-10-20: new process listed 9 issues for Reporter A) | smoke run of `dist/index.js` |
| TC-32 | Mobile layout (375 px) | Open app at 375 px: report, list, detail | No horizontal scroll, usable | **Pending** | — |
| TC-33 | Backend cold-start retry | Stop API, open app, start API | "Waking up" message then loads | **Pending** | — |
| TC-34 | Keyboard / screen-reader pass | Tab through forms, check labels and focus | Operable, labelled | **Pending** | — |
| TC-35 | Deployed Journey A | Run reviewer script on live URLs | All steps pass | **Pending** (needs deployment) | — |

## Defect list

No high-severity defect is currently known in the API, which is covered by automated tests. The browser UI has only been exercised informally so far, and cases TC-32 to TC-35 are still pending. Bugs found and fixed during development: create-issue response omitted the assignee (caught by `routing.test`); duplicate-suggestion history exposed other tickets' IDs to reporters (fixed to store only a count); stale `/report` URL showed "access denied" after switching from reporter to staff (fixed by redirecting to the role home on sign-in/out). Known limitations are listed in the README.
