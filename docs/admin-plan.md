# Admin Module Plan (backend only)

Status: **Phase 1 done. Phases 2–4 implemented; waiting for migrations (…007, …008) + tests + lint + browser checks. Images use local storage (`STORAGE_DRIVER=local`); Spaces later = env change only.** CLAUDE.md overrides this file if they conflict.

Work runs in phases. After each phase Claude stops for review. The owner runs every
install, migration, build and test command.

---

## 1. Scope

**In scope**
- One admin user (env-based). No admin users table, no roles.
- Products: create, list (incl. inactive), view, edit, activate/deactivate. No hard delete.
  Slug is set on create and never changes. Prices in cents.
- Product images on DigitalOcean Spaces: one main image + gallery.
- Orders: read-only, **paid only**. List + detail.
- Customers: read-only, derived from paid orders grouped by email.
- Dashboard: counts and revenue from data we already store.

**Out of scope:** inventory/stock, categories, tax, refunds, fulfillment status, order status
changes, Stripe API calls from admin routes, customer accounts, changes to checkout or webhook.

---

## 2. Audit findings (Phase 0, done)

| Area | Finding | Impact |
|---|---|---|
| `ProductsService` | Only public reads (`findAll`, `findBySlug`, `findActiveBySlugs`), all filter `active: true` | Add admin methods that include inactive products |
| `OrdersService` | `create`, `applyPaymentOutcome`, `findById`, `findActiveDiscount` | Add read-only admin queries |
| Module rule | CLAUDE.md 8.1: modules talk only through exported services, never another module's internal files (incl. entities) | Admin module must **not** inject `Product`/`Order` repositories; it calls `ProductsService` / `OrdersService` |
| `OrderItem` | Snapshot of slug, name, unit price; no FK to products | Safe: editing or deactivating a product never changes past orders |
| CORS (`main.ts`) | `origin: FRONTEND_URL`, `methods: ['GET','POST']`, `allowedHeaders: ['Content-Type']` | Must add admin origin, `PATCH`/`PUT`, `Authorization` header |
| Throttler | `ThrottlerModule.forRoot` registered once; guard applied per route | Login reuses it with `@Throttle()` (5/min) |
| Global `ValidationPipe` | whitelist + forbidNonWhitelisted + transform | All admin DTOs validated automatically |
| Shared validation | `common/validation/slug.ts`, `Trim`, `TrimOrUndefined` | Reused for create/update DTOs |
| Last migration | `1794441600005-AddCheckoutSessionToOrders` | New migrations start at `1794441600006` |
| Packages | No JWT, hashing, or S3 package installed; multer is already inside `@nestjs/platform-express` | See section 4 |

---

## 3. Architecture

```
src/
├── admin/                          # NEW 4th module: auth + admin HTTP routes only
│   ├── admin.module.ts             # imports JwtModule, ProductsModule, OrdersModule
│   ├── admin-auth.controller.ts    # POST /admin/login
│   ├── admin-auth.service.ts       # checks email + password hash, signs JWT
│   ├── admin.guard.ts              # verifies Bearer token
│   ├── admin-products.controller.ts
│   ├── admin-orders.controller.ts  # orders + customers
│   ├── admin-dashboard.controller.ts
│   ├── dto/                        # login, product create/update, list queries, responses
│   └── *.spec.ts
├── products/
│   ├── entities/product-image.entity.ts   # NEW
│   ├── image-storage.service.ts           # NEW: the only code that talks to Spaces
│   └── products.service.ts                # + admin methods, image methods
└── orders/
    └── orders.service.ts                  # + paid-order, customer, stats queries
```

**Why this split**
- Admin controllers stay thin. Business logic and repositories stay in the module that owns
  the table, which follows CLAUDE.md 8.1.
- `ProductImage` is owned by Products, because images belong to products.
- `ImageStorageService` is separate from product logic. `ProductsService` decides *what*
  happens; the storage service only does put/delete. It is mocked in tests.
- The S3 client is created once, as a `useFactory` provider in `ProductsModule` (like
  `STRIPE_CLIENT`).
- `AdminGuard` is applied at controller level (`@UseGuards(AdminGuard)`) on every admin
  controller except the login controller. It is never global.

---

## 4. Packages (owner installs, after approval)

```
npm install @nestjs/jwt bcrypt @aws-sdk/client-s3
npm install -D @types/bcrypt @types/multer
```

| Package | Why | Docs |
|---|---|---|
| `@nestjs/jwt` | Sign/verify admin token | https://docs.nestjs.com/security/authentication |
| `bcrypt` | Compare password with stored hash | https://www.npmjs.com/package/bcrypt |
| `@aws-sdk/client-s3` | Spaces is S3-compatible | https://docs.digitalocean.com/products/spaces/how-to/use-aws-sdks/ |
| `@types/multer` | Type for `Express.Multer.File` (multer itself ships with platform-express) | https://docs.nestjs.com/techniques/file-upload |

