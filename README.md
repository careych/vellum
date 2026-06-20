# vellum

Personal lifelong photo archive. Upload once, browse forever — original quality, zero lock-in.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Browser / Mobile                          │
└───────────────┬──────────────────────────┬───────────────────┘
                │ HTTPS                    │ HTTPS (presigned PUT)
                ▼                          ▼
┌───────────────────────────┐   ┌──────────────────────────────┐
│    Next.js · Vercel       │   │      Cloudflare R2           │
│                           │   │                              │
│  SSR gallery (public)     │   │  originals/<uuid>.<ext>      │
│  Admin UI  (auth-gated)   │   │  thumbnails/<uuid>.jpg       │
│  API routes               │   │                              │
│  Server actions           │   │  Public CDN: r2.dev (free)   │
└─────────────┬─────────────┘   └──────────────────────────────┘
              │ Supabase JS (server-side only, never in browser)
              ▼
┌───────────────────────────┐
│       Supabase            │
│                           │
│  Postgres  — metadata     │
│  Auth      — sessions     │
│  RLS       — row security │
└───────────────────────────┘
```

**Upload flow (bypasses Vercel's 4.5 MB serverless limit):**

```
Browser                Vercel              Cloudflare R2
   │── POST /presign ──▶│                       │
   │◀── presigned URL ──│                       │
   │──────────── PUT original ─────────────────▶│
   │──────────── PUT thumbnail ────────────────▶│
   │── POST /api/images ▶│── INSERT images ───▶ Supabase
   │◀── { id } ─────────│
```

---

## Tech stack

| Layer | Technology | Reason |
|---|---|---|
| Framework | Next.js 16 (App Router) | SSR + API routes + server actions in one deploy |
| Hosting | Vercel (free tier) | Zero-config Next.js, global edge network |
| Database | Supabase Postgres | Managed Postgres + auth + RLS |
| Object storage | Cloudflare R2 | 10 GB free, **zero egress fee**, S3-compatible |
| Auth | Supabase Auth | Cookie sessions, server-side token refresh |
| Styling | Tailwind CSS v4 + shadcn/ui | No runtime CSS overhead |
| Validation | Zod | Runtime type-safety on every write path |
| Image processing | Canvas API (browser) + sharp (server) | Thumbnail generation |
| EXIF reading | exifr | Date-taken from photo metadata, client-side |

---

## How each requirement is met

| Requirement | Implementation |
|---|---|
| Permanent storage, original quality | File → R2 via presigned PUT; DB stores the key |
| Public read, admin-only write | Supabase RLS + server-side `auth.getUser()` on every mutation |
| Single admin | Supabase signups disabled + `ADMIN_EMAIL` env var double-check |
| Free tier deployable | Vercel + Supabase + R2 all have generous free tiers |
| No vendor lock-in | Standard Postgres, S3-compatible R2, exportable metadata |
| Phone uploads | Presigned PUT flow works from any browser including mobile |
| External URL / Google Drive | URL resolved server-side, fetch + sharp for Mode B import |
| Infinite scroll gallery | IntersectionObserver, 30 images/page, `loading="lazy"` |
| Albums + tags | Relational schema with `albums`, `tags`, `image_tags` |
| Search + filter | Supabase `.ilike` on name/note, tag pre-filter, date range, 5 sort options |
| Metadata export | `GET /api/admin/export?format=json\|csv` |
| Backup | `npx tsx scripts/backup.ts` — R2 inventory + DB dump + integrity check |

---

## Database schema

```
albums
  id              uuid  PK
  name            text  NOT NULL
  cover_image_id  uuid  → images.id  (nullable)

images
  id              uuid  PK
  name            text            (nullable)
  note            text            (nullable)
  taken_at        timestamptz     (nullable, from EXIF or user input)
  uploaded_at     timestamptz     DEFAULT now()
  source_type     text            'upload' | 'external'
  r2_object_key   text            'originals/<uuid>.<ext>'  (nullable for references)
  thumbnail_key   text            'thumbnails/<uuid>.jpg'   (nullable)
  external_url    text            (nullable, only for source_type='external')
  album_id        uuid  → albums.id  (nullable)
  width           int
  height          int
  file_size       int             bytes
  mime_type       text

tags
  id    uuid  PK
  name  text  UNIQUE NOT NULL

image_tags
  image_id  uuid → images.id  ON DELETE CASCADE
  tag_id    uuid → tags.id    ON DELETE CASCADE
  PRIMARY KEY (image_id, tag_id)
```

---

## Running locally

**Prerequisites:** Node.js 18+, a Supabase project, a Cloudflare R2 bucket.

### 1. Install

```bash
git clone <repo-url> && cd vellum
npm install
```

### 2. Create `.env.local`

```env
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # only for scripts/backup.ts — not used by the app

ADMIN_EMAIL=you@example.com

