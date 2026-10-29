# Testing

Run:

```powershell
npm test
npm run build
```

The backend tests use Node's built-in runner and MongoMemoryServer. External Daraja and RouterOS requests are mocked; tests do not issue payments or connect to a real router. Coverage includes:

- Admin bootstrap, protected admin management, account limits, password reset and package management.
- Encrypted access credentials and hashed payment tokens.
- Mocked Daraja OAuth, STK Push, status query, callback validation, delayed/duplicate callback behavior, and payment outcome handling.
- Customer checkout/status, delayed activation, router-failure retry, logout, repurchase, and expiry recovery after a database reconnect.
- Mocked RouterOS user creation/update, speed and time limits, activation, disconnect, expiry, and error sanitization.
- Package and phone validation, plus RouterOS uptime and expiry calculations.

The verified local commands are `npm test` and `npm run build` from the repository root. Passing mocks do not verify live credentials, provider sandbox behavior, RouterOS permissions/configuration, a physical hotspot client, or captive-portal behavior. Before production, use authorized Daraja sandbox credentials and a controlled test voucher on a non-customer router; never use a real customer charge.