`@nestjs/passport` is not needed. A small guard with `JwtService.verifyAsync` is enough for
one admin.

---

## 5. Environment variables

Added to `.env.example`, `.env.development`, `.env.production` and `env.validation.ts`:

```
ADMIN_URL=              # admin app origin, for CORS
ADMIN_EMAIL=
ADMIN_PASSWORD_HASH=    # bcrypt hash, never the plain password
JWT_SECRET=             # at least 32 random characters
SPACES_ENDPOINT=        # https://<region>.digitaloceanspaces.com
SPACES_REGION=          # e.g. fra1
SPACES_BUCKET=
SPACES_KEY=
SPACES_SECRET=
SPACES_PUBLIC_URL=      # CDN base URL, e.g. https://<bucket>.<region>.cdn.digitaloceanspaces.com
```

- Generate the hash once (after bcrypt is installed):
  `node -e "require('bcrypt').hash(process.argv[1], 12).then(console.log)" "your-password"`
- `JWT_SECRET` is validated with a minimum length of 32.
- `ConfigModule` does not expand variables by default, so the `$` characters in a bcrypt hash are safe.

---

## 6. Database changes (hand-written migrations; owner runs `npm run migration:run`)

**`1794441600006-AddProductContent`**
- `products.description text NULL`
- `products.badge varchar(50) NULL`

**`1794441600007-CreateProductImages`**
```
product_images
  id           serial         PK_product_images
  product_id   integer        FK_product_images_product_id → products(id) ON DELETE CASCADE
  storage_key  varchar(300)   NOT NULL, UQ_product_images_storage_key   -- no url column (section 9.3)
  is_main      boolean        NOT NULL DEFAULT false
  position     integer        NOT NULL DEFAULT 0, CHK_product_images_position (>= 0)
  created_at   timestamptz    NOT NULL DEFAULT now()
IDX_product_images_product_id         (product_id)
UQ_product_images_one_main            UNIQUE (product_id) WHERE is_main   -- partial index
```

**`1794441600008-AddOrderAdminIndexes`**
- `IDX_orders_status_created_at (status, created_at DESC)`: paid-order lists and dashboard
- `IDX_orders_status_lower_email (status, lower(email))`: customer search and grouping

---

## 7. Phases

### Phase 1: Admin auth: **done**
- Backend: `POST /admin/login` (5/min), `GET /admin/me`, `AdminGuard`, JWT (HS256, 8h),
  env validation (`ADMIN_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET`), CORS for
  both frontends.
- Jest config: `@nestjs/config` and `@nestjs/jwt` 12 are ESM-only, so `ts-jest` converts them
  to CommonJS during tests (`transformIgnorePatterns` in `package.json`). Not needed on Node 24.9+.
- Admin app (`d:\react\callixe-admin`): login page, `sessionStorage` token, protected routes,
  logout, auto-logout on 401, placeholder dashboard.
- Verified in the browser. Waiting on the full `npm run test` result.

### Phase 2: Products (create, list, view, edit)

#### 2.1 Migration `1794441600006-AddProductContent`
- `products.description text NULL`
- `products.badge varchar(50) NULL`
- Existing products get `NULL`. The storefront keeps its `dummyData.js` text until these
  are filled in.
- `Product` entity gains `description` and `badge` (`@Column({ nullable: true })`).

#### 2.2 Endpoints (`src/admin/admin-products.controller.ts`, `@UseGuards(AdminGuard)` on the controller)
| Method | Path | Result |
|---|---|---|
| GET | `/admin/products?search=&active=&sort=&page=&limit=` | `{ items, page, limit, total }` |
| GET | `/admin/products/:slug` | one product, including inactive; 404 if missing |
| POST | `/admin/products` | `201` + the product; `409` if the slug exists |
| PATCH | `/admin/products/:slug` | the updated product; the slug can't change |

