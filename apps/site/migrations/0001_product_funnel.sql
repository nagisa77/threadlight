CREATE TABLE product_events (
  event_id TEXT PRIMARY KEY,
  anonymous_id TEXT NOT NULL,
  event_name TEXT NOT NULL CHECK (
    event_name IN (
      'site_visited',
      'download_clicked',
      'install_command_copied',
      'install_succeeded',
      'first_task_completed'
    )
  ),
  source TEXT NOT NULL CHECK (
    source IN ('website', 'desktop', 'self_host', 'source')
  ),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  app_version TEXT,
  platform TEXT,
  path TEXT,
  variant TEXT
) STRICT;

CREATE INDEX product_events_name_received_idx
  ON product_events (event_name, received_at);

CREATE INDEX product_events_anonymous_received_idx
  ON product_events (anonymous_id, received_at);
