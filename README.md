# Engineering, Procurement, and Construction

Next.js EPC contractor management application using Drizzle ORM and PostgreSQL.

## Local setup

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your Neon connection string. Keep `.env.local` out of Git.

3. Push the schema to the configured database:

   ```bash
   npx drizzle-kit push
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

The app seeds demo data when the database is empty. Set `SEED_DEMO_PASSWORD` before the first run if you want a custom demo password.

## Neon deployment variables

Configure these environment variables in the hosting provider:

- `DATABASE_URL`: Neon pooled connection string, including `sslmode=require`.
- `FILE_SIGNING_SECRET`: long random secret used to sign file access.
- `SEED_DEMO_PASSWORD`: optional initial demo password.

Never commit `.env.local` or any Neon password to the repository.
