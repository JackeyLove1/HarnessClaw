import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import { ensureChatSchema } from '../chat/sqlite-schema'

let db: Database.Database | null = null

export interface NoteRecord {
  id: number
  title: string
  lastEditTime: number
}

export const initDatabase = (): Database.Database => {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'notemark.db')
  db = new Database(dbPath)

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Create notes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE,
      lastEditTime INTEGER NOT NULL,
      createdAt INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `)

  // Create index for faster lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notes_title ON notes(title);
    CREATE INDEX IF NOT EXISTS idx_notes_lastEditTime ON notes(lastEditTime DESC);
  `)

  ensureChatSchema(db)

  console.info(`[Database] Initialized at ${dbPath}`)
  return db
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
  const stmt = getDatabase().prepare('SELECT id, title, lastEditTime FROM notes ORDER BY lastEditTime DESC')
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
  const stmt = getDatabase().prepare('SELECT id, title, lastEditTime FROM notes WHERE title LIKE ? ORDER BY lastEditTime DESC')
  return stmt.all(`%${query}%`) as NoteRecord[]
}
