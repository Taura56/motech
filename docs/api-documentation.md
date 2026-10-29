# API contract

All JSON errors use `{ "error": { "code": "...", "message": "..." }, "requestId": "..." }`. Public calls are rate-limited. Admin calls require a Mongo-backed session cookie; mutating admin calls also require `X-Requested-With: MOTECH-ZONE-ADMIN`. Cross-origin access is restricted by `ALLOWED_ORIGINS`.

## Customer

- `GET /api/health` — public application and database status; router details are not public.
- `GET /api/packages` — enabled package fields only, including configured `downloadMbps` and `uploadMbps`.
- `POST /api/payments/initiate` — `{ "phone": "0712345678", "packageId": "<ObjectId>", "idempotencyKey": "<UUID>" }`; backend calculates price and suppresses duplicate requests for the same phone/key. Returns `paymentToken`, order ID, package snapshot, status and provider message.
- `GET /api/payments/status` — `X-Payment-Token` header; returns payment/activation state, package and transaction reference, access state, start/expiry times, remaining seconds, and credentials only when access is active.
- `GET /api/access/status` — same token; access-focused status.
- `POST /api/access/logout` — same token; disconnects the customer's currently active hotspot sessions without erasing paid access time.
- `POST /api/payments/daraja/callback` — public provider callback; never grant access from callback alone.

## Administrator

- `POST /api/admin/auth/login` — email/password; secure session cookie.
- `GET /api/admin/auth/me`; `POST /api/admin/auth/logout`.
- `GET /api/admin/dashboard`.
- `GET /api/admin/packages`; `POST /api/admin/packages`; `PATCH /api/admin/packages/:id`; `DELETE /api/admin/packages/:id` (soft-disable).
- `GET /api/admin/payments?page=&limit=&status=&q=`; `GET /api/admin/payments/:id`; `POST /api/admin/payments/:id/reconcile`.
- `GET /api/admin/customers?q=`.
- `GET /api/admin/sessions?phone=&status=`; `POST /api/admin/sessions/:id/disconnect`.
- `GET /api/admin/router/health`, `GET /api/admin/mikrotik/status`; `GET /api/admin/audit-logs`; `GET /api/admin/reports/payments.csv`.

The payment token is a bearer secret; keep it out of URLs, logs, analytics and screenshots. Status and logout calls have token-keyed rate limits; payment initiation is limited per normalized phone. Admin APIs do not expose credentials, arbitrary router operations or a "mark paid" action.
