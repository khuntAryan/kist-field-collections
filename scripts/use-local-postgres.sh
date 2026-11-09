#!/usr/bin/env bash
# Runs Kist against the PostgreSQL installed on this Mac (useful when Wi-Fi blocks Supabase),
# then creates the tables, loads the demo data and starts the app.
#   bash scripts/use-local-postgres.sh
set -e
cd "$(dirname "$0")/.."

PGBIN=""
for d in /Library/PostgreSQL/*/bin /Applications/Postgres.app/Contents/Versions/latest/bin; do
  [ -x "$d/psql" ] && PGBIN="$d"
done
if [ -z "$PGBIN" ] && command -v psql >/dev/null; then PGBIN="$(dirname "$(command -v psql)")"; fi
if [ -z "$PGBIN" ]; then
  echo "No PostgreSQL found on this Mac. Install Postgres.app from postgresapp.com and run this again."
  exit 1
fi
echo "Using PostgreSQL from $PGBIN"

if ! "$PGBIN/pg_isready" -h localhost -p 5432 >/dev/null 2>&1; then
  echo "PostgreSQL is installed but not running on port 5432."
  echo "Start it, then run this again:  sudo -u postgres $PGBIN/pg_ctl -D /Library/PostgreSQL/17/data start"
  exit 1
fi

read -r -p "PostgreSQL user [postgres]: " PGUSER
PGUSER=${PGUSER:-postgres}
read -r -s -p "Password for $PGUSER (the one you chose when you installed PostgreSQL): " PGPASSWORD
echo
export PGUSER PGPASSWORD

if ! "$PGBIN/psql" -h localhost -d postgres -tAc "select 1" >/dev/null 2>&1; then
  echo "That password did not work for user $PGUSER. Run the script again."
  exit 1
fi
if "$PGBIN/psql" -h localhost -d postgres -tAc "select 1 from pg_database where datname='kist'" | grep -q 1; then
  echo "Database 'kist' already exists; it will be reset with fresh demo data."
else
  "$PGBIN/createdb" -h localhost kist
  echo "Created database 'kist'."
fi

# Point DATABASE_URL at the local database. The Supabase link is kept, commented out, for deploying later.
cp .env.local .env.local.before-local-db
node -e '
const fs = require("fs");
const url = "postgresql://" + encodeURIComponent(process.env.PGUSER) + ":" + encodeURIComponent(process.env.PGPASSWORD) + "@localhost:5432/kist";
let saved = false;
const lines = fs.readFileSync(".env.local", "utf8").split("\n").flatMap((l) => {
  if (!l.startsWith("DATABASE_URL=")) return [l];
  const old = l.slice("DATABASE_URL=".length).trim();
  const keep = old && !old.includes("@localhost") ? ["# Supabase (for deploying): " + old] : [];
  saved = true;
  return [...keep, "DATABASE_URL=" + url];
});
if (!saved) lines.push("DATABASE_URL=" + url);
fs.writeFileSync(".env.local", lines.join("\n"));
'
echo "Settings updated (.env.local). Your previous file is saved as .env.local.before-local-db"

npm run db:migrate
npm run db:seed
echo
echo "Starting Kist. Open http://localhost:3000 and tap a demo account. Press Ctrl+C to stop."
npm run dev
