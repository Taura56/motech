# Payment and access flow

## State machines

Payment: `CREATED` → `PENDING` → `SUCCESS`, `FAILED`, `CANCELLED`, `EXPIRED`, or `REVIEW_REQUIRED`. Only provider-confirmed `SUCCESS` is eligible for access provisioning. A late callback on an expired order is returned to the verification path; it is never trusted by itself.

Access session: `PENDING` → `ACTIVE` → `EXPIRED`, or `FAILED` while router provisioning needs retry. A separate account per order is created disabled; it is enabled at its scheduled start and disconnected/removed at expiry.

## Processing

1. API finds the enabled package and derives amount/duration from MongoDB, not the browser.
2. It creates a pending payment and sends Daraja STK Push with the configured shortcode, validated Kenyan MSISDN, package amount, order reference and callback URL.
3. Browser receives the opaque status token and polls `/api/payments/status` with `X-Payment-Token`.
4. Callback parser accepts the documented STK callback envelope. Duplicate callbacks cannot overwrite the first callback.
5. Worker compares checkout and merchant request references, amount, phone and receipt metadata with the original order; it also makes STK Query for that checkout request.
6. A matching provider `ResultCode=0` transitions the payment atomically to `SUCCESS`. A conflicting/ambiguous callback enters review; failed callback result codes are only accepted when STK Query agrees.
7. Activation claim and unique `AccessSession.paymentId` protect retries. Retry reads explicitly include the encrypted credential field, which is excluded from normal database reads. The access schedule begins at the later of now or the most recent unexpired session expiry for the phone.
8. The access record is encrypted at rest and the MikroTik user is created disabled. It is enabled at start; access is disconnected and removed at expiry.
9. The customer status endpoint reports payment/access status, transaction reference, start/expiry times and remaining time. It returns credentials only while access is active. The token-protected logout endpoint disconnects currently active sessions; it does not erase the purchased duration.

## Uncertain cases

- STK Query unavailable: preserve pending state and retry; do not activate.
- Amount/phone/receipt mismatch: mark review-required; no access.
- Router down or integration disabled: retain provider success, record failure and retry after setup/recovery; never initiate another charge.
- Backend restart: the reconciliation worker scans persisted successful payments and due/expired sessions at startup and on its scheduled interval.
- Callback received after pending timeout: re-query provider and validate against the original request before any state transition.
- Admin reconciliation cannot force success. It requires successful provider query plus callback fields matching the stored request.

Package stacking currently schedules duration after the latest active/pending expiry. Customers receive separate voucher credentials for each purchase; they should use the credential for the currently active package.
