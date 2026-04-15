import type Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'path'
import { ensureChatSchema } from '../chat/sqlite-schema'

let db: Database.Database | null = null
type BetterSqlite3Ctor = new (filename: string) => Database.Database
let databaseCtor: BetterSqlite3Ctor | null = null

const loadDatabaseCtor = (): BetterSqlite3Ctor => {
  if (databaseCtor) {
    return databaseCtor
  }

  const require = createRequire(import.meta.url)
  const mod = require('better-sqlite3') as
    | BetterSqlite3Ctor
    | { default?: BetterSqlite3Ctor }
  const ctor = typeof mod === 'function' ? mod : mod.default

  if (!ctor) {
    throw new Error('Failed to load better-sqlite3 module.')
  }

  databaseCtor = ctor
  return ctor
}

export interface NoteRecord {
  id: number
  title: string
  lastEditTime: number
}

export const initDatabase = (): Database.Database => {
  if (db) return db

  const dbDirectory = path.join(os.homedir(), '.deepclaw')
  mkdirSync(dbDirectory, { recursive: true })
  const dbPath = path.join(dbDirectory, 'deepclaw.db')
  const DatabaseCtor = loadDatabaseCtor()
  db = new DatabaseCtor(dbPath)
  const initializedDb = db

  // Enable WAL mode for better performance
  initializedDb.pragma('journal_mode = WAL')
  initializedDb.pragma('foreign_keys = ON')

  // Create notes table
  initializedDb.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE,
      lastEditTime INTEGER NOT NULL,
      createdAt INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `)

  // Create index for faster lookups
  initializedDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_notes_title ON notes(title);
    CREATE INDEX IF NOT EXISTS idx_notes_lastEditTime ON notes(lastEditTime DESC);
  `)

  ensureChatSchema(initializedDb)

  console.info(`[Database] Initialized at ${dbPath}`)
  return initializedDb
}

export const getDatabase = (): Database.Database => {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export const closeDatabase = (): void => {
  if (db) {
    db.close()
    db = null
    console.info('[Database] Closed')
  }
}

// Note operations
export const getAllNotes = (): NoteRecord[] => {
  const stmt = getDatabase().prepare(
    'SELECT id, title, lastEditTime FROM notes ORDER BY lastEditTime DESC'
  )
  return stmt.all() as NoteRecord[]
}

export const getNoteByTitle = (title: string): NoteRecord | undefined => {
  const stmt = getDatabase().prepare('SELECT id, title, lastEditTime FROM notes WHERE title = ?')
  return stmt.get(title) as NoteRecord | undefined
}

export const insertNote = (title: string, lastEditTime: number): NoteRecord => {
  const stmt = getDatabase().prepare('INSERT INTO notes (title, lastEditTime) VALUES (?, ?)')
  const result = stmt.run(title, lastEditTime)
  return {
    id: result.lastInsertRowid as number,
    title,
    lastEditTime
  }
}

export const updateNoteTimestamp = (title: string, lastEditTime: number): void => {
  const stmt = getDatabase().prepare('UPDATE notes SET lastEditTime = ? WHERE title = ?')
  stmt.run(lastEditTime, title)
}

export const deleteNoteByTitle = (title: string): boolean => {
  const stmt = getDatabase().prepare('DELETE FROM notes WHERE title = ?')
  const result = stmt.run(title)
  return result.changes > 0
}

export const searchNotes = (query: string): NoteRecord[] => {
  const stmt = getDatabase().prepare(
    'SELECT id, title, lastEditTime FROM notes WHERE title LIKE ? ORDER BY lastEditTime DESC'
  )
  return stmt.all(`%${query}%`) as NoteRecord[]
}
