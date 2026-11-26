# Server and deployment

Where Callixe runs in production and how to update it. **No secrets in this file**: passwords, keys and `whsec_` values are placeholders. The real values live only in the server's env file and the Stripe / Brevo / Hostinger dashboards.

## Overview

| Part | Where | URL |
|---|---|---|
| Backend API (NestJS) | DigitalOcean Droplet | https://api.callixe.co |
| Database (PostgreSQL 16) | Same Droplet, local | `127.0.0.1:5432`, database `store` |
| Product images | Same Droplet, local disk | https://api.callixe.co/uploads/... |
| Storefront (React build) | Hostinger Cloud Startup | https://callixe.co |
| Admin (React build) | Hostinger Cloud Startup | https://admin.callixe.co |
| Payments | Stripe (Elements with Checkout Sessions, card form on callixe.co) | Webhook: https://api.callixe.co/payments/webhook |
| Email | Brevo API | — |

## Droplet

- **Name:** `MindEngage` (DigitalOcean, NYC1), Ubuntu 24.04, 1 GB RAM + 2 GB swap, Node 24.
- **IP:** `165.22.189.166`
- **Shared with MindEngage.** MindEngage runs on port 3000 with its own nginx site `mind-engage`. **Never touch its files, port, database or PM2 apps.**
- Log in as `root`, then always switch to the Callixe user:

  ```
  su - callixe
  cd ~/callixe_backend
  ```

| Item | Value |
|---|---|
| Linux user | `callixe` |
| Code | `/home/callixe/callixe_backend` (git clone of this repo, branch `main`) |
| Env file | `/home/callixe/callixe_backend/.env.production` (not in git) |
| Port | `3001` (nginx proxies `api.callixe.co` → `127.0.0.1:3001`) |
| PM2 app | `callixe-api` (id `0`), run by user `callixe` |
| PM2 logs | `/home/callixe/.pm2/logs/callixe-api-out-0.log`, `callixe-api-error-0.log` |
| Images | `/home/callixe/callixe_backend/uploads` (git-ignored, permanent disk) |
| nginx site | `api.callixe.co` |
| Database | `store`, owner role `callixe`, `DB_HOST=127.0.0.1`, `DB_SSL=false` |

PM2 keeps one list per Linux user: `pm2 list` as `callixe` shows only Callixe.

**Never run** on the server:

- `git clean -x` (deletes `uploads/`, all product images).
- `do-release-upgrade` or a reboot without planning (MindEngage goes down too; an Ubuntu upgrade can break Node or PostgreSQL).

## Production env

`NODE_ENV=production` must be set outside the file (shell / PM2); it selects `.env.production`. Values below are the known ones; `<...>` are secrets or not recorded.

```
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://callixe.co
ADMIN_URL=https://admin.callixe.co
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USERNAME=callixe
DB_PASSWORD=<secret>
DB_NAME=store
DB_SSL=false
DB_CA_CERT=
STRIPE_SECRET_KEY=<sk_test_... for now; sk_live_... when going live>
STRIPE_WEBHOOK_SECRET=<whsec_... of the api.callixe.co destination>
CURRENCY=usd
TRUST_PROXY_HOPS=1
ADMIN_EMAIL=<admin email>
ADMIN_PASSWORD_HASH=<bcrypt hash>
JWT_SECRET=<32+ chars>
BREVO_API_KEY=<xkeysib-...>
EMAIL_FROM=<verified sender>
EMAIL_FROM_NAME=Callixe
EMAIL_REPLY_TO=
ORDER_NOTIFY_EMAIL=<optional>
STORAGE_DRIVER=local
STORAGE_PUBLIC_URL=https://api.callixe.co/uploads
```

After changing the env file: `pm2 restart callixe-api --update-env`.

## Update the backend

On the laptop first: tests pass, then `git add .`, `git commit`, `git push` (check no `.env.*` file is staged).

On the server, as `callixe` in `~/callixe_backend`:

```
git status                                   # expect: working tree clean
git pull
npm ci                                       # ONLY if package.json / package-lock.json changed
npm run build
NODE_ENV=production npm run migration:run:prod   # only does something if there are new migrations
pm2 restart callixe-api --update-env
pm2 logs callixe-api --lines 30              # expect: Nest application successfully started
curl -s https://api.callixe.co/products | head -c 300   # expect: [{"slug":...
```

- Always run the migration **before** the restart when a pull adds a migration. New code reading a column that doesn't exist yet gives `500 Internal server error` (`column ... does not exist` in the error log).
- Migrations here only add columns/constraints inside one transaction; a failure changes nothing.
- Optional backup before a migration: `pg_dump -h 127.0.0.1 -U callixe -d store -F c -f ~/store-backup.dump`.
- Undo the last migration: `NODE_ENV=production npx typeorm migration:revert -d dist/database/data-source.js`.
- The `WARN [Environment] ... STRIPE_SECRET_KEY is a test key` line is expected while the live site uses Stripe test mode.

