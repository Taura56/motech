# Safaricom Daraja

## Sandbox

Use the Consumer Key/Secret, shortcode and passkey for the MOTECH Daraja sandbox application. Configure them only in backend `.env` using `MPESA_ENVIRONMENT=sandbox`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, and `MPESA_PASSKEY`. Do not use a browser `VITE_` variable for provider secrets.

Set `MPESA_CALLBACK_URL` to a publicly reachable HTTPS endpoint ending in `/api/payments/daraja/callback` before accepting payments. It may be blank while preparing local configuration, but checkout will be rejected until it is set. A localhost URL is not reachable by Safaricom. Ensure the backend is publicly accessible over HTTPS and the frontend origin is permitted by `ALLOWED_ORIGINS`.

The implementation requests an OAuth client-credentials access token and calls the standard M-Pesa Express STK Push and STK Push Query resources on the selected sandbox/production base host. It calculates the password as Base64 of shortcode + passkey + timestamp (`yyyyMMddHHmmss`), and sends the amount/MSISDN from the stored order. Verify the current exact transaction type and callback contract in the official Daraja portal for the approved product before launch.

Test only with the sandbox test number and credentials. Confirm OAuth, STK request acceptance, callback delivery, query result and matching callback metadata. Do not claim a sandbox payment was successful until the backend has verified it and the payment row is `SUCCESS`.

## Callback and verification

The callback body is expected in the documented STK Push envelope `Body.stkCallback`, with merchant/checkout identifiers, result code/description and success metadata items such as amount, M-Pesa receipt and phone. Parser rejects malformed values. Unknown checkout references and duplicate callbacks do not activate service.

Callbacks are not assumed to be signed. A success callback triggers an STK Query request for the known checkout reference. The server requires query success, matching checkout/merchant references, original order amount/phone and a receipt value before success. If fields disagree, status becomes review-required. A provider outage leaves payment pending for retry.

## Production gate

Safaricom must approve the business, production product, credentials and collection shortcode. Confirm the exact approved PayBill/Till and settlement destination. A KCB bank deposit Paybill is not automatically eligible for STK Push or associated with this Daraja app; do not redirect to another shortcode. Confirm callback HTTPS reachability, certificates, DNS and firewall before switching.

Set `NODE_ENV=production`, `MPESA_ENVIRONMENT=production`, production credentials, approved shortcode, HTTPS URLs, trusted `ALLOWED_ORIGINS`, secure cookies and a managed secrets store only after approval. Missing production values fail startup. Never use sandbox passkey or fabricated credentials in production.

Official references to consult at implementation/deployment time:

- Safaricom Daraja developer portal and the documentation shown for the specific approved app/product: <https://developer.safaricom.co.ke/>
- Confirm STK Push, STK Push Query, OAuth and callback schema in that portal; the portal documentation is application/product-specific and may change.
