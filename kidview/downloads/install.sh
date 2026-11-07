#!/bin/sh
# Installs the KidView server with Docker, or updates it. Run the same command again to update:
#
#   curl -fsSL https://myapps.thejumpvault.com/kidview/install.sh | sh
#
# KidView goes in ~/kidview (set KIDVIEW_DIR to choose another folder). Settings, activity and saved
# videos live in its data folder and are kept through updates.
set -eu

SITE="https://myapps.thejumpvault.com/kidview/"
DIR="${KIDVIEW_DIR:-$HOME/kidview}"

command -v docker >/dev/null 2>&1 || { echo "Docker isn't installed. Install it first: https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose isn't available. Install Docker's compose plugin first."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Can't reach Docker. Add yourself to the docker group, or run: curl -fsSL ${SITE}install.sh | sudo KIDVIEW_DIR=\"$DIR\" sh"; exit 1; }

mkdir -p "$DIR"
cd "$DIR"

echo "Downloading the latest KidView server..."
# One line, "<path> <sha256>", naming the newest published server package.
latest=$(curl -fsSL "${SITE}server-latest.txt")
path=${latest%% *}
want=$(printf '%s' "${latest#* }" | tr -d '[:space:]')
curl -fsSL "${SITE}${path}?h=$(printf '%s' "$want" | cut -c1-12)" -o kidview-server.tar.gz
have=$( (sha256sum kidview-server.tar.gz 2>/dev/null || shasum -a 256 kidview-server.tar.gz) | cut -d' ' -f1)
if [ "$want" != "$have" ]; then
    rm -f kidview-server.tar.gz
    echo "The download was damaged. Please try again."
    exit 1
fi
rm -rf server.new
mkdir server.new
tar -xzf kidview-server.tar.gz -C server.new
rm -f kidview-server.tar.gz
rm -rf server
mv server.new server

if [ ! -f compose.yml ]; then
    cat > compose.yml <<'EOF'
# KidView server. Commands (run in this folder):
#   Logs:    docker compose logs -f kidview      (the one-time setup code is printed here)
#   Stop:    docker compose down
#   Update:  run the install command from the KidView website again
services:
  kidview:
    build: ./server
    image: kidview:local
    container_name: kidview
    restart: unless-stopped
    ports:
      - "8765:8765"   # keep this inside your home network: don't forward it on your router
    volumes:
      - ./data:/data                       # settings, activity and saved videos
      - /etc/localtime:/etc/localtime:ro   # schedules follow this computer's clock and time zone
    # environment:
    #   Optional. KidView uses the address you open the dashboard with for the setup QR codes.
    #   To list addresses yourself (e.g. a Tailscale one, for away from home), uncomment and edit:
    #   KIDVIEW_ADDRESSES: "192.168.1.20:8765=Home Wi-Fi, 100.101.102.103:8765=Tailscale"
EOF
fi

echo "Building and starting KidView (the first time takes a few minutes)..."
docker compose up -d --build

echo
echo "KidView is running. From a phone or PC on your Wi-Fi, open:  http://<this computer's address>:8765/admin"
sleep 8
code=$(docker compose logs kidview 2>/dev/null | grep "SETUP CODE" | tail -1 | sed 's/.*SETUP CODE: *//' || true)
if [ -n "$code" ]; then
    echo "First time? Create your parent account there with this one-time setup code: $code"
fi
