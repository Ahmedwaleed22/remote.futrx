#!/usr/bin/env bash
# HELLO REMOTE SERVICE INSTALLER
#
# Remote runs this as root inside the target LXD container after it has already
# packaged, built, and installed every program under backend/container/.
# This example deliberately uses every infrastructure field: it writes
# configuration, creates a systemd unit, starts it, and waits for readiness.
# Re-running the script converges the same files and restarts the same unit.
set -euo pipefail

: "${APP_SERVICE:?APP_SERVICE is required}"
: "${APP_INTERNAL_PORT:?APP_INTERNAL_PORT is required}"
: "${HELLO_GREETING:?HELLO_GREETING is required}"
: "${HELLO_USER:?HELLO_USER is required}"
: "${HELLO_PASSWORD:?HELLO_PASSWORD is required}"
: "${HELLO_DATABASE:?HELLO_DATABASE is required}"

CONFIG_DIR=/etc/hello-remote
ENV_FILE="${CONFIG_DIR}/service.env"
UNIT_FILE="/etc/systemd/system/${APP_SERVICE}.service"

encode() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

install -d -m 0755 "$CONFIG_DIR"
umask 077
{
  printf 'HELLO_GREETING_B64=%s\n' "$(encode "$HELLO_GREETING")"
  printf 'HELLO_USER_B64=%s\n' "$(encode "$HELLO_USER")"
  printf 'HELLO_PASSWORD_B64=%s\n' "$(encode "$HELLO_PASSWORD")"
  printf 'HELLO_DATABASE_B64=%s\n' "$(encode "$HELLO_DATABASE")"
} >"$ENV_FILE"
chmod 0600 "$ENV_FILE"

cat >"$UNIT_FILE" <<EOF
[Unit]
Description=Hello Remote example service
After=network.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=/usr/local/bin/hello-remote-service serve --port $APP_INTERNAL_PORT
Restart=on-failure
RestartSec=1s
User=nobody
Group=nogroup
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
EOF

# An expected application daemon must not make an otherwise idle project look
# busy forever. The workspace probe reads these application-owned declarations.
install -d -m 0755 /etc/remote/workspace-idle.d
printf '%s\n' "$APP_SERVICE" >"/etc/remote/workspace-idle.d/${APP_SERVICE}"

systemctl daemon-reload
systemctl enable "$APP_SERVICE" >/dev/null
systemctl restart "$APP_SERVICE"

for _ in $(seq 1 30); do
  if /usr/local/bin/hello-remote-service health --port "$APP_INTERNAL_PORT"; then
    echo "install: ${APP_SERVICE} ready on port ${APP_INTERNAL_PORT}"
    exit 0
  fi
  sleep 1
done

echo "install: ${APP_SERVICE} did not become ready" >&2
exit 1
