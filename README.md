# MOTECH ZONE billing

Sandbox-first self-service M-Pesa Wi-Fi billing for the existing MOTECH ZONE MikroTik hotspot. This repository does not connect to or change a router during installation. A successful STK payment is checked against the configured STK Query API and the original order before access provisioning is attempted.

## Status and important limits

- The workspace started empty. This implementation is an initial deployable codebase; no Daraja account, MongoDB server, or MikroTik has been connected or tested here.
- Sample packages are examples only (KES 10/hour, KES 20/3 hours, KES 50/day, KES 250/week). Review prices and shortcode before accepting real payments.
- `MIKROTIK_ENABLED=false` by default. Payment success is retained, but access will not be activated until RouterOS HTTPS REST is configured and reachable.
- Production collections require Safaricom approval, production credentials, a confirmed shortcode/destination and a public HTTPS callback. Do not assume a KCB bank Paybill is eligible for the selected STK product.
- A Daraja callback is not treated as an authenticated signature. Successful activation requires a matching STK Query result plus callback/order consistency checks. Provider/query limitations and manual review are documented in [Daraja setup](docs/daraja-setup.md).
- The router adapter uses RouterOS REST over HTTPS (supported on RouterOS 7.9+ with `www-ssl` enabled). Verify RB951Ui-2HnD settings and API permissions manually before enabling it.

## Architecture

- `backend/`: Express API, MongoDB/Mongoose models, Daraja STK client, payment verification/reconciliation, administrator sessions, RouterOS REST client and expiry worker.
- `frontend/`: React/Vite captive-portal-friendly customer page and administrator console.
- Admin session cookies are HTTP-only, same-site and stored in MongoDB. Payment status is accessed via a high-entropy bearer token held only in the customer's browser.
- Access is represented by a separate unique RouterOS user per paid order. Renewal is scheduled after the latest unexpired access expiry. Expired users are disconnected and removed by reconciliation.
- The backend is intended to run as one active reconciliation worker. For horizontal scaling, replace the in-process scheduler with a durable queue/lease service before running multiple worker instances.

More detail: [architecture](docs/architecture.md), [payment flow](docs/payment-flow.md), [API contract](docs/api-documentation.md), [security](docs/security.md), [network setup](docs/network-setup.md), [RouterOS setup](docs/mikrotik-setup.md), [Daraja setup](docs/daraja-setup.md), [testing](docs/testing.md), [deployment](docs/deployment.md), [troubleshooting](docs/troubleshooting.md).

## Prerequisites

- Node.js LTS (Node 20 or newer recommended) and npm.
- MongoDB 6+ or a MongoDB Atlas database.
- Daraja sandbox app credentials for payment testing.
- RouterOS 7.9+ with HTTPS REST enabled for the optional router integration.
- For real callback tests: public HTTPS host, Safaricom Daraja approval/credentials, approved shortcode and an authorized MikroTik management route.

## Windows PowerShell setup

Run these commands from the project directory:

```powershell
npm install
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

Edit `backend\.env` locally. Generate independent secrets and a 32-byte encryption key without pasting them into chat:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Use the first output for `PAYMENT_ENCRYPTION_KEY`; generate a different random value of at least 32 characters for `SESSION_SECRET`. Do not commit `.env` files.

Start MongoDB locally, then create the first administrator in a private interactive terminal:

```powershell
npm run admin:create
```

The command is bootstrap-only and refuses to add an account if an administrator already exists. Enter the administrator's full name, email and a unique password of at least 14 characters; password input is hidden. After signing in, use **Admin Management** to create and manage the second administrator. At most two accounts can be active, and at least one must remain active. Passwords are bcrypt-hashed, and no public registration route exists. Seed optional example packages only if you explicitly want them; they are not required to create administrators.

Start both apps:

```powershell
npm run dev
```

Frontend on the development computer: `http://localhost:5173`; LAN test URL for a Wi-Fi client: `http://192.168.10.246:5173`; backend: `http://localhost:3000`. The frontend development server proxies `/api` to the backend on the same computer. To run individually:

```powershell
npm run dev --workspace backend
npm run dev --workspace frontend
```

Build/test:

```powershell
npm test
npm run build
```

## Local sandbox setup

1. Configure `MONGODB_URI`, `PUBLIC_BACKEND_URL`, `PUBLIC_FRONTEND_URL`, and `ALLOWED_ORIGINS`.
2. Set `MPESA_ENVIRONMENT=sandbox` and enter sandbox-only Consumer Key, Consumer Secret, shortcode, passkey, and a public HTTPS callback URL in `backend\.env`.
3. Keep `MIKROTIK_ENABLED=false` until read-only router checks and the manual review in [RouterOS setup](docs/mikrotik-setup.md) are complete.
4. Ensure the sandbox callback is publicly reachable over HTTPS. Localhost is not reachable by Safaricom.
5. Seed/review the example packages and sign into `/admin` to manage them.
6. Use a Safaricom-supported sandbox test number. Never use a real payment during automated tests.

## Production and captive portal deployment

Host the React app and API on a secure public domain, preferably same-site behind a reverse proxy. Set HTTPS URLs, exact allowed origins, secure session cookies and production Daraja environment/credentials only after approval. Keep the API, database and RouterOS management interface private; allow router management only from the billing backend's fixed management IP or VPN. Never expose RouterOS REST to the public internet.

The React app is externally hosted; it is not copied to the router. Add only the required DNS and HTTPS hostnames to MikroTik walled-garden after reviewing the network impact. The captive portal browser may not support every external redirect/cookie flow; test Android captive-network assistant behavior and provide a normal browser fallback. See [network setup](docs/network-setup.md).

No automatic router setup, reset, bridge/DHCP/NAT/firewall change, SSID change, or production payment destination change is included.

## Backups and secret rotation

Back up MongoDB using an encrypted, access-controlled process and test restoration before launch. The payment/session records include personal data and payment references. Rotate Daraja, router, session, and encryption secrets through a planned maintenance window; rotating `PAYMENT_ENCRYPTION_KEY` without decrypting/re-encrypting existing credentials makes stored access passwords unreadable. See [deployment](docs/deployment.md).
