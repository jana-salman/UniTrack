# UniTrack
University equipment borrowing and management system.

## Stack
- Frontend: React via Next.js (App Router) + TypeScript
- Backend: Next.js Route Handlers
- Database: PostgreSQL on Supabase, accessed with `pg`
- Auth: Supabase Auth

## Run the app locally
1. `npm install`
2. Copy `.env.example` to `.env.local` and ask the Scrum Master for `DATABASE_URL` (never commit it)
3. `npm run dev`, then open http://localhost:3000

## Workflow
- Branch names: `feature/C430PRJCT-XX-short-name`
- Every change goes through a pull request with at least one review