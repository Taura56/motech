# Security notes

- Keep all `.env` files on the server and outside version control. Daraja credentials, passkey, session secret, payment token secret, encryption key and router credentials are server-only.
- Production requires HTTPS, secure cookie mode, explicit `ALLOWED_ORIGINS`, a trusted proxy configuration, and a public HTTPS callback.
- Admin passwords are bcrypt-hashed; the first account is bootstrapped through a hidden-input CLI prompt that refuses to run once any administrator exists. Further accounts can only be created by an authenticated administrator through the protected dashboard API. At most two accounts can be active, at least one must remain active, and account mutations are serialized through a MongoDB-backed lease lock. Password resets increment a credential version so previous sessions are rejected. Login is rate limited. Sessions are HTTP-only, same-site and persisted in MongoDB.
- Public APIs validate shape/size, use a backend package lookup and rate limit. Admin writes use origin allowlisting and a required custom request header as defense-in-depth.
- Router REST uses HTTPS Basic Authentication. Leave TLS verification on; use a trusted certificate or private CA. Limit the router service to the backend management source address. Never expose RouterOS API/REST on WAN.
- Access passwords are encrypted at rest with AES-256-GCM. Status-token values are hashed at rest. Rotate the payment encryption key only with a migration that re-encrypts existing credentials.
- Logs redact common credential fields and do not log request bodies. Payment status tokens are sent in a header rather than URL.
- CSV values are quoted and formula-prefixed to reduce spreadsheet injection. Sensitive customer/payment reports are administrator-only.

## Daraja callback limitation

This implementation does not claim that Safaricom signs the callback payload. It uses the callback only to locate a pending checkout, then queries provider status and checks callback fields against the immutable original request. A successful STK Query is required. Confirm current Daraja product documentation and any stronger transaction-verification mechanism available to the approved account before production.

## Router permissions and deployment

RouterOS REST writes can modify hotspot users. Use a dedicated account, least privilege supported by the installed RouterOS version, a management VLAN/VPN and source-address filtering. Validate the role's actual permissions with a read-only health test and a controlled test voucher before deployment. This app never changes router services, firewall rules, WAN, bridge, DHCP, wireless, DNS, or SSID automatically.