- **No DELETE.** `active: false` hides the product from the store and keeps past orders intact.
- **Search:** `name` or `slug`, case-insensitive (`ILIKE`). `%`, `_` and `\` are escaped, so
  typed characters never act as wildcards.
- **`active` filter:** `true`, `false`, or omitted for all.
- **Sort:** `name`, `price`, `createdAt`; `-` prefix for descending; default `-createdAt`.
  Values come from a whitelist mapped to column names; user input never reaches SQL.
- **Pagination:** `common/dto/pagination-query.dto.ts`. `page` ≥ 1 (default 1); `limit`
  1–100 (default 20). Reused in Phase 4.

#### 2.3 Validation (`products/dto/`)
| Field | `CreateProductDto` | `UpdateProductDto` |
|---|---|---|
| `slug` | required, shared `SLUG_PATTERN`, ≤ 100 | not allowed (400 via `forbidNonWhitelisted`) |
| `name` | required, trimmed, 1–200 | optional |
| `price` | required, integer cents, 0–10,000,000 | optional |
| `compareAtPrice` | optional, integer cents or `null` | optional; `null` clears it |
| `description` | optional, trimmed, ≤ 2000, blank → `null` | optional; `null` clears it |
| `badge` | optional, trimmed, ≤ 50, blank → `null` | optional; `null` clears it |
| `active` | optional boolean, default `true` | optional |

- **`compareAtPrice > price`:** checked in the service after merging the update with the
  saved product, so an edit that changes only one price is still checked → `400`.
- Written by hand: `@nestjs/mapped-types` (`PartialType`) is not installed, and the two
  DTOs differ anyway (slug).

#### 2.4 Service (`ProductsService`, repository stays in the Products module)
- `findAllForAdmin(query)`: QueryBuilder with search, active filter, sort and
  `skip`/`take`, plus `getManyAndCount()`.
- `findOneForAdmin(slug)`: no `active` filter; `NotFoundException` if missing.
- `create(dto)`: insert; a PG `23505` on `UQ_products_slug` → `ConflictException`.
- `update(slug, dto)`: load (404), merge, check the price rule, save.
- The existing public methods (`findAll`, `findBySlug`, `findActiveBySlugs`) are unchanged.
  Orders keep pricing from active products only.

#### 2.5 Responses
- `AdminProductResponseDto`: slug, name, price, compareAtPrice, description, badge, active,
  createdAt, updatedAt. Never `id`.
- Public `ProductResponseDto` adds `description` and `badge`. Still no `id`, `active` or
  timestamps. Additive, so the storefront isn't affected.

#### 2.6 Backend tests
- `products.service.spec.ts`: search escaping, active filter, sort mapping, pagination math,
  404, 409 on duplicate slug, price rule on create and on partial update.
- `create-product.dto.spec.ts` / `update-product.dto.spec.ts`: required fields, limits,
  `null` clearing, blank → `null`, slug rejected on update, unknown fields rejected.
- `pagination-query.dto.spec.ts`: defaults, bounds, string → number conversion.
- `admin-products.controller.spec.ts`: `AdminGuard` on the controller, calls the service,
  maps responses.
- `product-response.dto` tests: public shape still hides internal fields.

#### 2.7 Admin app (`d:\react\callixe-admin`)
- `src/services/productService.js`: `listProducts(params)`, `getProduct(slug)`,
  `createProduct(data)`, `updateProduct(slug, data)`.
- `src/utils/money.js`: `toCents('363.00') → 36300`, `formatMoney(36300) → '363.00'`. No
  floats: the string is split on `.`, not multiplied by 100.
- `src/utils/slugify.js`: "Neck Pillow 2.0" → `neck-pillow-2-0`, matching the backend pattern.
- **Products page** (`/products`): table (name, slug, price, compare-at, active), search
  (debounced), Active/Inactive/All filter, sort, pagination, a "New product" button, and
  click a row to edit.
- **Product form** (`/products/new`, `/products/:slug/edit`):
  - One component for both modes.
  - Prices entered as money and sent as cents.
  - Slug is suggested from the name and editable on create only.
  - Active checkbox, description textarea, badge input.
  - Backend messages shown on the form (409 → "This slug is already used").
  - Save → back to the list.
- Sidebar gets a "Products" link.

#### 2.8 Owner steps
```
cd D:\Backend\callixe_backend
npm run migration:run
npm run test
npm run start:dev
```
Admin app (`npm run dev`):
1. Create a product.
2. Edit its price and description.
3. Try to create a duplicate slug and confirm you get 409.
4. Deactivate the product and confirm it disappears from `http://localhost:3000/products`.

### Phase 3: Product images (reliability first)

#### 3.0 Prerequisites (owner, before any code runs)
- DigitalOcean Spaces bucket with CDN enabled and a bucket-limited key (section 10 steps).
- Six new env variables in all three env files (section 5): `SPACES_ENDPOINT`,
  `SPACES_REGION`, `SPACES_BUCKET`, `SPACES_KEY`, `SPACES_SECRET`, `SPACES_PUBLIC_URL`.
  `validateEnv` requires them, so the backend won't start without them once Phase 3 is merged.
- Package already installed: `@aws-sdk/client-s3` (3.1168.0). Nothing else to install.

