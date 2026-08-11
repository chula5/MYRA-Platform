import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Bucket,
  Destination,
  Draft,
  Item,
  Row,
  Settings,
  Source,
  Status,
} from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'seen.db');

let _db: DatabaseSync | null = null;

/**
 * One SQLite file, no external infra. Next dev reloads modules, so the handle
 * is cached on globalThis to avoid opening a new connection per hot reload.
 */
export function db(): DatabaseSync {
  const g = globalThis as { __seenDb?: DatabaseSync };
  if (g.__seenDb) return g.__seenDb;
  if (_db) return _db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const conn = new DatabaseSync(DB_PATH);
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA foreign_keys = ON');
  migrate(conn);

  _db = conn;
  g.__seenDb = conn;
  return conn;
}

function migrate(conn: DatabaseSync) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id             TEXT PRIMARY KEY,
      created_at     TEXT NOT NULL,
      source         TEXT NOT NULL,
      bucket         TEXT,
      image_url      TEXT,
      extracted_text TEXT,
      captured_at    TEXT,
      status         TEXT NOT NULL DEFAULT 'new'
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id             TEXT PRIMARY KEY,
      item_id        TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      draft_text     TEXT NOT NULL,
      draft_type     TEXT NOT NULL,
      generated_at   TEXT NOT NULL,
      edited_by_user INTEGER NOT NULL DEFAULT 0,
      version        INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS exports (
      id          TEXT PRIMARY KEY,
      draft_id    TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      destination TEXT NOT NULL,
      exported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id                      INTEGER PRIMARY KEY CHECK (id = 1),
      my_business_description TEXT NOT NULL DEFAULT '',
      my_tone_of_voice        TEXT NOT NULL DEFAULT '',
      my_offer                TEXT NOT NULL DEFAULT '',
      photos_connected        INTEGER NOT NULL DEFAULT 0,
      instagram_connected     INTEGER NOT NULL DEFAULT 0,
      instagram_token         TEXT,
      instagram_user_id       TEXT,
      updated_at              TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_items_bucket ON items(bucket);
    CREATE INDEX IF NOT EXISTS idx_drafts_item  ON drafts(item_id, version DESC);
  `);

  conn.exec(`INSERT OR IGNORE INTO settings (id) VALUES (1)`);
}

/**
 * node:sqlite hands back null-prototype objects. React refuses to serialise
 * those across the server/client component boundary, so every row leaving this
 * module gets copied into a plain object first.
 */
function plain<T>(row: unknown): T | null {
  return row ? ({ ...(row as object) } as T) : null;
}

function plainAll<T>(rows: unknown[]): T[] {
  return rows.map((r) => ({ ...(r as object) }) as T);
}

export function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const now = () => new Date().toISOString();

/* ---------------------------------------------------------------- settings */

export function getSettings(): Settings {
  const row = db().prepare(`SELECT * FROM settings WHERE id = 1`).get() as
    | Record<string, unknown>
    | undefined;
  return {
    my_business_description: String(row?.my_business_description ?? ''),
    my_tone_of_voice: String(row?.my_tone_of_voice ?? ''),
    my_offer: String(row?.my_offer ?? ''),
    photos_connected: Number(row?.photos_connected ?? 0),
    instagram_connected: Number(row?.instagram_connected ?? 0),
    instagram_token: (row?.instagram_token as string | null) ?? null,
    instagram_user_id: (row?.instagram_user_id as string | null) ?? null,
    updated_at: (row?.updated_at as string | null) ?? null,
  };
}

export function saveVoice(v: {
  my_business_description: string;
  my_tone_of_voice: string;
  my_offer: string;
}) {
  db()
    .prepare(
      `UPDATE settings SET my_business_description = ?, my_tone_of_voice = ?,
       my_offer = ?, updated_at = ? WHERE id = 1`,
    )
    .run(v.my_business_description, v.my_tone_of_voice, v.my_offer, now());
}

export function setConnection(
  provider: 'photos' | 'instagram',
  connected: boolean,
  token?: string | null,
  userId?: string | null,
) {
  if (provider === 'photos') {
    db()
      .prepare(`UPDATE settings SET photos_connected = ?, updated_at = ? WHERE id = 1`)
      .run(connected ? 1 : 0, now());
  } else {
    db()
      .prepare(
        `UPDATE settings SET instagram_connected = ?, instagram_token = ?,
         instagram_user_id = ?, updated_at = ? WHERE id = 1`,
      )
      .run(connected ? 1 : 0, token ?? null, userId ?? null, now());
  }
}

/* ------------------------------------------------------------------- items */

export function createItem(input: {
  source: Source;
  image_url: string | null;
  captured_at: string | null;
  extracted_text?: string | null;
  bucket?: Bucket | null;
}): Item {
  const item: Item = {
    id: id('itm'),
    created_at: now(),
    source: input.source,
    bucket: input.bucket ?? null,
    image_url: input.image_url,
    extracted_text: input.extracted_text ?? null,
    captured_at: input.captured_at,
    status: 'new',
  };
  db()
    .prepare(
      `INSERT INTO items (id, created_at, source, bucket, image_url, extracted_text, captured_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      item.id,
      item.created_at,
      item.source,
      item.bucket,
      item.image_url,
      item.extracted_text,
      item.captured_at,
      item.status,
    );
  return item;
}