R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-token-access-key>
R2_SECRET_ACCESS_KEY=<r2-token-secret>
R2_BUCKET_NAME=<bucket-name>
R2_PUBLIC_URL=https://pub-<hash>.r2.dev
```

### 3. Run the Phase 6 SQL migration in Supabase SQL Editor

```sql
ALTER TABLE albums
  ADD COLUMN IF NOT EXISTS cover_image_id uuid REFERENCES images(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_images_uploaded_at ON images(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_taken_at    ON images(taken_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_images_album_id    ON images(album_id);
CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id  ON image_tags(tag_id);
```

### 4. Start dev server

```bash
npm run dev   # → http://localhost:3000
```

---

## Deploying to Vercel

### Step 1 — Push to GitHub

```bash
git remote add origin https://github.com/<you>/vellum.git
git push -u origin main
```

### Step 2 — Import on Vercel

1. [vercel.com](https://vercel.com) → **Add New Project** → select your repo → **Import**
2. Framework: **Next.js** (auto-detected) — click **Deploy** once

### Step 3 — Set environment variables

Project → **Settings** → **Environment Variables** → add each row:

| Variable | Environments to select | ⚠️ Server-only? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development | No (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Development | No (public, RLS-protected) |
| `ADMIN_EMAIL` | Production, Preview, Development | **Yes** |
| `R2_ACCOUNT_ID` | Production | **Yes** |
| `R2_ACCESS_KEY_ID` | Production | **Yes** ⚠️ |
| `R2_SECRET_ACCESS_KEY` | Production | **Yes** ⚠️ treat like a password |
| `R2_BUCKET_NAME` | Production | **Yes** |
| `R2_PUBLIC_URL` | Production | **Yes** |

> `SUPABASE_SERVICE_ROLE_KEY` is **not needed in Vercel** — it is only used in `scripts/backup.ts` which runs on your own machine.
>
> Never prefix R2 keys or `ADMIN_EMAIL` with `NEXT_PUBLIC_` — that embeds them in the JavaScript bundle sent to every visitor.

### Step 4 — Redeploy

After saving env vars: **Deployments** → latest deployment → **Redeploy**.

---

## Supabase security checklist

**1. Disable public signups** (most important)
Authentication → Settings → toggle **"Allow new users to sign up"** → OFF

**2. Verify RLS is on**

```sql
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
-- All rows must show: rowsecurity = true
```

**3. Verify RLS policies**

```sql
SELECT tablename, policyname, cmd, roles
FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;
```

Expected: SELECT policies for `anon` + `authenticated`; INSERT/UPDATE/DELETE for `authenticated` only.

---

## R2 bucket checklist

**1. Public access** — Cloudflare dashboard → R2 → your bucket → **Settings** → "Public Access" → confirm the `r2.dev` subdomain is shown and matches `R2_PUBLIC_URL`.

**2. CORS** (required for browser → R2 presigned PUT) — R2 → bucket → Settings → CORS Policy:

```json
[
  {
    "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace `your-app.vercel.app` with your actual Vercel domain.

---

## Manual backup

```bash
npx tsx scripts/backup.ts
# Creates ./backup-<timestamp>/
#   r2-objects.json         all R2 keys, sizes, last-modified dates
#   supabase-metadata.json  full DB dump (images, albums, tags, image_tags)
#   integrity-report.json   DB vs R2 cross-check (missing + orphaned objects)
```

To download the actual image files (requires rclone configured per `MIGRATION.md`):

```bash
rclone copy r2src:<R2_BUCKET_NAME> ./backup-files/ --progress
```

---

## Free-tier limits and monitoring

### Limits

| Service | Free limit | What uses it |
|---|---|---|
| **Vercel** | 100 GB bandwidth/month | Page loads + API responses (images load from R2, not Vercel) |
| **Supabase** | 500 MB database | Metadata rows — tiny (~200 MB per million images) |
| **Cloudflare R2** | 10 GB storage | Original files + thumbnails |
| **R2 operations** | 1M writes/mo, 10M reads/mo | Uploads count; CDN reads via r2.dev may not |
| **R2 egress** | **Unlimited, free** | Cloudflare does not charge egress from R2 |

### How to monitor

- **R2 storage**: Cloudflare dashboard → R2 → bucket → **Metrics** tab
- **Supabase DB size**: Supabase dashboard → Project → **Reports** → Database
- **Vercel bandwidth**: Vercel dashboard → Project → **Analytics**

### Cost if you exceed free limits

| Scenario | Cost |
|---|---|
| R2 > 10 GB | $0.015/GB/month. At 50 GB total: ~$0.60/month |
| Supabase DB > 500 MB | Upgrade to Supabase Pro: $25/month (8 GB included) |
| Vercel > 100 GB bandwidth | Upgrade to Vercel Pro: $20/month (1 TB included) |

**Realistic projection:** 10,000 photos × avg 3 MB = 30 GB → R2 cost ≈ **$0.30/month**. Database and Vercel stay free indefinitely at personal-archive scale.

### What to do when R2 approaches 10 GB

1. Run `npx tsx scripts/backup.ts` → check `integrity-report.json` for orphaned objects to clean up
2. Review large originals: `r2-objects.json` is sortable by `size`
3. If keeping everything, upgrade R2 — it's pay-per-GB with no minimum commitment

---

## Security model

| Layer | What it does |
|---|---|
| Supabase Auth | Cookie sessions; `proxy.ts` refreshes tokens on every request |
| Server-side auth checks | Every write endpoint calls `auth.getUser()` → 401 if not logged in |
| Supabase RLS | Database-level; blocks writes even if API auth were bypassed |
| Zod validation | All user inputs validated before DB writes |
| No service-role key in Vercel | `SUPABASE_SERVICE_ROLE_KEY` is local-only (backup script) |
| Security headers | CSP, X-Frame-Options: DENY, nosniff, Referrer-Policy on all routes |
| Presigned PUT | Files never transit Vercel; direct browser → R2 |

---

## Commands

```bash
npm run dev               # dev server
npm run build             # production build
npx tsc --noEmit          # TypeScript check
npx tsx scripts/backup.ts # manual backup
```

---

*Migration guide (R2 → S3, Supabase → Postgres): see [MIGRATION.md](MIGRATION.md)*