#### 3.1 Migration `1794441600007-CreateProductImages`
```
product_images
  id           serial         PK_product_images
  product_id   integer        NOT NULL, FK_product_images_product_id → products(id) ON DELETE CASCADE
  storage_key  varchar(300)   NOT NULL, UQ_product_images_storage_key
  content_type varchar(20)    NOT NULL, CHK_product_images_content_type
                              (image/jpeg | image/png | image/webp)
  is_main      boolean        NOT NULL DEFAULT false
  position     integer        NOT NULL DEFAULT 0, CHK_product_images_position (>= 0)
  created_at   timestamptz    NOT NULL DEFAULT now()
IDX_product_images_product_id_position  (product_id, position)
UQ_product_images_one_main              UNIQUE (product_id) WHERE is_main   -- partial index
```
- No `url` column: the URL is built from `SPACES_PUBLIC_URL` (section 9.3).
- Entity: `products/entities/product-image.entity.ts` (Products owns it). `Product` gets
  `@OneToMany(() => ProductImage, …) images`.

#### 3.2 Endpoints (`src/admin/admin-product-images.controller.ts`, `@UseGuards(AdminGuard)`)
| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/admin/products/:slug/images` | multipart: `file`, optional `isMain` | `201` + the image |
| PATCH | `/admin/products/:slug/images/:imageId` | `{ isMain?: true, position?: int }` | the image |
| PUT | `/admin/products/:slug/images/:imageId/file` | multipart: `file` | the image (same id, new file) |
| DELETE | `/admin/products/:slug/images/:imageId` | – | `204` |

- Image response: `{ id, url, isMain, position }`. Never the storage key.
- `:imageId` uses `ParseIntPipe`. An image ID that belongs to a different product → `404`.
- `isMain: false` is not accepted: there is always exactly one main image while a product has
  images, and you change it by making another image main.

#### 3.3 Upload validation (three layers)
1. **Size while reading:** `FileInterceptor('file', { limits: { fileSize: 5 MB, files: 1 } })`.
   Multer stops reading at 5 MB, so a huge upload is never fully held in memory → `413`.
2. **Real file type:** `ParseFilePipe` with `MaxFileSizeValidator` and a small custom
   `ImageSignatureValidator` that checks the first bytes: JPEG `FF D8 FF`, PNG
   `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`.
   - *Why custom:* Nest 11's `FileTypeValidator` also checks magic bytes, but it loads the
     ESM-only `file-type` package through a dynamic import that fails under Jest on Node 22.
     Three signatures are about 15 lines, need no package, and are easy to unit-test.
   - The browser's `mimetype` and the file name are **never trusted**. The detected type sets
     the content type and the extension.
3. **Count:** at most 10 images per product → `400`.

SVG and GIF are rejected (SVG can contain scripts; GIF isn't needed).

#### 3.4 Storage (`products/image-storage.service.ts`, the only code that talks to Spaces)
- An `S3Client` is provided once as `SPACES_CLIENT` (`useFactory` + `ConfigService`) in
  `ProductsModule`, like `STRIPE_CLIENT`.
- `put(key, buffer, contentType)`: `PutObjectCommand` with `ACL: 'public-read'`, `ContentType`,
  `CacheControl: 'public, max-age=31536000, immutable'`. Safe to cache forever because a key
  is never reused: a replace always writes a new key.
- `delete(key)`: `DeleteObjectCommand`.
- `publicUrl(key)`: `${SPACES_PUBLIC_URL}/${key}`.
- **Key:** `<NODE_ENV>/products/<slug>/<uuid>.<ext>` (`crypto.randomUUID()`). The environment
  prefix keeps dev and prod files apart even in one bucket.
- Upload goes through the backend (admin app → API → Spaces). The browser never talks to
  Spaces, so the bucket needs no CORS rules and the keys never leave the server.

#### 3.5 Image logic (`products/product-images.service.ts`, exported from `ProductsModule`)
Every DB step runs in `DataSource.transaction()` and first locks the product row
(`SELECT … FOR UPDATE`). Two uploads for the same product then run one after the other, so
the 10-image limit and the "one main image" rule can't be broken by a race.

- **Upload:**
  1. Validate (3.3), build the key.
  2. `put` to Spaces.
  3. Transaction: lock the product, check the count, insert the row at `position = max + 1`.
     The first image of a product is always main. With `isMain`: clear the old main, then
     set the new one (the partial unique index requires that order).
  4. If step 3 fails → delete the just-uploaded object, then rethrow. No orphaned file.
- **Replace file:**
  1. `put` the new key.
  2. Transaction: update `storage_key` and `content_type` on the same row (id, main and
     position are kept).
  3. If step 2 fails → delete the new object.
  4. **Only after commit** → delete the old object. A failure here is logged with the key and
     never fails the request. The old file is never deleted before the new one is saved.
- **Set main / position:** transaction only, no storage calls.
- **Delete:**
  1. Transaction: delete the row. If it was main, the image with the lowest position
     becomes main.
  2. After commit → delete the object. A failure is only logged: the result is an orphaned
     file, never a broken image link.
- Products are never hard-deleted (Phase 2), so there is no product-delete cleanup.

#### 3.6 Responses
- Admin `GET /admin/products/:slug` gains `images: [{ id, url, isMain, position }]`, sorted by
  position. The list endpoint gains `mainImageUrl` (for a thumbnail column).
- Public `GET /products` and `GET /products/:slug` gain `images: [{ url, isMain }]` sorted by
  position. Additive change. Loaded in the same query (relation), no extra request per
  product.

#### 3.7 Backend tests (Spaces client, repositories and `DataSource` mocked)
- `image-signature.validator.spec.ts`: real JPEG/PNG/WebP headers pass; GIF, SVG text, PDF,
  an empty buffer, and a PNG renamed to `.jpg` with a wrong mimetype are handled by bytes.
- `image-storage.service.spec.ts`: correct bucket, key, ACL, content type, cache header; URL
  building.
- `product-images.service.spec.ts`:
  - first image becomes main;
  - the 11th upload is rejected **and its object deleted**;
  - a DB failure deletes the new object;
  - replace deletes the old object only after commit;
  - a failing old-object delete is logged, not thrown;
  - deleting the main image promotes the next one;
  - an image from another product → 404.
- `admin-product-images.controller.spec.ts`: guard present, pipes wired, `204` on delete.
- Public `ProductResponseDto`: images included, no storage key, no image IDs.

#### 3.8 Admin app (`d:\react\callixe-admin`)
- **Images section on the product edit page** (not on create: a product needs a slug first):
  - Thumbnail grid. The main image is marked.
  - Buttons per image: **Set as main**, **◀ ▶** (move), **Replace**, **Delete** (with confirm).
  - An **Upload** button (`accept="image/jpeg,image/png,image/webp"`). Multiple files are sent
    one at a time, each with its own progress or error.
  - Client-side check for type and 5 MB before sending, for quick feedback. The server still
    validates.
- `src/services/productImageService.js`: `FormData` uploads with a 60 s timeout, overriding
  the default 10 s just for uploads. Axios sets the multipart header itself.
- Products list: a thumbnail column using `mainImageUrl`.

#### 3.9 Storefront (`d:\react\e-commerce-store`)
- `productService.js`: `image` = the API main image URL when there is one, else the
  `dummyData.js` image. `alt` = the product name when the image comes from the API.
- Option A (decided): a product is shown only if it has an image, either from the API or
  from `dummyData.js`. So a product created in the admin appears in the store as soon as it
  has a main image, even without a `dummyData` entry (layout fields then use defaults:
  not featured, no promo).
- The product page shows the main image only (no gallery, to match the current design).

#### 3.10 Owner steps
```
cd D:\Backend\callixe_backend
npm run migration:run
npm run test
npm run start:dev
```
Admin app:
1. Upload a jpg. It becomes main and shows in the list.
2. Upload a png, set it as main, move it.
3. Replace a file; the old URL stops working (deleted from Spaces).
4. Upload a 6 MB file → error; upload a `.txt` renamed to `.jpg` → error.
5. Delete the main image; the next one becomes main.
6. Check the storefront shows the API image.

### Phase 4: Orders, customers, dashboard (read-only, `status = 'paid'` only)

**Scope rule:** the admin sees **paid orders only**. Pending and failed orders never appear in
lists, counts or revenue, and their detail page returns 404. Nothing in Phase 4 writes to
orders: payment status still changes only through the Stripe webhook.

#### 4.0 Prerequisites and facts from the code
- No new packages.
- `orders.email` is stored as typed (not lowercased), so customers are grouped by
  `lower(email)`.
- There is no `paid_at` column. Order dates use `created_at`, the time checkout started,
  which is usually seconds before payment. Adding `paid_at` would need a webhook change,
  which is out of scope.
- All orders use one `CURRENCY`, so sums across orders are valid. Every money value
  returned stays integer cents.

#### 4.1 Privacy fix first: request logging
`requestLogger` logs `originalUrl`, including the query string. With `?email=` filters,
customer emails would end up in the logs, which CLAUDE.md 8.3 forbids. Change the logger to
log the **path only** (`req.originalUrl` up to the `?`). Add a unit test that a query string
is never logged.

#### 4.2 Migration `1794441600008-AddOrderAdminIndexes`
- `IDX_orders_status_created_at` on `(status, created_at DESC)`: paid-order lists, the
  dashboard, date filters.
- `IDX_orders_status_lower_email` on `(status, lower(email))`: customer grouping, email filter.
- Index only: no table changes, safe on existing data. Declared on the `Order` entity with the
  same names (`@Index`).

#### 4.3 Where the code goes
- **`orders/order-reports.service.ts` (new, exported from `OrdersModule`):** read-only
  queries for the admin, plus the types Admin imports. It's kept apart from
  `OrdersService`, which handles checkout and the webhook (money-critical write paths), so
  reporting changes can't touch checkout code.
- **`ProductsService.countByActive()`:** product counts for the dashboard.
- **Admin controllers:** `admin-orders.controller.ts` (`/admin/orders`),
  `admin-customers.controller.ts` (`/admin/customers`), `admin-dashboard.controller.ts`
  (`/admin/dashboard`). All behind `AdminGuard`, thin, calling only exported services.
- `AdminModule` imports `OrdersModule`. There is no circular import: Orders doesn't import Admin.

#### 4.4 Endpoints
| Method | Path | Query / params | Returns |
|---|---|---|---|
| GET | `/admin/orders` | `email`, `orderNumber`, `from`, `to`, `sort`, `page`, `limit` | `{ items, page, limit, total }`; item: `id, orderNumber, createdAt, customerName, email, country, itemCount, total, currency` |
| GET | `/admin/orders/:id` | `ParseUUIDPipe` | full order (4.5); 404 if missing or not paid |
| GET | `/admin/customers` | `search`, `sort`, `page`, `limit` | `{ items, … }`; item: `email, name, country, orderCount, totalSpent, firstOrderAt, lastOrderAt` |
| GET | `/admin/customers/detail` | `email` (required), `page`, `limit` | `{ customer: {…same as list item, phone, latestAddress}, orders: { items, page, limit, total } }`; 404 if no paid orders |
| GET | `/admin/dashboard` | – | 4.6 |

**Query rules**
- `email` (orders): exact match, case-insensitive (`lower(email) = lower(:email)`).
- `orderNumber`: integer ≥ 1001.
- `from` / `to`: `YYYY-MM-DD` dates. `to` includes its whole day (`< to + 1 day`). Dates are
  taken as **UTC**, and the admin app sends them that way. `from > to` → 400.
- `search` (customers): email or name contains the text, case-insensitive, with `%`, `_` and
  `\` escaped (same helper idea as products).
- **Sort (whitelist, `-` for descending):**
  - orders: `createdAt` (default `-createdAt`), `total`, `orderNumber`;
  - customers: `lastOrderAt` (default `-lastOrderAt`), `totalSpent`, `orderCount`.
  - A stable tiebreaker (`id` / email) keeps page boundaries correct.
- **Pagination:** reuses `PaginationQueryDto` (page ≥ 1, limit 1–100, default 20).
- The customer email goes in a **query parameter**, not the URL path, because it contains `@`.
  The logger fix (4.1) keeps it out of logs.

#### 4.5 Order detail response
```
{ id, orderNumber, status: 'paid', createdAt, updatedAt,
  customer: { email, firstName, lastName, phone },
  delivery: { address, apartment, city, postalCode, country },
  items: [{ slug, name, unitPrice, quantity, lineTotal }],
  subtotal, discountCode, discountAmount, shipping, total, currency,
  stripe: { checkoutSessionId, paymentIntentId } }
