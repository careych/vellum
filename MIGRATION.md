# Vellum — Migration & Portability Guide

This document explains the data model and provides step-by-step instructions for migrating away from any piece of the current infrastructure. Nothing is proprietary — every layer is standard tooling.

---

## Data Model

### Tables

```
albums
  id              uuid  PK
  name            text  NOT NULL
  cover_image_id  uuid  → images.id (nullable)

images
  id              uuid  PK
  name            text  (nullable)
  note            text  (nullable)
  taken_at        timestamptz (nullable, from EXIF or user input)
  uploaded_at     timestamptz DEFAULT now()
  source_type     text  — 'upload' | 'external'
  r2_object_key   text  (nullable for external references)
  thumbnail_key   text  (nullable)
  external_url    text  (nullable — only for source_type='external')
  album_id        uuid  → albums.id (nullable)
  width           int   (nullable)
  height          int   (nullable)
  file_size       int   (nullable, bytes)
  mime_type       text  (nullable)

tags
  id    uuid  PK
  name  text  UNIQUE NOT NULL

image_tags
  image_id  uuid  → images.id  ON DELETE CASCADE
  tag_id    uuid  → tags.id    ON DELETE CASCADE
  PRIMARY KEY (image_id, tag_id)
```

### Storage layout (Cloudflare R2)

```
originals/   <uuid>.<ext>   — original uploaded file
thumbnails/  <uuid>.jpg     — max-400px JPEG thumbnail, quality 82
```

Public URL pattern: `https://<r2-public-url>/<key>`

---

## 1. Migrating image files: R2 → any S3-compatible store

R2 uses the S3 protocol. `rclone` handles both ends.

### Step 1 — Install rclone

```bash
# macOS
brew install rclone
# Windows: https://rclone.org/install/
# Linux
curl https://rclone.org/install.sh | bash
```

### Step 2 — Configure rclone for R2

```bash
rclone config create r2src s3 \
  provider=Cloudflare \
  access_key_id=<R2_ACCESS_KEY_ID> \
  secret_access_key=<R2_SECRET_ACCESS_KEY> \
  endpoint=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com \
  acl=private
```

### Step 3 — Configure rclone for the destination

```bash
# Example: AWS S3
rclone config create s3dst s3 \
  provider=AWS \
  access_key_id=<AWS_KEY> \
  secret_access_key=<AWS_SECRET> \
  region=us-east-1

# Example: Backblaze B2
rclone config create b2dst b2 \
  account=<B2_ACCOUNT_ID> \
  key=<B2_APP_KEY>
```

### Step 4 — Copy all objects

```bash
# Dry-run first to verify
rclone copy r2src:<R2_BUCKET_NAME> s3dst:<NEW_BUCKET_NAME> --dry-run --progress

# Real copy (idempotent — safe to re-run)
rclone copy r2src:<R2_BUCKET_NAME> s3dst:<NEW_BUCKET_NAME> --progress
```

### Step 5 — Update public URLs in the database

After copying, the public URL prefix changes. Update `R2_PUBLIC_URL` in your `.env.local` / Vercel environment to point at the new bucket's public URL. No DB changes are needed because the `r2_object_key` is stored as a path (`originals/<uuid>.jpg`), not a full URL. The application constructs the full URL at read time using `getPublicUrl(key)`.

---

## 2. Migrating the database: Supabase → bare Postgres

Supabase is standard PostgreSQL. You can move to any hosted Postgres (Railway, Neon, Render, fly.io, self-hosted).

### Step 1 — Export from Supabase

```bash
# Install pg_dump (comes with PostgreSQL client tools)
pg_dump \
  --no-owner \
  --no-privileges \
  --schema=public \
  "postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  > vellum-db-export.sql
```

Find the connection string in Supabase Dashboard → Settings → Database → Connection string (URI).

### Step 2 — Import into new Postgres

```bash
psql <NEW_DATABASE_URL> < vellum-db-export.sql
```

### Step 3 — Recreate RLS (if keeping Supabase-style auth)

If moving to a different auth provider, replace the RLS policies with whatever your new system uses. The critical invariant is:

- Anonymous users can `SELECT` from `images`, `albums`, `tags`, `image_tags`
- Only authenticated admin users can `INSERT`, `UPDATE`, `DELETE`

The app's API routes perform their own server-side auth checks (`supabase.auth.getUser()`), so RLS is a second layer, not the primary guard.

### Step 4 — Update environment variables

```env
# Replace these in .env.local / Vercel
NEXT_PUBLIC_SUPABASE_URL=https://<new-postgres-host>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<new-anon-key-or-public-jwt>
SUPABASE_SERVICE_ROLE_KEY=<new-service-role-key>
```

If moving away from Supabase auth entirely, update `lib/supabase/server.ts` to use a different auth client and update `proxy.ts` accordingly.

---

## 3. Full migration checklist

| Step | Task | Tool |
|------|------|------|
| 1 | Run `scripts/backup.ts` → integrity report | `npx tsx scripts/backup.ts` |
| 2 | Export DB | `pg_dump` |
| 3 | Copy R2 objects to new bucket | `rclone copy` |
| 4 | Import DB to new Postgres | `psql` |
| 5 | Update env vars | `.env.local` / Vercel |
| 6 | Update `R2_PUBLIC_URL` | `.env.local` / Vercel |
| 7 | Deploy and smoke-test | `npm run build && npm start` |
| 8 | Verify gallery loads, lightbox works | Manual QA |
| 9 | Verify upload pipeline still works | Upload one test image |
| 10 | Delete old R2 bucket (after confirmation) | Cloudflare dashboard |
| 11 | Delete old Supabase project (after confirmation) | Supabase dashboard |

---

## 4. Verifying no secrets leak into client bundles

After `npm run build`, run:

```bash
# Check Next.js static output for server-only secrets
grep -r "R2_SECRET_ACCESS_KEY" .next/static/ && echo "LEAK FOUND" || echo "OK"
grep -r "SUPABASE_SERVICE_ROLE_KEY" .next/static/ && echo "LEAK FOUND" || echo "OK"
grep -r "R2_ACCESS_KEY_ID" .next/static/ && echo "LEAK FOUND" || echo "OK"
```

Expected output: all three lines print `OK`.

Rule: server-only env vars must never be prefixed with `NEXT_PUBLIC_`. The currently safe split is:

| Variable | Visibility | Reason |
|----------|-----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client | Needed for Supabase JS client in browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client | Safe anon key — RLS enforces access |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Bypasses RLS — never expose |
| `R2_ACCESS_KEY_ID` | Server only | R2 write access |
| `R2_SECRET_ACCESS_KEY` | Server only | R2 write access |
| `R2_ACCOUNT_ID` | Server only | R2 endpoint |
| `R2_BUCKET_NAME` | Server only | Bucket name |
| `R2_PUBLIC_URL` | Server only (used in next.config.ts CSP) | Public URL domain — low sensitivity but not needed in browser |
| `ADMIN_EMAIL` | Server only | Admin identity |

To check git history for accidental secret commits:

```bash
# Search all commits for the secret key pattern
git log --all -p | grep -i "SERVICE_ROLE_KEY\|R2_SECRET\|R2_ACCESS_KEY" | head -20
```

If anything is found, use [git-filter-repo](https://github.com/newren/git-filter-repo) to rewrite history, then rotate all affected keys immediately.
