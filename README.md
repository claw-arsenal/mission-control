# OpenClaw Dashboard

A Next.js dashboard for managing OpenClaw agents, tasks, and automation. Connects to your Supabase project and OpenClaw runtime.

---

## Prerequisites

- Linux host with OpenClaw installed (runtime user: `clawdbot`)
- Supabase project with the credentials below
- GitHub deploy key access to the dashboard repo

---

## Quick Start

### 1. Create SSH key and clone the repo

```bash
# Generate deploy key
sudo -u clawdbot -H bash -lc '
mkdir -p ~/.ssh && chmod 700 ~/.ssh
if [ ! -f ~/.ssh/dashboard_maintainer ]; then
  ssh-keygen -t ed25519 -N "" -f ~/.ssh/dashboard_maintainer
fi
cat ~/.ssh/dashboard_maintainer.pub
'
```

Add the printed public key to GitHub: repo → **Settings → Deploy keys**.

```bash
# Clone
sudo -u clawdbot -H bash -lc '
mkdir -p ~/apps
GIT_SSH_COMMAND="ssh -i ~/.ssh/dashboard_maintainer -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  git clone --branch main git@github.com:carterassist/dashboard.git ~/apps/dashboard
'
```

### 2. Create the environment file

```bash
sudo install -d -m 755 /etc/clawd
sudo nano /etc/clawd/template.env
```

Paste and fill in:

```bash
# Repo
DASHBOARD_REPO_URL=git@github.com:carterassist/dashboard.git
DASHBOARD_BRANCH=main
DASHBOARD_APP_DIR=/home/clawdbot/apps/dashboard
DASHBOARD_RUNTIME_USER=clawdbot
DASHBOARD_PORT=3000
DASHBOARD_GIT_SSH_KEY=/home/clawdbot/.ssh/dashboard_maintainer

# Supabase (Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_DB_URL=your-connection-pooling-uri
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional: Telegram alerts when dashboard goes down
DASHBOARD_ALERT_CHANNEL=telegram
DASHBOARD_ALERT_TARGET=your-telegram-chat-id
```

**Where to find Supabase values:**
- `NEXT_PUBLIC_SUPABASE_URL` → Project Settings → API → Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → Project Settings → API → anon public key
- `SUPABASE_DB_URL` → Connect → Connection string → Session pooler URI
- `SUPABASE_SERVICE_ROLE_KEY` → Project Settings → API → service_role key

### 3. Install the dashboard command

```bash
sudo install -m 755 /home/clawdbot/apps/dashboard/scripts/dashboard.sh \
  /usr/local/bin/dashboard
```

### 4. Run install

```bash
sudo dashboard install --email your@email.com
```

Dashboard will be available at `http://your-server-ip:3000`.

---

## Commands

| Command | What it does |
|---|---|
| `sudo dashboard install [--email EMAIL]` | Full install (first time) |
| `sudo dashboard update` | Pull latest, rebuild, restart all services |
| `sudo dashboard bridge [--email EMAIL]` | Set up or repair the bridge runtime |
| `sudo dashboard status` | Show service and bridge status |
| `sudo dashboard uninstall [flags]` | Remove dashboard |

**Uninstall flags:**
- `--purge-app` — delete app directory
- `--purge-env` — delete `/etc/clawd/template.env`
- `--purge-db` — drop all database tables

---

## Database

First install sets up the database automatically. To reset:

```bash
cd /home/clawdbot/apps/dashboard
printf 'yes\n' | npm run db:reset && npm run db:setup
```

---

## Verify

```bash
sudo dashboard status

# Detailed logs
sudo journalctl -u clawd-dashboard.service -n 50 --no-pager
sudo -u clawdbot tail -n 40 ~/.openclaw/bridge-logger.err
```

---

## Troubleshooting

**Bridge shows idle agents:**
```bash
sudo dashboard bridge
sudo dashboard update
```
If logs are missing attribution:
```bash
cd /home/clawdbot/apps/dashboard && npm run logs:repair-attribution
```

**Dashboard not loading after update:**
```bash
sudo journalctl -u clawd-dashboard.service -n 50 --no-pager
sudo systemctl restart clawd-dashboard.service
```

**Push + deploy workflow:**
```bash
git commit -m "your change"
git push origin main
sudo dashboard update
```

---

## How It Works

| Component | Description |
|---|---|
| `clawd-dashboard.service` | Runs the Next.js app |
| `dashboard-pull.timer` | Auto-pulls and rebuilds every 15 minutes |
| `openclaw-task-orchestrator.service` | Picks up scheduled tickets, runs them via OpenClaw, sends notifications |
| `openclaw-dashboard-watchdog.timer` | Monitors the HTTP endpoint, Telegram alert on down/up |
| `openclaw-bridge-logger.service` | Streams OpenClaw runtime logs into Supabase in real-time |