```
- Items are the snapshot saved at order time (CLAUDE.md 7.1), so later price changes don't
  alter them.
- Stripe IDs appear **only on the detail page** (for looking the payment up in Stripe), never
  in lists. No Stripe API call is made.

#### 4.6 Dashboard response
```
{ products:  { total, active, inactive },
  orders:    { paid, paidLast30Days },
  customers: { total },
  revenue:   { total, last30Days, averageOrderValue },   // cents
  recentOrders: [5 × order list item],
  topProducts:  [5 × { slug, name, quantitySold, revenue }] }   // from paid order items
```
- One query per block. Each is a single SQL aggregate, no loops over orders in JavaScript.
- "Last 30 days" = `created_at >= now() - interval '30 days'`.
- `averageOrderValue` = `round(total revenue / paid orders)`, or 0 with no orders. Integer cents.

#### 4.7 Implementation rules
- **Aggregation in SQL only** (`COUNT`, `SUM`, `GROUP BY`, `DISTINCT ON`). Customers use one
  query:
  - a CTE groups paid orders by `lower(email)`;
  - `DISTINCT ON (lower(email)) … ORDER BY created_at DESC` picks the latest name, country,
    phone and address;
  - a separate `COUNT(DISTINCT lower(email))` gives the total.
- **Parameters only:** every user value is a bound parameter (`$1`, `:email`). Sort columns
  come from a map; user text never reaches SQL.
- **Number conversion:** `pg` returns `COUNT`/`SUM` (bigint) as strings. One helper,
  `toSafeInteger`, converts them and throws if a value isn't a safe integer, so a wrong total
  can never be shown silently.
- Read-only: no transactions or locks needed.

#### 4.8 Backend tests (repositories / query runner mocked)
- `request-logger.middleware.spec.ts`: logs method, path and status; never the query string.
- `order-reports.service.spec.ts`:
  - only `status = 'paid'` is ever queried;
  - filters become parameters;
  - the `to` date includes its whole day;
  - sort mapping and tiebreakers;
  - pagination math;
  - bigint strings → integers, and a non-safe integer throws;
  - a non-paid or missing order → 404;
  - a customer with no paid orders → 404;
  - dashboard maths (average with zero orders = 0).
- DTO specs: email, dates (`from > to` → 400, invalid date), `orderNumber`, sort whitelist,
  unknown params rejected.
- Controller specs: `AdminGuard` on each controller, services called with the right
  arguments.
- `products.service.spec.ts`: `countByActive`.

#### 4.9 Admin app (`d:\react\callixe-admin`)
- **Dashboard** (`/`):
  - number cards: revenue total / 30 days, paid orders, customers, average order value,
    active products;
  - tables for recent orders and top products.
- **Orders** (`/orders`):
  - table: order number, date, customer, email, country, items, total;
  - filters: email, order number, date range;
  - sort and pagination; click a row to open the detail.
- **Order detail** (`/orders/:id`): customer and delivery address, items table, totals
  breakdown (subtotal, discount and code, shipping, total), and the Stripe payment ID with a
  link to the Stripe Dashboard (test-mode link in development).
- **Customers** (`/customers`):
  - table: name, email, country, orders, total spent, last order;
  - search, sort, pagination.
- **Customer detail** (`/customers/detail?email=…`): summary card plus that customer's
  paid orders.
- Sidebar: Dashboard, Products, **Orders**, **Customers**.
- `utils/format.js`: `formatPrice(cents, currency)` with `Intl.NumberFormat` (integer
  maths, as `money.js`) and `formatDate` with `Intl.DateTimeFormat` in the admin's local
  time.
- **Filters live in the URL** (`useSearchParams`), so Back from an order detail returns to
  the same filtered page.

#### 4.10 Owner steps
```
cd D:\Backend\callixe_backend
npm run migration:run
npm run test
npm run lint
npm run start:dev
```
To have data: place 2–3 test orders on the storefront and pay with `4242 4242 4242 4242`
(Stripe CLI or ngrok forwarding, CLAUDE.md 13–14), using the same email twice in
different letter case. Then check:
1. Dashboard numbers match the orders.
2. The orders list shows only paid orders; filters and sort work.
3. The order detail shows items, totals and the Stripe ID.
4. Customers shows one row for the two orders with the same email.
5. An unpaid or abandoned checkout appears nowhere.
6. The backend log shows `/admin/orders` without `?email=…`.

### Final step: CLAUDE.md updates
- Section 1: remove "admin panel" and "login/auth" from out of scope; note "admin only, single user".
- Section 3: add the `admin/` module and the new Products files.
- Section 4: add the admin endpoints table.
- Section 7:
  - Product gains `description` and `badge`.
  - Add the `ProductImage` model.
  - Replace "Frontend owns all display content" with the new split: the backend owns images,
    description and badge; the frontend keeps the rest.
- Section 9: the new env variables.

---

## 8. Each phase ends with
- A list of changed files.
- Commands for the owner, e.g. `npm run migration:run`, `npm run test -- admin`.
- Open questions or anything uncertain.

## 9. URLs: one host per app, no path conflicts

Most "URL conflicts" come from four things: apps sharing a host so paths collide, base URLs
hardcoded in code, full image URLs saved in the database, and CORS origins that don't match
exactly. The rules below remove all four.

### 9.1 Three apps, three origins

| App | Local | Production | Owns paths |
|---|---|---|---|
| Backend API (NestJS) | `http://localhost:3000` | `https://api.<domain>` | `/products`, `/orders`, `/discounts`, `/payments/webhook`, `/admin/*` |
| Storefront (React) | `http://localhost:5173` | `https://<domain>` | its own page routes |
| Admin app (React) | `http://localhost:5174` | `https://admin.<domain>` | its own page routes (`/login`, `/products`, `/orders`…) |
| Images (Spaces CDN) | same CDN in dev | `https://<bucket>.<region>.cdn.digitaloceanspaces.com` | files only |

