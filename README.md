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

## Vercel deployment

The application is Vercel-native:

- Next.js provides the interface and server routes.
- Turso/libSQL stores users, sessions, accounting records, templates, orders, and audit history.
- Private Vercel Blob storage holds contracts and order documents.
- Stablecount-owned email/password sessions replace hosting-specific identity headers.
- The first registered account becomes Super Admin. Invited users activate their seat by setting a password on their first login.

Create a Turso database and a private Vercel Blob store, then configure the variables shown in `.env.example` in every Vercel environment. Import this GitHub repository in Vercel with the Next.js framework preset and deploy from `main`.

For local development, the app automatically uses `stablecount.db`. Vercel production deliberately requires `TURSO_DATABASE_URL` so records are never written to temporary server storage.