Migrations run on production (latest first): `AddOrderPresentment1794441600012`, `AddOrderShipping1794441600011` (both on 2026-11-25), `CreateFeaturedCards1794441600010`, ...

## Update the storefront and admin (Hostinger)

Both read `VITE_API_URL=https://api.callixe.co` from their `.env.production`, and both ship a `.htaccess` (from `public/`) so refreshing a page like `/products/neck-pillow-2-0` doesn't 404.

1. Build on the laptop:
   - Storefront: `cd D:\react\e-commerce-store` → `npm run build`
   - Admin: `cd D:\react\callixe-admin` → `npm run build`
2. Open each `dist` folder, show hidden items, select **everything inside** (`Ctrl+A`, including `.htaccess`) and compress to a zip. The storefront zip is ~10–11 MB (videos and photos); a ~400 KB zip means files are missing.
3. Hostinger hPanel → File Manager:

| Site | Folder |
|---|---|
| https://callixe.co | `public_html` |
| https://admin.callixe.co | `public_html/admin` |

4. In the site's folder, delete the old build (`index.html`, `assets/`, `.htaccess`, `favicon.svg`, `icons.svg`, old media). **In `public_html` never delete the `admin` folder.**
5. Upload the zip and extract it. The File Manager requires a folder name, so extract to `tmp`, open `tmp`, select everything, **Move** it to `..`, then delete `tmp` and the zip.
6. Expected contents:
   - `public_html`: `admin/`, `assets/` (25 files), `.htaccess`, `favicon.svg`, `icons.svg`, `index.html`
   - `public_html/admin`: `assets/`, `.htaccess`, `index.html` (+ the admin's own public files)
7. Check with `Ctrl+Shift+R`: https://callixe.co, refresh on https://callixe.co/products/neck-pillow-2-0, log in at https://admin.callixe.co.

## Stripe

| | Local development | Production (api.callixe.co) |
|---|---|---|
| Mode | Test | **Test for now** (server has `sk_test_`), Live later |
| Webhook URL | `https://unkeyed-gracie-nimbly.ngrok-free.dev/payments/webhook` | `https://api.callixe.co/payments/webhook` |
| `whsec_` in | `.env.development` | `.env.production` on the server |

- Dashboard webhooks: test https://dashboard.stripe.com/test/workbench/webhooks, live https://dashboard.stripe.com/workbench/webhooks.
- Each destination has its own `whsec_`; the server's `STRIPE_WEBHOOK_SECRET` must be the one of the destination in the **same mode** as `STRIPE_SECRET_KEY`. Keep only one destination per mode pointing at `api.callixe.co`.
- Events (same for every destination): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`. Payload style: Snapshot. Events from: Your account.
- **Adaptive Pricing** (customers pay in their own currency, CLAUDE.md 6.3): Settings → Payments (https://dashboard.stripe.com/test/settings/payments, live: https://dashboard.stripe.com/settings/payments), on in each mode separately.
- Test order: email `test+location_PK@example.com`, card `4242 4242 4242 4242` → order `paid` in the admin with "Customer paid PKR ...".
- **Elements checkout (card form on callixe.co, one step):** checkout calls `POST /orders/payment-session` when it opens, then `POST /orders` (with `paymentSessionId`) on Complete Purchase; no more `checkoutUrl`. **Deploy the backend and the storefront together**: an old storefront build can't take payments with the new backend, and the reverse. The storefront needs its Stripe publishable key (`pk_test_` / `pk_live_`) in the **same mode** as the server's `STRIPE_SECRET_KEY`.

### Going live (later)

1. Live mode: turn on Adaptive Pricing, create the `api.callixe.co` webhook destination with the events above.
2. Server env: `STRIPE_SECRET_KEY=sk_live_...`, `STRIPE_WEBHOOK_SECRET=<live whsec_>`, then `pm2 restart callixe-api --update-env` (the test-key warning disappears).
3. Disable the test-mode destination for `api.callixe.co`.
4. One small real order, then refund it in Stripe.

## Troubleshooting

| Symptom | Check |
|---|---|
| Admin/API shows "Internal server error" | `pm2 logs callixe-api --err --lines 50`; `column ... does not exist` = run the migration |
| Webhook deliveries `400 Invalid Stripe signature` | Wrong `whsec_` on the server (other destination or other mode); fix env, restart |
| Webhook deliveries `502` / `504` | App or nginx down: `pm2 list`, `curl -I https://api.callixe.co/products` |
| Order stays `pending` after paying | Stripe destination → Event deliveries; server error log |
| Storefront page 404 on refresh | `.htaccess` missing in `public_html` |
| Blank site / old version | `index.html` not directly in the site folder, or cache: hPanel → Cache Manager → Purge all |
| Product shows "Page not found" / no price | Product inactive or missing: https://api.callixe.co/products/<slug> returns 404 |
| Prices hugely wrong (e.g. Rs.7,687,972) | Price was entered in rupees; admin prices are **USD** |
| Server slow | `pm2 list` host metrics, `free -h` (1 GB RAM shared with MindEngage) |