- **Each app runs on its own origin, so paths can't collide.** For example, the admin
  app's page `/products` and the API's `/admin/products` and `/products` live on different
  hosts.
- **No global prefix (such as `/api`) on the backend.** Adding one would change every
  endpoint the storefront uses and the Stripe webhook URL (CLAUDE.md sections 4 and 14).
  Separate hosts already prevent collisions.
- **Admin API routes all live under `/admin/`.** Public routes never start with `/admin`,
  so a public route can't be shadowed by an admin route or the reverse.
- **Fixed dev ports:** set `server: { port: 5174, strictPort: true }` in the admin app's
  `vite.config.js`. Without `strictPort`, Vite silently moves to another port when 5174 is
  busy, and CORS then fails.

### 9.2 One API base URL per frontend
- Each frontend reads the API base from one env variable, e.g.
  `VITE_API_URL=http://localhost:3000` (dev) and `VITE_API_URL=https://api.<domain>` (prod).
- All requests go through one file per app (`src/api/client.js`) that does
  `fetch(`${import.meta.env.VITE_API_URL}${path}`)`. The admin client also adds the
  `Authorization` header there. No URL is hardcoded anywhere else.
- No Vite dev proxy. Dev then behaves exactly like prod (real CORS), so problems show up
  locally, not after deploy.

