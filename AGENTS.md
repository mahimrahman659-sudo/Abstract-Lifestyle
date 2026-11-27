# Coding Agent Rules

- Before any task, read `REQUIREMENTS.md` and `PROJECT_CONTEXT.md`. If a task conflicts with `REQUIREMENTS.md`, stop and ask the user.
- Do only the named task. Inspect only relevant files; never scan the whole project.
- Make targeted edits. Never rewrite whole files unless asked.
- Stack: Next.js (App Router), strict TypeScript, and Tailwind CSS in `/client`; Node.js, Express, TypeScript, and MongoDB (Mongoose) in `/server`.
- Do not add dependencies without asking the user first.
- Do not use `any` types. Validate all API input with Zod.
- Never hardcode secrets; use environment variables and keep `.env.example` updated.
- Follow the Express structure: routes → controllers → services → models. Business logic lives only in `/server`.
- Next.js calls the Express API; do not duplicate backend logic in Next.js route handlers.
- Use httpOnly cookies for authentication.
- Represent money as integer poisha.
- Update stock atomically.
- Preserve order snapshots.
- Handle loading, error, and empty states in every UI.
- For Zod update schemas, never use `.partial()` on a schema containing `.default()` values. Strip defaults first, for example by re-declaring fields with `.extend({ field: schema.optional() })` or building the update schema without defaults, so partial updates cannot overwrite existing values.
- Never leave temporary files, test routes, harness pages, probe scripts, or fixture mutations in the project. Delete them and restore any data changed for testing before reporting.
- After each task, run type-check and lint, then report changed files, what was done, and anything unfinished.
- Keep replies short. Do not give long explanations unless asked.
