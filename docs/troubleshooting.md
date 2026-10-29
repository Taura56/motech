# Troubleshooting

| Symptom | Checks |
|---|---|
| Backend exits during startup | Check missing/invalid env values, MongoDB URI/connectivity, encryption key format and HTTPS production requirements. |
| No packages displayed | Start MongoDB, run `npm run packages:seed`, check package enabled flags. |
| STK push cannot start | Verify Daraja environment, credentials, shortcode, passkey, transaction type and sandbox test number; inspect redacted backend logs. |
| Payment stays pending | Verify callback is public HTTPS, matches the configured URL exactly, then check provider query reachability and backend logs. Do not manually mark paid. |
| Review-required payment | Compare order snapshot and callback/provider references through an authorized Daraja channel; admin reconcile only uses successful STK Query plus matching persisted evidence. |
| Payment success but no Wi-Fi | Check `MIKROTIK_ENABLED`, REST HTTPS certificate, source address, credentials/permissions, configured profile and admin/router health. Successful payment is retained and router activation is retried. |
| Customer can't open portal from captive assistant | Open the portal in a normal browser, verify DNS and narrowly allowlisted HTTPS hostnames, test Android captive assistant behavior and router login page. |
| Access not expiring | Check backend reconciliation is running and router is reachable. Review the exact voucher user/session in RouterOS. Keep existing shared profiles unchanged. |
| Admin cannot sign in | Use the correct email, check login rate limit, database session collection and cookie origin/SameSite configuration. Re-run admin creation only for a new approved admin account. |

Never paste passwords, PINs, Consumer Secrets or passkeys into logs, tickets or chat.
