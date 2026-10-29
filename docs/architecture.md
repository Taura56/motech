# Architecture

## Runtime components

1. React customer portal requests enabled packages and submits a package ID plus phone number.
2. Express validates the phone, looks up the current package and stores an immutable package/price/duration snapshot before requesting STK Push.
3. The customer's unguessable payment token is returned once and stored only as a SHA-256 hash in MongoDB.
4. Daraja posts callbacks to the public HTTPS endpoint. The callback is persisted as metadata; the backend later queries the matching checkout reference with the Daraja STK Query API.
5. Only a provider query result confirming success and callback metadata matching the stored checkout order can transition a payment to `SUCCESS`.
6. A reconciliation worker provisions one unique, initially-disabled hotspot user per payment, records access and enables it only when its scheduled start is reached.
7. MongoDB records activation and expiry state. The worker enables scheduled future accounts and disconnects/removes expired router users.
8. Administrators use Mongo-backed HTTP-only sessions and an audited API. Their browser cannot access router credentials or router terminal commands.

## Data models

- `Package`: editable live offering; price is an integer KES amount and duration is seconds.
- `Payment`: order/provider identifiers, phone, immutable package snapshot, state, callback fields, receipt and activation state.
- `AccessSession`: one unique record per successful payment; credentials are encrypted at rest; router state, scheduled start and expiry are stored.
- `Admin`: password hash and role.
- `AuditLog`: privileged actions and payment verification/reconciliation events.
- MongoDB session collection: administrator sessions.

## Reliability boundaries

Payment and router operations are intentionally separate; no network call is performed inside a MongoDB transaction. `SUCCESS` is retained even when RouterOS provisioning fails. The worker retries successful-but-unprovisioned orders and performs expiry cleanup. Router operations are upserts/deletes designed to be retryable.

The scheduler is an in-process single-worker loop with a per-process overlap guard and MongoDB claim timestamps. Use a durable queue/worker lease and customer-level serialization before multi-instance operation. Router outages should be monitored; they do not reverse successful payments.

## Explicit non-goals

- Router configuration discovery or mutation during app startup.
- Public router API access, arbitrary router terminal execution, and automatic firewall edits.
- Claiming cryptographic authenticity for Daraja callback payloads.
- Treating a browser redirect or user-submitted receipt as payment confirmation.
