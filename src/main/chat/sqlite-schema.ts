import type Database from 'better-sqlite3'

export const ensureChatSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      messageCount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL,
      eventId TEXT NOT NULL UNIQUE,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      searchableText TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updatedAt ON chat_sessions(updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_events_session_timestamp ON chat_events(sessionId, timestamp, id);
  `)

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chat_events_fts USING fts5(
      searchableText,
      content='chat_events',
      content_rowid='id'
    );
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chat_events_ai AFTER INSERT ON chat_events BEGIN
      INSERT INTO chat_events_fts(rowid, searchableText) VALUES (new.id, new.searchableText);
    END;
    CREATE TRIGGER IF NOT EXISTS chat_events_ad AFTER DELETE ON chat_events BEGIN
      INSERT INTO chat_events_fts(chat_events_fts, rowid, searchableText) VALUES ('delete', old.id, old.searchableText);
    END;
    CREATE TRIGGER IF NOT EXISTS chat_events_au AFTER UPDATE ON chat_events BEGIN
      INSERT INTO chat_events_fts(chat_events_fts, rowid, searchableText) VALUES ('delete', old.id, old.searchableText);
      INSERT INTO chat_events_fts(rowid, searchableText) VALUES (new.id, new.searchableText);
    END;
  `)
}
