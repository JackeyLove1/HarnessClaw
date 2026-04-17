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
    CREATE TABLE IF NOT EXISTS chat_usage_records (
      id TEXT PRIMARY KEY,
      sessionId TEXT,
      assistantMessageId TEXT,
      requestRound INTEGER NOT NULL,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      inputTokens INTEGER NOT NULL DEFAULT 0,
      outputTokens INTEGER NOT NULL DEFAULT 0,
      cacheCreationTokens INTEGER NOT NULL DEFAULT 0,
      cacheReadTokens INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES chat_sessions(id) ON DELETE SET NULL
    );
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_usage_timestamp ON chat_usage_records(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_usage_session ON chat_usage_records(sessionId, timestamp DESC);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_usage_records (
      id TEXT PRIMARY KEY,
      toolCallId TEXT NOT NULL UNIQUE,
      sessionId TEXT,
      assistantMessageId TEXT,
      requestRound INTEGER NOT NULL,
      toolName TEXT NOT NULL,
      callType TEXT NOT NULL,
      status TEXT NOT NULL,
      durationMs INTEGER NOT NULL DEFAULT 0,
      argsSummary TEXT NOT NULL DEFAULT '',
      outputSummary TEXT NOT NULL DEFAULT '',
      roundInputTokens INTEGER NOT NULL DEFAULT 0,
      roundOutputTokens INTEGER NOT NULL DEFAULT 0,
      roundCacheCreationTokens INTEGER NOT NULL DEFAULT 0,
      roundCacheReadTokens INTEGER NOT NULL DEFAULT 0,
      roundToolCallCount INTEGER NOT NULL DEFAULT 1,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES chat_sessions(id) ON DELETE SET NULL
    );
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_usage_timestamp ON tool_usage_records(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_usage_name_timestamp ON tool_usage_records(toolName, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_usage_session_timestamp ON tool_usage_records(sessionId, timestamp DESC);
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
