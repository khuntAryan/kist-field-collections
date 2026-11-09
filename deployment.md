# Deployment

Kist is a single Next.js app (pages and API together) backed by one Postgres database. In production it runs on Vercel, with functions in Mumbai (`bom1`), and Supabase Postgres in Mumbai (`ap-south-1`), so borrower data stays in India as the DPDP Act constraint in the brief requires.

- GitHub: https://github.com/khuntAryan/kist-field-collections
- Live app: https://kist-field-collections.vercel.app (demo password `Kist@Demo2026`, see section D)

## A. Run it locally

You need Node.js 20 or newer (22 recommended), npm, and Postgres 14 or newer.

1. Get the code and install packages.
   ```bash
   git clone https://github.com/khuntAryan/kist-field-collections.git
   cd kist-field-collections
   npm install
   ```
2. Create a database and a user. For example, with a local Postgres:
   ```bash
   psql -U postgres -c "CREATE USER kist WITH PASSWORD 'choose-a-password' CREATEDB;"
   psql -U postgres -c "CREATE DATABASE kist OWNER kist;"
   psql -U postgres -c "CREATE DATABASE kist_test OWNER kist;"   # only for the database tests
   ```
3. Copy the environment template and fill it in (names are listed in section C).
   ```bash
   cp .env.example .env.local
   ```
   - `DATABASE_URL=postgres://kist:choose-a-password@localhost:5432/kist`
   - `TEST_DATABASE_URL=postgres://kist:choose-a-password@localhost:5432/kist_test`
   - `SESSION_SECRET`: run `openssl rand -base64 32` and paste the output
   - `DEMO_PASSWORD`: any password of 8+ characters; every demo account gets it
   - `DEMO_MODE=true`
4. Create the tables and load the sample data.
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
   The seed simulates 150 days of the lender's overdue book (about 1,400 loans, 9,000 field outcomes and 3,200 promises across 3 branches and 9 officers), then loads today's overdue file through the same import pipeline managers use. It takes about 5 seconds and can be re-run at any time to reset the demo. Dates are anchored to the day you run it.
   **Network blocks the database?** Campus and office Wi-Fi often block database ports, so `db:migrate` times out (`ETIMEDOUT`). On a Mac with PostgreSQL or Postgres.app installed, run `bash scripts/use-local-postgres.sh` instead of steps 4 and 5. It asks for your local PostgreSQL password, creates a `kist` database, points `.env.local` at it (keeping your Supabase link as a comment), loads the demo data and starts the app.
5. Start the app.
   ```bash
   npm run dev
   ```
   Open http://localhost:3000. For the officer app, use a phone-sized window (or Chrome DevTools device mode).
6. Optional checks.
   ```bash
   npm test            # 57 tests (11 of them need TEST_DATABASE_URL)
   npm run typecheck
   npm run lint
   npm run build && npm start   # production mode; the offline service worker only runs here
   ```

To try offline mode: sign in as an officer in production mode, open the list once, then switch the browser to offline (DevTools, Network, Offline). Reload: the list still opens. Log an outcome, go back online, and it syncs within seconds.

## B. Deploy (Vercel + Supabase, both in Mumbai)

### B1. Database

1. Create a Supabase project and choose the region **South Asia (Mumbai)**.
2. In Project Settings, Database, copy the connection string (the Session pooler URI works well for serverless). Add `?sslmode=require` at the end.
3. Optional but recommended: download the database's SSL certificate from the same page and put its PEM text in `DATABASE_CA_CERT`, so the connection is verified as well as encrypted.

### B2. Create the tables and the demo data

Run these from your machine, pointing at the Supabase database:

```bash
DATABASE_URL="postgresql://...supabase...:5432/postgres?sslmode=require" npm run db:migrate
DATABASE_URL="postgresql://...supabase...:5432/postgres?sslmode=require" DEMO_PASSWORD="Kist@Demo2026" npm run db:seed
```

Seeding over the internet takes a minute or two. Re-run the seed on the day of a review so the demo's "today" matches the calendar.

### B3. App

1. In Vercel, Add New, Project, and import the GitHub repository. The framework is detected as Next.js; keep the default build settings.
2. Add the environment variables from section C (Production and Preview).
3. Deploy. `vercel.json` pins the functions to `bom1` (Mumbai).

### B4. Check

Open `<your URL>/api/health`. It should show `"ok": true`, `"database": "ok"` and `"region": "bom1"`. If it says `empty` or `not_migrated`, run B2 against the production database; if it says `unreachable` or `wrong_password`, recheck `DATABASE_URL`. Then sign in with a demo account and confirm the officer list loads.

## C. Environment variables

Names only. Values are never committed; `.env.local` is git-ignored.

| Name | Needed | What it is |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string. Add `?sslmode=require` for managed databases. |
| `SESSION_SECRET` | Yes | At least 32 random characters, used to sign session cookies. |
| `DEMO_PASSWORD` | For the seed and demo mode | Password given to every demo account by `npm run db:seed`. In demo mode the sign-in page's one-tap demo buttons use it. |
| `DEMO_MODE` | Yes | `true` shows the demo accounts on the sign-in page, simulates calls instead of dialling, and enables the reviewer demo clock. Use `false` for a real rollout. |
| `DATABASE_CA_CERT` | Optional | PEM certificate of the database's CA (newlines as `\n`) to verify the connection. |
| `DATABASE_POOL_MAX` | Optional | Connections per server instance (default 5; 1-3 suits serverless). |
| `TEST_DATABASE_URL` | Tests only | A separate, disposable database for `npm test`. Never point it at real data. |

No AI or messaging API keys are needed: the priority model runs inside the app, and SMS and WhatsApp are simulated.

## D. Demo sign-in for reviewers

The password for every account is the `DEMO_PASSWORD` used when seeding. On the live demo it is **`Kist@Demo2026`**. With `DEMO_MODE=true`, the sign-in page also has one-tap buttons for the first three accounts.

| Role | Email | What to look at |
|---|---|---|
| Field officer, Indore City | `rahul@kist.test` | Phone app in Hindi: today's list, three-tap logging, offline, reminders. Sample loan LN-10293 (Company B) is his. |
| Field officer, Indore City | `neha@kist.test` | Has sample loan LN-10871 (Company C, 27 DPD) |
| Field officer, Pithampur | `imran@kist.test` | Has sample loan LN-11930 (Company D, broken promise) |
| Branch manager, Indore City | `sanjay@kist.test` | Import, officer lists, roll rate, promises, score check, activity |
| Branch manager, Pithampur | `meera@kist.test` | Same, for Pithampur only |
| Head of collections | `ritu@kist.test` | All three branches, with a branch switch |

Other officers: `pooja@`, `amit@`, `sandeep@`, `kavita@`, `vikas@` and `farhan@kist.test`. The branch manager for Dewas is `arjun@kist.test`.

Things worth trying:
- **Contact block:** as an officer, open Sync and set the demo clock to 8:15 pm. Call buttons lock, logging asks for a time before 7 pm, and each blocked tap is recorded (manager: Activity log). Set it back to Real time afterwards.
- **Offline:** log an outcome with the network off; it waits on the phone and syncs when you reconnect.
- **Import:** as a manager, open Daily import, download the sample file, and check it. The preview shows 3 rejected rows with reasons, 4 new loans and 5 paid up, plus the assignment plan.
- **Wording filter:** in a reminder, type a threat such as "police". Send is blocked, and the server blocks it again.
- **Access control:** `sanjay@kist.test` gets a 404 for a Pithampur loan such as `/manage/loans/LN-11930`.
