# Stablecount Acc-books

Stablecount Acc-books is an international bookkeeping and commercial-operations application for StableCount. It includes client and supplier master records, linked orders, bank accounts, automated journal entries, credit/debit reporting, generated invoices, invoice templates, document storage, role-based access, per-user settings, and an audit trail.

## Main capabilities

- Super Admin, Level 1, and Level 2 access controls
- Ten managed user seats with manipulation history
- Client and supplier profiles with banking and contact data
- Linked orders, financial status, commission, currencies, and documents
- Persistent document upload, view, download, and deletion
- Automated invoices and purchase bills linked to clients and orders
- Fully editable invoice templates for Super Admin and Level 1
- Automated bookkeeping, payments, receivables, and payables
- RUB reporting currency with broad international-currency support
- English, Russian, Arabic, German, Spanish, and Portuguese interfaces
- Per-user language, date format, default page, and compact-view preferences

## Local development

Requirements:

- Node.js 22.13 or newer
- npm

```bash
npm install
npm run dev
```

Build and test:

```bash
npm run build
node --test tests/*.test.mjs
```

Local dev uses `stablecount.db` and `.uploads/` in the project folder automatically. **No sample clients, orders, or invoices are seeded** — the workspace starts empty after setup.

To wipe an existing database and uploaded files:

```bash
npm run reset-workspace
```

Then restart the app and sign in (or create the Super Admin on first visit).

## Self-hosted personal server (recommended)

Run everything on your own machine or VPS. **All files and the database stay on disk** — no Vercel Blob or Turso required.

### What gets stored locally

| Path under `STABLECOUNT_DATA_DIR` | Contents |
|-------------------------------------|----------|
| `stablecount.db` | Users, orders, invoices, journal, audit log |
| `uploads/documents/` | Order documents and party contracts |
| `uploads/template-assets/` | Invoice template header/footer images |

Default production path: `./data/` (or set `STABLECOUNT_DATA_DIR=/var/lib/stablecount`).

### Quick start (Node)

```bash
cp .env.example .env
# Edit .env: APP_URL, STABLECOUNT_DATA_DIR, SMTP_*

bash scripts/self-host-setup.sh
STABLECOUNT_DATA_DIR=/var/lib/stablecount npm run start
```

Open `http://localhost:3000` (or your `APP_URL` behind HTTPS).

### Docker

```bash
cp .env.example .env
# Edit .env before starting

docker compose up -d --build
```

Data persists in the `stablecount-data` Docker volume at `/data` inside the container.

### systemd (bare metal)

After `npm run build` with `output: "standalone"`:

1. Copy the repo to `/opt/stablecount-acc-books`
2. Copy `.env` with production values
3. Install `deploy/stablecount-acc-books.service` into `/etc/systemd/system/`
4. `systemctl enable --now stablecount-acc-books`

Put **Caddy** or **nginx** in front for HTTPS. Set `APP_URL` to your public URL so password-reset links are correct.

### Required environment (self-host)

| Variable | Purpose |
|----------|---------|
| `STABLECOUNT_DATA_DIR` | Where database + uploads are saved |
| `APP_URL` | Public site URL (e.g. `https://books.example.com`) |
| `SMTP_HOST` + `MAIL_FROM` | Password reset emails from your mail server |
| `NODE_ENV=production` | Secure session cookies |

Optional: `RESEND_API_KEY` instead of SMTP. Optional: `DATABASE_URL` for remote Turso if you prefer hosted DB.

### Backup

Back up the entire data directory together:

```bash
tar -czf stablecount-backup-$(date +%F).tar.gz -C /var/lib/stablecount .
```

## Vercel deployment (optional)

For Vercel, set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `BLOB_READ_WRITE_TOKEN` in the Vercel dashboard. The same codebase supports both self-host and Vercel — cloud vars are ignored when running on your server without them.
