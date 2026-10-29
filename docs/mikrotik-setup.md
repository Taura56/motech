# MikroTik RouterOS API integration

## Scope and safety

The read-only diagnostic uses `node-routeros` over the RouterOS API TCP service on port `8728`. It checks TCP reachability, API authentication, then reads `/system/identity/print`, `/system/resource/print`, and optionally `/system/routerboard/print`. It never changes router configuration or hotspot accounts.

The integration remains disabled by default (`MIKROTIK_ENABLED=false`). Port `8728` is unencrypted: use it only on a trusted local management network, never expose it to the public internet, and restrict the RouterOS API service to the backend host. Do not run the live diagnostic while the backend is running with `MIKROTIK_ENABLED=true`: the existing billing reconciliation path has separate REST-based hotspot provisioning operations. Those pre-existing operations have not been migrated or exercised by this read-only diagnostic.

For a future production deployment, use RouterOS API-SSL on port `8729` with a trusted certificate and certificate validation. This diagnostic intentionally does not switch ports or use TLS automatically; TLS support must be implemented and explicitly configured before changing from `8728`.

## Environment

Copy the placeholder values from `backend/.env.example` into the backend `.env` file. Keep `.env` out of source control and do not provide credentials in chat.

```dotenv
MIKROTIK_ENABLED=false
MIKROTIK_HOST=192.168.10.1
MIKROTIK_PORT=8728
MIKROTIK_REST_PORT=443
MIKROTIK_USERNAME=motech-api
MIKROTIK_PASSWORD=
MIKROTIK_CONNECT_TIMEOUT_MS=5000
MIKROTIK_DEFAULT_PROFILE=default
```

`MIKROTIK_PORT` is used by the read-only RouterOS API diagnostic. `MIKROTIK_REST_PORT` preserves the existing billing service's separate REST endpoint configuration; it is not used by the diagnostic. `MIKROTIK_DEFAULT_PROFILE` is a placeholder and must not be treated as the verified hotspot profile.

## Dedicated RouterOS API account

The dedicated `motech-api` account is expected to exist already. In WinBox, review its policies and allowed source address without changing the working router setup:

- Grant only `read` and `api` policies for the read-only diagnostic. Do not use the main administrator account or grant `write`, `policy`, or `sensitive` permissions.
- Restrict the account or API service to the backend computer address `192.168.10.246/32`, provided this is consistent with the router's existing management policy.
- Confirm the `api` service is enabled on port `8728` and is reachable only from the trusted local management network.
- Do not alter the hotspot, WAN, bridge, DHCP, DNS, NAT, wireless, firewall, or other router settings as part of this diagnostic.

The application does not create users, change policies, or install firewall rules. A permission-denied response means the account needs the relevant read permission; do not resolve it by granting full administrator access.

If configuring a new account later, use a reviewed dedicated group with only the required policies and set the account's allowed source address locally. Do not rerun account-creation commands for the existing `motech-api` user.

## Run the standalone read-only check

First stop any running backend process. Add the router host, `motech-api` credentials, and `MIKROTIK_ENABLED=true` to the backend `.env` only for this deliberate test, then run from the project root:

```powershell
npm run mikrotik:test --workspace backend
```

The script prints sanitized JSON and exits successfully only if TCP connectivity, API authentication, and the required identity/resource responses succeed. It reports routerboard query failures separately because that command is optional. Disable the integration again after testing unless a separately reviewed deployment explicitly needs it.

Expected output after a successful live test resembles:

```json
{
  "enabled": true,
  "tcpConnected": true,
  "authenticated": true,
  "connected": true,
  "identity": "router-name",
  "version": "7.20.8 (long-term)",
  "model": "RB951Ui-2HnD",
  "routerboardSupported": true,
  "lastSuccessfulCheckAt": "2026-10-29T12:00:00.000Z"
}
```

The values above are illustrative, not results from this router. A successful ping or TCP probe alone is not proof of API authentication.

## Protected status endpoint

After starting the backend, administrators can query either `GET /api/admin/mikrotik/status` or the compatibility route `GET /api/admin/router/health`. Both require the existing administrator session. Responses contain only sanitized connection status, identity/version/model when actually read, an optional last successful check timestamp, and safe error codes/messages. The public `GET /api/health` deliberately does not query or expose router status.

## Common failures

- `CONNECTION_REFUSED`: confirm the RouterOS API service is enabled on port `8728` and the address is correct.
- `CONNECTION_TIMEOUT`: check local routing, service restrictions, and the allowed backend source address.
- `AUTHENTICATION_FAILED`: verify the dedicated account name/password locally; never log or share the password.
- `PERMISSION_DENIED`: grant only the needed RouterOS `read`/`api` policy after reviewing the account.
- `COMMAND_UNSUPPORTED`: RouterOS did not accept the optional or required command; verify the installed RouterOS version and inspect the sanitized test result.
- `INVALID_CONFIGURATION`: set the host, username, password, and `MIKROTIK_ENABLED=true` in the backend environment for the deliberate test.

Raw library errors and credentials are not returned by the health endpoint or diagnostic.

## Remaining work before billing operations

The application already contains legacy REST-based hotspot provisioning/deprovisioning used by payment reconciliation; those operations are outside this read-only task and were not tested or changed here. Before enabling router-backed billing in production, separately review and migrate/test those operations against the intended RouterOS API/REST transport, verify the correct hotspot profile and limits, add audit/retry/idempotency checks, and validate on a non-customer test account. Do not treat this read-only connection check as approval to grant write access or enable customer provisioning.
