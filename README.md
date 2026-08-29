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

## Data and file storage

The current application is built for Cloudflare-compatible infrastructure:

- D1 stores accounting, users, audit history, templates, orders, and other structured records.
- R2 stores uploaded documents.
- Database migrations are stored in `drizzle/`.
- Logical bindings are declared in `.openai/hosting.json`.

## Vercel compatibility

The repository can be imported into Vercel, but the full application will not run there unchanged. Its server routes currently import Cloudflare Worker bindings and rely on D1, R2, and Sites/ChatGPT authentication headers.

A production Vercel migration requires:

1. Replacing D1 access with Vercel Postgres, Neon, Supabase, or another SQL service.
2. Replacing R2 access with Vercel Blob, S3, or compatible object storage.
3. Replacing Sites authentication headers with a Vercel-compatible authentication provider.
4. Adapting the Vinext/Cloudflare build and runtime configuration for Vercel.
5. Configuring environment variables and applying the database migrations.

Until that migration is completed, the live supported deployment remains the Stablecount Sites deployment.
