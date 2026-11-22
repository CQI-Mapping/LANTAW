# Workflow Rules

- Commit every change to git, even single changes.
- Do NOT push to the remote unless the user explicitly asks.

# Role Scope: Programs and Departments

The manager and faculty (`user`) roles are scoped to their **assigned program**.
They only see work that belongs to their own department/program — a manager or
faculty member assigned to a different program cannot see another program's
data, and cannot see another manager's or faculty member's work. Admins see
everything.

## Source of truth

- `public.profiles.program_id` (nullable UUID → `programs.id`) is the program
  assignment for both managers and faculty. An admin sets/changes it in
  **Users & Accounts**.
- `App.tsx` loads the signed-in profile and passes it to pages; the shared
  helper `visiblePrograms(programs, profile)` in `src/utils/programScope.ts`
  applies the rule: admins get the full list; a manager or faculty member gets
  only the program matching their `program_id` (none if unassigned).
- Faculty **subjects** are a narrower gate: `courses.instructor_id` (primary)
  or `course_instructors` junction rows (co-teaching, migration 028). The CLO
  page, Create TOS and Create GRASPS use that assignment gate on top of the
  program scope.

## Scoped surfaces

| Page | Rule |
|---|---|
| Programs catalog | Manager sees only their program; Add/Edit/Archive hidden (migration 036) |
| Program Outcomes | Manager sees/edits only their program's rows; reads admin's global POs (037/038) |
| Course / Assign Faculty / Curriculum | Program picker and rows limited to their program |
| Users & Accounts (manager) | Faculty directory limited to their program's faculty; new faculty inherit the manager's program (Edge Function enforces) |
| Activity Logs (manager) | Only faculty of their program (039) |
| Generate Map / View Syllabus | Program selector and data limited to their program |
| Create GRASPS / Create TOS | Program list scoped to their program; subject/course picker scoped to their assigned subjects |

## Database enforcement

UI scoping is mirrored in RLS, so a crafted direct query cannot cross programs:

- **036** — managers read only their `program_id` row in `programs`; INSERT/UPDATE are admin-only.
- **037 / 038** — manager outcomes are program-stamped; managers read their program's rows plus global admin rows, and write only their own.
- **039** — manager activity-log SELECT resolves the actor's profile and requires a faculty profile in the manager's program.

At the database level faculty keep read access to all programs (their pages
need the catalog); the UI still scopes their own pages to their assigned
program. A role with no `program_id` sees no program-scoped data — ask an
admin to assign one.
