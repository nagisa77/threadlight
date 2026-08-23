SELECT
  COUNT(DISTINCT CASE WHEN event_name = 'site_visited' THEN anonymous_id END) AS visitors,
  COUNT(DISTINCT CASE WHEN event_name IN ('download_clicked', 'install_command_copied') THEN anonymous_id END) AS download_or_copy,
  COUNT(DISTINCT CASE WHEN event_name = 'install_succeeded' THEN anonymous_id END) AS installed,
  COUNT(DISTINCT CASE WHEN event_name = 'first_task_completed' THEN anonymous_id END) AS first_task_completed
FROM product_events
WHERE received_at >= datetime('now', '-30 days');

SELECT
  source,
  event_name,
  COUNT(*) AS events,
  COUNT(DISTINCT anonymous_id) AS anonymous_installations
FROM product_events
WHERE received_at >= datetime('now', '-30 days')
GROUP BY source, event_name
ORDER BY source, event_name;

SELECT
  substr(received_at, 1, 10) AS day,
  event_name,
  COUNT(DISTINCT anonymous_id) AS anonymous_installations
FROM product_events
WHERE received_at >= datetime('now', '-30 days')
GROUP BY day, event_name
ORDER BY day DESC, event_name;
