# Deployment and operations

## Before launch

- Review and set every backend environment value; keep the two `.env` files out of source control.
- Run tests/build and dependency review, configure MongoDB private networking, automated encrypted backups and a tested restore.
- Configure TLS at a maintained reverse proxy, public callback, exact origins, secure cookies, rate limiting and trusted proxy hops.
- Confirm production Daraja approval/shortcode/destination and a public HTTPS callback before enabling collection.
- Back up and audit the MikroTik. Configure a restricted HTTPS REST management account reachable only from the backend management network.
- Keep `MIKROTIK_ENABLED=false` until a reviewed test user can be created/enabled/expired without affecting existing customers.
- Seed packages, review sample prices, create the initial admin through the CLI and review roles.
- Alert on pending/review payments, access provisioning failures, router outages, stale reconciliation, callback failures and database health.

## Process and persistence

Run the backend and frontend behind a production process manager/container with health checks and graceful shutdown. The current reconciliation scheduler is in-process; run a single worker instance. If horizontally scaling the web API, extract reconciliation into a durable single-leader queue before deployment. The process does not report integration as successful until health probes pass.

## Backups/recovery

Use MongoDB point-in-time or scheduled encrypted backups. Limit backup access and retention because records include phone numbers and payment references. Periodically restore to an isolated environment and verify package, payment, access and audit collections. Router outages do not authorize manual success marking or new customer charges; restore connectivity and let retries run.

## Secret rotation

Rotate Daraja credentials through the provider console and update backend secrets. Rotate router credentials in a controlled maintenance window and verify HTTPS access. Rotate admin password through an account-management procedure. `SESSION_SECRET` rotation invalidates active sessions; `PAYMENT_TOKEN_SECRET` is not used to derive stored status tokens, but changing it is safe for current token hashes. `PAYMENT_ENCRYPTION_KEY` rotation requires a migration that decrypts/re-encrypts every stored credential while both keys are protected. Never simply replace it.

## Rollback

Keep the previous application build and database backup. Roll back code without rolling back verified payment records or deleting historical records. If router provisioning is malfunctioning, set the integration disabled after an approved maintenance action; preserve successful payment/access jobs for later reconciliation. Do not disable shared hotspot profiles or make broad firewall changes.