### 9.3 Image URLs are built, never stored
- The DB stores `storage_key` only (e.g. `development/products/neck-pillow-2-0/<uuid>.webp`).
- The backend adds the full `url` when responding: `SPACES_PUBLIC_URL + '/' + storage_key`.
- If the CDN host changes (custom domain, new bucket), only one env variable changes. No
  database update, and no broken images.
- The frontends use `image.url` exactly as received. They never build image URLs themselves.

### 9.4 CORS that matches exactly
- The browser's `Origin` has no trailing slash. `FRONTEND_URL` and `ADMIN_URL` are
  validated in `env.validation.ts` to have **no trailing slash and no path**, so
  `http://localhost:5173/` can't silently break CORS.
- `origin: [FRONTEND_URL, ADMIN_URL]`. Never `*`, because the admin sends an
  `Authorization` header.
- Images load from the CDN with plain `<img src>`, which needs no CORS.

### 9.5 Admin app page refreshes
- On a hosted single-page app, refreshing `https://admin.<domain>/products/neck-pillow`
  returns 404 unless the host serves `index.html` for unknown paths. On DigitalOcean App
  Platform (static site), set **Catchall document = `index.html`**. The same applies to
  the storefront.

### 9.6 Request flow for adding an image
```
Admin app (admin.<domain>)
  └─ POST https://api.<domain>/admin/products/<slug>/images   (multipart, Bearer token)
       Backend: AdminGuard → FileInterceptor (5 MB) → ParseFilePipe (type)
         → ProductsService.addImage()
             → ImageStorageService.put()  → Spaces bucket
             → DB transaction (product_images row)
         ← { id, url, isMain, position }
Storefront (<domain>)
  └─ GET https://api.<domain>/products → images[].url
       └─ <img src="https://<bucket>.<region>.cdn.digitaloceanspaces.com/...">
```