export function getItem(itemId: string): Item | null {
  return plain<Item>(db().prepare(`SELECT * FROM items WHERE id = ?`).get(itemId));
}

export function listItems(bucket?: Bucket): Item[] {
  const sql = bucket
    ? `SELECT * FROM items WHERE bucket = ? AND status != 'dismissed' ORDER BY captured_at DESC, created_at DESC`
    : `SELECT * FROM items WHERE status != 'dismissed' ORDER BY captured_at DESC, created_at DESC`;
  const stmt = db().prepare(sql);
  return plainAll<Item>(bucket ? stmt.all(bucket) : stmt.all());
}

export function itemsAwaitingExtraction(): Item[] {
  return plainAll<Item>(
    db()
      .prepare(`SELECT * FROM items WHERE bucket IS NULL AND status != 'dismissed'`)
      .all(),
  );
}

export function itemsAwaitingDraft(): Item[] {
  return plainAll<Item>(
    db()
      .prepare(
        `SELECT i.* FROM items i
         LEFT JOIN drafts d ON d.item_id = i.id
         WHERE i.bucket IS NOT NULL AND i.status != 'dismissed' AND d.id IS NULL`,
      )
      .all(),
  );
}

export function updateItem(
  itemId: string,
  patch: { bucket?: Bucket; status?: Status; extracted_text?: string },
) {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (patch.bucket !== undefined) {
    sets.push('bucket = ?');
    vals.push(patch.bucket);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    vals.push(patch.status);
  }
  if (patch.extracted_text !== undefined) {
    sets.push('extracted_text = ?');
    vals.push(patch.extracted_text);
  }
  if (!sets.length) return;
  vals.push(itemId);
  db().prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/* ------------------------------------------------------------------ drafts */

export function latestDraft(itemId: string): Draft | null {
  return plain<Draft>(
    db()
      .prepare(`SELECT * FROM drafts WHERE item_id = ? ORDER BY version DESC LIMIT 1`)
      .get(itemId),
  );
}

export function createDraft(input: {
  item_id: string;
  draft_text: string;
  draft_type: string;
  edited_by_user?: boolean;
}): Draft {
  const prev = latestDraft(input.item_id);
  const draft: Draft = {
    id: id('drf'),
    item_id: input.item_id,
    draft_text: input.draft_text,
    draft_type: input.draft_type,
    generated_at: now(),
    edited_by_user: input.edited_by_user ? 1 : 0,
    version: (prev?.version ?? 0) + 1,
  };
  db()
    .prepare(
      `INSERT INTO drafts (id, item_id, draft_text, draft_type, generated_at, edited_by_user, version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      draft.id,
      draft.item_id,
      draft.draft_text,
      draft.draft_type,
      draft.generated_at,
      draft.edited_by_user,
      draft.version,
    );
  db().prepare(`UPDATE items SET status = 'drafted' WHERE id = ? AND status = 'new'`).run(
    input.item_id,
  );
  return draft;
}

/* ----------------------------------------------------------------- exports */

export function recordExport(draftId: string, destination: Destination) {
  db()
    .prepare(`INSERT INTO exports (id, draft_id, destination, exported_at) VALUES (?, ?, ?, ?)`)
    .run(id('exp'), draftId, destination, now());
}

/* ------------------------------------------------------------------- views */

export function rows(bucket?: Bucket): Row[] {
  return listItems(bucket).map((item) => ({ item, draft: latestDraft(item.id) }));
}

export function counts() {
  const total = (
    db().prepare(`SELECT COUNT(*) AS n FROM items WHERE status != 'dismissed'`).get() as {
      n: number;
    }
  ).n;
  const acted = (
    db().prepare(`SELECT COUNT(DISTINCT draft_id) AS n FROM exports`).get() as { n: number }
  ).n;
  const byBucket = Object.fromEntries(
    (
      plainAll<{ bucket: Bucket; n: number }>(
        db()
          .prepare(
            `SELECT bucket, COUNT(*) AS n FROM items
             WHERE bucket IS NOT NULL AND status != 'dismissed' GROUP BY bucket`,
          )
          .all(),
      )
    ).map((r) => [r.bucket, r.n]),
  ) as Partial<Record<Bucket, number>>;
  const undrafted = itemsAwaitingDraft().length;
  const unsorted = itemsAwaitingExtraction().length;
  return { total, acted, byBucket, undrafted, unsorted };
}
