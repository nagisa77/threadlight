#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT_NAME=$(basename "$0")
REPOSITORY_ROOT=
if [ "$SCRIPT_NAME" = self-host.sh ] && [ -f "$SCRIPT_DIR/../package.json" ]; then
  REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
fi
CONFIG_ROOT=${XDG_CONFIG_HOME:-"$HOME/.config"}/threadlight
CONFIG_PATH=${THREADLIGHT_SELF_HOST_CONFIG:-"$CONFIG_ROOT/self-host.json"}
RUNTIME_ROOT=${XDG_DATA_HOME:-"$HOME/.local/share"}/threadlight-self-host
HOST_BIN="$RUNTIME_ROOT/bin/threadlight-host"
MANAGER_BIN="$RUNTIME_ROOT/bin/threadlight-self-host"
SERVICE_NAME=threadlight-host
LOG_ROOT=${THREADLIGHT_SELF_HOST_LOG_ROOT:-"$RUNTIME_ROOT/logs"}
SOURCE_URL=${THREADLIGHT_SELF_HOST_SOURCE_URL:-https://github.com/nagisa77/threadlight/archive/refs/heads/main.tar.gz}
RELEASE_VERSION=${THREADLIGHT_SELF_HOST_VERSION:-}
PACKAGE_URL=${THREADLIGHT_HOST_PACKAGE_URL:-}
if [ -z "$PACKAGE_URL" ] && [ -n "$RELEASE_VERSION" ]; then
  PACKAGE_URL="https://github.com/nagisa77/threadlight/releases/download/v$RELEASE_VERSION/threadlight-host-$RELEASE_VERSION.tgz"
fi
INSTALLER_URL=${THREADLIGHT_SELF_HOST_SCRIPT_URL:-https://threadlight.xyz/install.sh}
MANAGER_VERSION=1.0.0
TEMP_ROOT=

cleanup_temporary_files() {
  if [ -n "$TEMP_ROOT" ] && [ -d "$TEMP_ROOT" ]; then
    find "$TEMP_ROOT" -depth -delete
  fi
}

trap cleanup_temporary_files EXIT HUP INT TERM

install_self_host() {
  listen_host=$(existing_config_value host)
  port=$(existing_config_value port)
  host_name=$(existing_config_value name)
  host_home=$(existing_config_value home)
  project=$(existing_config_value project)
  public_url=$(existing_config_value publicUrl)
  origins=$(existing_config_value origins)
  [ -n "$listen_host" ] || listen_host=127.0.0.1
  [ -n "$port" ] || port=7432
  [ -n "$host_name" ] || host_name=$(hostname)
  [ -n "$host_home" ] || host_home=$RUNTIME_ROOT/data
  home_explicit=0
  migrate_legacy_home=0
  foreground=0
  host_only=0

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --host|--port|--name|--home|--public-url|--origin)
        [ "$#" -ge 2 ] || fail "Missing value for $1"
        option=$1
        value=$2
        shift 2
        case "$option" in
          --host) listen_host=$value ;;
          --port) port=$value ;;
          --name) host_name=$value ;;
          --home)
            host_home=$value
            home_explicit=1
            ;;
          --public-url) public_url=$value ;;
          --origin) origins="${origins}${origins:+
}${value}" ;;
        esac
        ;;
      --foreground)
        foreground=1
        shift
        ;;
      --host-only)
        host_only=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *) fail "Unknown install option: $1" ;;
    esac
  done

  require_command node
  require_command npm
  node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
  [ "$node_major" -ge 22 ] || fail "Node.js 22 or newer is required."
  case "$port" in
    ''|*[!0-9]*) fail "--port must be an integer from 0 to 65535." ;;
  esac
  [ "$port" -le 65535 ] || fail "--port must be an integer from 0 to 65535."

  if [ "$home_explicit" -eq 0 ] && [ "$host_home" = "$HOME/.threadlight" ]; then
    legacy_host_home=$host_home
    host_home=$RUNTIME_ROOT/data
    migrate_legacy_home=1
  fi

  mkdir -p "$host_home" "$CONFIG_ROOT" "$RUNTIME_ROOT" "$LOG_ROOT"
  host_home=$(CDPATH= cd -- "$host_home" && pwd)
  if [ "$migrate_legacy_home" -eq 1 ]; then
    migration_marker=$RUNTIME_ROOT/.legacy-home-migrated
    if [ ! -f "$migration_marker" ] && [ -d "$legacy_host_home" ]; then
      printf 'Migrating the previous shared Host data into the dedicated self-host directory...\n'
      cp -R "$legacy_host_home/." "$host_home/"
      touch "$migration_marker"
    fi
  fi
  if [ -n "$project" ]; then
    [ -d "$project" ] || fail "Project directory does not exist: $project"
    project=$(CDPATH= cd -- "$project" && pwd)
  fi

  token=$(existing_token)
  if [ -z "$token" ]; then
    token=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
  fi

  manager_source=
  if [ -n "$REPOSITORY_ROOT" ]; then
    if [ "$host_only" -eq 1 ]; then
      printf 'Building the Threadlight Host package...\n'
    else
      printf 'Building the bundled Threadlight Host + Web package...\n'
    fi
    if [ ! -x "$REPOSITORY_ROOT/node_modules/.bin/esbuild" ]; then
      (cd "$REPOSITORY_ROOT" && npm ci)
    fi
    (cd "$REPOSITORY_ROOT" && npm run host:package)
    package_version=$(node -p 'require(process.argv[1]).version' "$REPOSITORY_ROOT/package.json")
    package_path="$REPOSITORY_ROOT/artifacts/threadlight-host-$package_version.tgz"
    [ -f "$package_path" ] || fail "The Host package was not created."
    manager_source="$SCRIPT_DIR/self-host.sh"
  elif [ -n "$PACKAGE_URL" ]; then
    if [ "$host_only" -eq 1 ]; then
      printf 'Downloading the configured Threadlight Host package...\n'
    else
      printf 'Downloading the configured Threadlight Host + Web package...\n'
    fi
    TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/threadlight-self-host.XXXXXX")
    package_path="$TEMP_ROOT/threadlight-host.tgz"
    download_file "$PACKAGE_URL" "$package_path"
  else
    require_command tar
    TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/threadlight-self-host.XXXXXX")
    source_archive="$TEMP_ROOT/threadlight-main.tar.gz"
    source_parent="$TEMP_ROOT/source"
    mkdir -p "$source_parent"
    printf 'Downloading the latest Threadlight main source snapshot...\n'
    download_file "$SOURCE_URL" "$source_archive"
    if ! archive_listing=$(tar -tzf "$source_archive"); then
      fail "The downloaded main source snapshot is not a valid tar archive."
    fi
    if printf '%s\n' "$archive_listing" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
      fail "The downloaded main source snapshot contains an unsafe path."
    fi
    tar -xzf "$source_archive" -C "$source_parent"
    set -- "$source_parent"/*
    if [ "$#" -ne 1 ] || [ ! -d "$1" ] || [ ! -f "$1/package.json" ]; then
      fail "The downloaded main source snapshot has an unexpected layout."
    fi
    downloaded_repository_root=$1
    if [ "$host_only" -eq 1 ]; then
      printf 'Building the latest Threadlight main Host package...\n'
    else
      printf 'Building the latest Threadlight main Host + Web package...\n'
    fi
    (cd "$downloaded_repository_root" && npm ci && npm run host:package)
    package_version=$(node -p 'require(process.argv[1]).version' "$downloaded_repository_root/package.json")
    package_path="$downloaded_repository_root/artifacts/threadlight-host-$package_version.tgz"
    [ -f "$package_path" ] || fail "The Host package was not created from the main source snapshot."
    manager_source="$downloaded_repository_root/scripts/self-host.sh"
  fi

  npm install --global --prefix "$RUNTIME_ROOT" "$package_path"
  [ -x "$HOST_BIN" ] || fail "The installed threadlight-host executable was not found."
  node_pty_root="$RUNTIME_ROOT/lib/node_modules/@threadlight/host/node_modules/node-pty"
  if [ -d "$node_pty_root/prebuilds" ]; then
    find "$node_pty_root/prebuilds" -type f -name spawn-helper -exec chmod 0755 {} \;
  fi
  if [ -f "$node_pty_root/build/Release/spawn-helper" ]; then
    chmod 0755 "$node_pty_root/build/Release/spawn-helper"
  fi
  if [ "$host_only" -eq 1 ]; then
    bundled_web_root="$RUNTIME_ROOT/lib/node_modules/@threadlight/host/web"
    if [ -d "$bundled_web_root" ]; then
      find "$bundled_web_root" -depth -delete
    fi
  fi
  if [ -n "$manager_source" ] && [ -f "$manager_source" ]; then
    cp "$manager_source" "$MANAGER_BIN"
  else
    download_file "$INSTALLER_URL" "$MANAGER_BIN"
  fi
  chmod 0755 "$MANAGER_BIN"
  cleanup_temporary_files
  TEMP_ROOT=

  SELF_HOST_TOKEN=$token \
  SELF_HOST_LISTEN=$listen_host \
  SELF_HOST_PORT=$port \
  SELF_HOST_HOME=$host_home \
  SELF_HOST_PROJECT=$project \
  SELF_HOST_NAME=$host_name \
  SELF_HOST_PUBLIC_URL=$public_url \
  SELF_HOST_ORIGINS=$origins \
  node - "$CONFIG_PATH" <<'NODE'
const { chmodSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const path = process.argv[2];
const config = {
  token: process.env.SELF_HOST_TOKEN,
  host: process.env.SELF_HOST_LISTEN,
  port: Number(process.env.SELF_HOST_PORT),
  home: process.env.SELF_HOST_HOME,
  name: process.env.SELF_HOST_NAME,
};
if (process.env.SELF_HOST_PROJECT) config.project = process.env.SELF_HOST_PROJECT;
if (process.env.SELF_HOST_PUBLIC_URL) config.publicUrl = process.env.SELF_HOST_PUBLIC_URL;
const origins = [...new Set((process.env.SELF_HOST_ORIGINS || "").split("\n").filter(Boolean))];
if (origins.length) config.origins = origins;
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
chmodSync(path, 0o600);
NODE

  if [ "$foreground" -eq 1 ]; then
    print_connection_details "$listen_host" "$port" "$public_url" "$token" "$host_only"
    exec "$HOST_BIN" --config "$CONFIG_PATH"
  fi

  install_service "$host_only"
  print_connection_details "$listen_host" "$port" "$public_url" "$token" "$host_only"
  printf 'Config: %s (mode 0600)\n' "$CONFIG_PATH"
  printf 'Add a project from the Web UI after connecting.\n'
  printf 'Manage: %s status | logs | restart | stop | show-token\n' "$MANAGER_BIN"
}

install_service() {
  host_only=$1
  service_description="Threadlight self-hosted Host and Web"
  if [ "$host_only" -eq 1 ]; then
    service_description="Threadlight self-hosted Host"
  fi
  platform=$(uname -s)
  case "$platform" in
    Linux)
      require_command systemctl
      unit_root=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user
      unit_path=$unit_root/$SERVICE_NAME.service
      mkdir -p "$unit_root"
      SELF_HOST_BIN=$HOST_BIN \
      SELF_HOST_CONFIG=$CONFIG_PATH \
      SELF_HOST_PATH=$PATH \
      SELF_HOST_DESCRIPTION=$service_description \
      node - "$unit_path" <<'NODE'
const { writeFileSync } = require("node:fs");
const quote = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const unit = `[Unit]
Description=${process.env.SELF_HOST_DESCRIPTION}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${quote(process.env.SELF_HOST_BIN)} --config ${quote(process.env.SELF_HOST_CONFIG)}
WorkingDirectory=~
Environment=${quote(`PATH=${process.env.SELF_HOST_PATH}`)}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
writeFileSync(process.argv[2], unit);
NODE
      systemctl --user daemon-reload
      systemctl --user enable "$SERVICE_NAME.service"
      systemctl --user restart "$SERVICE_NAME.service"
      ;;
    Darwin)
      plist_root=$HOME/Library/LaunchAgents
      plist_path=$plist_root/io.github.nagisa77.threadlight-host.plist
      mkdir -p "$plist_root"
      SELF_HOST_BIN=$HOST_BIN \
      SELF_HOST_CONFIG=$CONFIG_PATH \
      SELF_HOST_PATH=$PATH \
      SELF_HOST_LOG_ROOT=$LOG_ROOT \
      node - "$plist_path" <<'NODE'
const { writeFileSync } = require("node:fs");
const escape = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>io.github.nagisa77.threadlight-host</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(process.env.SELF_HOST_BIN)}</string>
    <string>--config</string>
    <string>${escape(process.env.SELF_HOST_CONFIG)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${escape(process.env.SELF_HOST_PATH)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${escape(`${process.env.SELF_HOST_LOG_ROOT}/host.log`)}</string>
  <key>StandardErrorPath</key><string>${escape(`${process.env.SELF_HOST_LOG_ROOT}/host.log`)}</string>
</dict>
</plist>
`;
writeFileSync(process.argv[2], plist);
NODE
      launchctl bootout "gui/$(id -u)/io.github.nagisa77.threadlight-host" >/dev/null 2>&1 || true
      bootstrap_attempt=1
      while ! launchctl bootstrap "gui/$(id -u)" "$plist_path"; do
        if [ "$bootstrap_attempt" -ge 5 ]; then
          fail "Could not register the macOS Host service after 5 attempts."
        fi
        bootstrap_attempt=$((bootstrap_attempt + 1))
        sleep 1
      done
      launchctl kickstart -k "gui/$(id -u)/io.github.nagisa77.threadlight-host"
      ;;
    *)
      fail "Automatic service installation supports Linux systemd and macOS launchd. Re-run with --foreground on this platform."
      ;;
  esac
}

service_action() {
  action=$1
  platform=$(uname -s)
  case "$platform" in
    Linux)
      case "$action" in
        start|restart) systemctl --user "$action" "$SERVICE_NAME.service" ;;
        stop) systemctl --user stop "$SERVICE_NAME.service" ;;
        status) systemctl --user status --no-pager "$SERVICE_NAME.service" ;;
      esac
      ;;
    Darwin)
      label=io.github.nagisa77.threadlight-host
      domain="gui/$(id -u)"
      plist_path=$HOME/Library/LaunchAgents/$label.plist
      case "$action" in
        start)
          launchctl print "$domain/$label" >/dev/null 2>&1 ||
            launchctl bootstrap "$domain" "$plist_path"
          launchctl kickstart "$domain/$label"
          ;;
        restart)
          launchctl print "$domain/$label" >/dev/null 2>&1 ||
            launchctl bootstrap "$domain" "$plist_path"
          launchctl kickstart -k "$domain/$label"
          ;;
        stop) launchctl bootout "$domain/$label" ;;
        status) launchctl print "$domain/$label" ;;
      esac
      ;;
    *) fail "Service management supports Linux systemd and macOS launchd." ;;
  esac
}

service_logs() {
  case "$(uname -s)" in
    Linux) exec journalctl --user-unit "$SERVICE_NAME.service" -f ;;
    Darwin)
      mkdir -p "$LOG_ROOT"
      touch "$LOG_ROOT/host.log"
      exec tail -f "$LOG_ROOT/host.log"
      ;;
    *) fail "Log streaming supports Linux systemd and macOS launchd." ;;
  esac
}

existing_token() {
  existing_config_value token
}

existing_config_value() {
  key=$1
  if [ ! -f "$CONFIG_PATH" ]; then
    return
  fi
  node - "$CONFIG_PATH" "$key" <<'NODE' 2>/dev/null || true
const { readFileSync } = require("node:fs");
const value = JSON.parse(readFileSync(process.argv[2], "utf8"))[process.argv[3]];
if (Array.isArray(value)) process.stdout.write(value.join("\n"));
else if (typeof value === "string" || typeof value === "number") process.stdout.write(String(value));
NODE
}

show_token() {
  [ -f "$CONFIG_PATH" ] || fail "No self-host config found at $CONFIG_PATH"
  token=$(existing_token)
  [ -n "$token" ] || fail "The self-host config does not contain a token."
  printf '%s\n' "$token"
}

print_connection_details() {
  listen_host=$1
  port=$2
  public_url=$3
  token=$4
  host_only=$5
  if [ -n "$public_url" ]; then
    url=${public_url%/}
  else
    case "$listen_host" in
      0.0.0.0|::) browser_host=127.0.0.1 ;;
      *:*) browser_host="[$listen_host]" ;;
      *) browser_host=$listen_host ;;
    esac
    url="http://$browser_host:$port"
  fi
  if [ "$host_only" -eq 1 ]; then
    printf '\nThreadlight Host is ready.\n'
    printf 'Host:  %s\n' "$url"
    printf 'Web:   https://nagisa77.github.io/threadlight/\n'
  else
    printf '\nThreadlight Host + Web is ready.\n'
    printf 'Open:  %s\n' "$url"
  fi
  printf 'Token: %s\n' "$token"
  if [ "$listen_host" = 127.0.0.1 ] || [ "$listen_host" = ::1 ]; then
    printf 'Remote server: keep this loopback binding and use an SSH tunnel, VPN, or HTTPS reverse proxy.\n'
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

download_file() {
  source_url=$1
  destination=$2
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --silent --show-error --retry 3 \
      --header 'Cache-Control: no-cache' \
      --output "$destination" "$source_url"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet --tries=3 --header='Cache-Control: no-cache' \
      --output-document="$destination" "$source_url"
  else
    fail "curl or wget is required to download Threadlight."
  fi
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

print_version() {
  printf 'threadlight-self-host %s\n' "$MANAGER_VERSION"
}

usage() {
  cat <<'EOF'
Usage: threadlight-self-host <command> [options]

Commands:
  install       Download, install, configure, and start Host + Web (default)
  start         Start the installed service
  stop          Stop the installed service
  restart       Restart the installed service
  status        Show service status
  logs          Follow service logs
  show-token    Print the saved Web access token
  version       Print the service manager version without contacting the service

Install options:
  --host <address>      Listen address (default: 127.0.0.1)
  --port <port>         Listen port (default: 7432)
  --name <name>         Host name shown in Threadlight
  --home <path>         Host data directory (default: ~/.local/share/threadlight-self-host/data)
  --public-url <url>    HTTPS public URL used for OAuth callbacks and output
  --origin <url>        Additional allowed Web origin; may be repeated
  --host-only          Install the Host without the bundled Web UI
  --foreground          Run in the current terminal instead of a system service

The bundled Web UI is served by the Host on the same port. The generated token
is saved only in a mode-0600 JSON config and is never written to source or logs.
The Host starts empty; add projects from the Web UI after connecting.
EOF
}

command=${1:-install}
if [ "$#" -gt 0 ]; then shift; fi

case "$command" in
  install) install_self_host "$@" ;;
  start) service_action start ;;
  stop) service_action stop ;;
  restart) service_action restart ;;
  status) service_action status ;;
  logs) service_logs ;;
  show-token) show_token ;;
  version|--version) print_version ;;
  help|-h|--help) usage ;;
  *)
    printf 'Unknown command: %s\n\n' "$command" >&2
    usage >&2
    exit 2
    ;;
esac
