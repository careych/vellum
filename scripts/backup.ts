/**
 * vellum manual backup script
 *
 * Lists every R2 object key and exports full Supabase metadata to JSON.
 * Output files are written to ./backup-<date>/.
 *
 * Usage:
 *   npx tsx scripts/backup.ts
 *
 * Prerequisites: tsx must be available (npx installs it on demand).
 * The script reads credentials from .env.local automatically.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'

// ── Load .env.local (Next.js doesn't expose it to plain Node scripts) ────────
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (key && !process.env[key]) process.env[key] = val
    }
  } catch {
    console.warn('⚠  .env.local not found — using process.env as-is')
  }
}

loadEnv()

// ── Validate required env vars ────────────────────────────────────────────────
const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
]
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing env var: ${key}`)
    process.exit(1)
  }
}

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role: bypasses RLS, reads all rows
  { auth: { persistSession: false } }
)

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────
async function listAllR2Keys(): Promise<{ key: string; size: number; lastModified: Date }[]> {
  const objects: { key: string; size: number; lastModified: Date }[] = []
  let continuationToken: string | undefined

  do {
    const res = await r2.send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME!,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    )
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        objects.push({
          key: obj.Key,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified ?? new Date(0),
        })
      }
    }
    continuationToken = res.NextContinuationToken
  } while (continuationToken)

  return objects
}

async function fetchTable(table: string) {
  const { data, error } = await supabase.from(table).select('*').order('id')
  if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`)
  return data ?? []
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = join(process.cwd(), `backup-${date}`)
  mkdirSync(outDir, { recursive: true })

  console.log(`📁 Writing backup to ${outDir}\n`)

  // 1. R2 object listing
  console.log('🪣  Listing R2 objects…')
  const r2Objects = await listAllR2Keys()
  const totalMB = (r2Objects.reduce((s, o) => s + o.size, 0) / 1024 / 1024).toFixed(2)
  console.log(`   ${r2Objects.length} objects, ${totalMB} MB total`)
  writeFileSync(
    join(outDir, 'r2-objects.json'),
    JSON.stringify(r2Objects, null, 2),
    'utf8'
  )

  // 2. Supabase tables
  const tables = ['images', 'albums', 'tags', 'image_tags']
  const dbDump: Record<string, unknown[]> = {}
  for (const table of tables) {
    console.log(`🗄   Fetching ${table}…`)
    dbDump[table] = await fetchTable(table)
    console.log(`    ${dbDump[table].length} rows`)
  }
  writeFileSync(
    join(outDir, 'supabase-metadata.json'),
    JSON.stringify({ exported_at: new Date().toISOString(), ...dbDump }, null, 2),
    'utf8'
  )

  // 3. Cross-check: DB rows vs R2 keys
  const r2KeySet = new Set(r2Objects.map((o) => o.key))
  const images = dbDump['images'] as Array<{ id: string; r2_object_key: string | null; thumbnail_key: string | null }>
  const orphanedKeys: string[] = []
  const missingKeys: string[] = []

  for (const img of images) {
    if (img.r2_object_key && !r2KeySet.has(img.r2_object_key)) {
      missingKeys.push(img.r2_object_key)
    }
    if (img.thumbnail_key && !r2KeySet.has(img.thumbnail_key)) {
      missingKeys.push(img.thumbnail_key)
    }
  }

  const dbKeys = new Set(
    images.flatMap((img) => [img.r2_object_key, img.thumbnail_key].filter(Boolean) as string[])
  )
  for (const key of r2Keys(r2Objects)) {
    if (!dbKeys.has(key)) orphanedKeys.push(key)
  }

  const report = {
    generated_at: new Date().toISOString(),
    r2_objects: r2Objects.length,
    db_images: images.length,
    missing_r2_keys: missingKeys,
    orphaned_r2_keys: orphanedKeys,
  }
  writeFileSync(join(outDir, 'integrity-report.json'), JSON.stringify(report, null, 2), 'utf8')

  if (missingKeys.length) {
    console.warn(`\n⚠  ${missingKeys.length} DB rows reference R2 keys that don't exist!`)
    missingKeys.forEach((k) => console.warn(`   missing: ${k}`))
  }
  if (orphanedKeys.length) {
    console.warn(`\n⚠  ${orphanedKeys.length} R2 objects have no matching DB row (orphans).`)
  }

  console.log('\n✅ Backup complete.')
  console.log(`   r2-objects.json       — R2 key inventory`)
  console.log(`   supabase-metadata.json — full DB dump`)
  console.log(`   integrity-report.json  — cross-check results`)
  console.log(`\nTo download the actual image files, run:`)
  console.log(`  rclone copy r2:${process.env.R2_BUCKET_NAME} ./backup-files/ --progress`)
}

function r2Keys(objs: { key: string }[]) {
  return objs.map((o) => o.key)
}

main().catch((err) => {
  console.error('❌ Backup failed:', err)
  process.exit(1)
})
