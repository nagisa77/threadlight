# Anonymous product telemetry

Threadlight 1.1 records a deliberately small, first-party product funnel so the
project can distinguish discovery problems from installation and activation
problems.

## Events

| Event                    | Meaning                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `site_visited`           | The project website loaded.                                                  |
| `download_clicked`       | The macOS download link was selected.                                        |
| `install_command_copied` | A Host installation command was copied.                                      |
| `install_succeeded`      | The desktop app or self-hosted Host started successfully for the first time. |
| `first_task_completed`   | The installation completed its first successful model turn.                  |

Events contain only a random anonymous installation ID, event ID, event name,
timestamp, Threadlight version, coarse platform, source (`website`, `desktop`,
`self_host`, or source checkout), website path, and launch variant. Threadlight
does **not** send prompts, responses, code, project names, file paths, model or
provider names, API keys, access tokens, host names, or IP addresses. The Pages
Function does not persist Cloudflare request metadata.

The website and application send events to the first-party endpoint at
`https://threadlight.xyz/api/events`. Cloudflare Pages stores validated events
in the `threadlight-telemetry` D1 database. The public client contains no
database credential or reporting secret.

## Attribution boundaries

The one-line Host installer carries the website's random visitor ID into the
installed Host, so that path can be analyzed as a true anonymous funnel. A DMG
download cannot safely carry browser-local state into a desktop application;
desktop download clicks and desktop activations are therefore compared as
aggregate counts rather than joined user-by-user.

## Opt out

Set `THREADLIGHT_TELEMETRY_DISABLED=1` before starting Threadlight. For managed
self-hosting, the installer persists this choice as
`<host-home>/telemetry-disabled`. For an existing desktop or source install,
create `~/.threadlight/telemetry-disabled`. Removing the marker opts back in.

## Query the funnel

Only the Cloudflare account owner can query the database:

```bash
npm run telemetry:report
```

The checked-in query reports unique anonymous IDs at each stage, source/event
breakdowns, and daily counts for the last 30 days. Apply schema changes with:

```bash
npx --yes wrangler@4.120.0 d1 migrations apply threadlight-telemetry --remote
```