---

## 10. Decisions and open questions
1. **Hashing package:** `bcrypt` (decided).
2. **Spaces bucket:** not set up yet. Needed only for Phase 3; create it before then
   (steps below).
3. **Storefront follow-up:** products without an image stay hidden (option A, decided). API
   images replace `dummyData.js` images in Phase 3 (3.9). The Phase 2 storefront merge fix
   (null description/badge fall back to `dummyData.js`) is applied; the `whitespace-pre-line`
   / `line-clamp` display tweaks are not.

### Setting up DigitalOcean Spaces (before Phase 3)
Docs: https://docs.digitalocean.com/products/spaces/how-to/create/ ,
https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/ ,
https://docs.digitalocean.com/products/spaces/how-to/manage-access/

1. Control panel → **Spaces Object Storage** → **Create Bucket**. Pick the region closest
   to customers (same as the app if possible), and a bucket name. Leave file listing
   **restricted**: images are made public one by one on upload.
2. Bucket → **Settings** → **CDN** → enable. The CDN endpoint is `SPACES_PUBLIC_URL`.
3. **Spaces Keys** → create a key limited to this bucket (read/write). Access key →
   `SPACES_KEY`, secret → `SPACES_SECRET`. The secret is shown only once.
4. Region → `SPACES_REGION`; `https://<region>.digitaloceanspaces.com` → `SPACES_ENDPOINT`.
5. Use a separate bucket (or at least a separate key) for development and production.
