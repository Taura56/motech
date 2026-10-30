# Install the MOTECH ZONE captive portal redirect

This folder contains the RouterOS Hotspot login page template. It is **not installed on the router by a GitHub commit**; copy it to the router only after reviewing the steps below.

## What it does

When a device joins the MOTECH ZONE Wi-Fi and opens a page, RouterOS serves `hotspot_custom/login.html`. The page forwards the RouterOS-provided MAC, IP, login URL, original destination, CHAP ID and CHAP challenge to:

`https://motech-zone-portal-2026.onrender.com/`

The customer can select a package and pay using Daraja sandbox. Once the backend verifies payment and returns an ACTIVE access session, the portal attempts RouterOS CHAP login. It keeps the displayed username/password as a manual fallback.

## Before installing

1. Deploy the matching `feature/captive-portal-auto-login` branch to Render (frontend and backend).
2. Confirm the frontend domain above is reachable over HTTPS.
3. In MikroTik IP > Hotspot > Walled Garden, allow the portal hostname `motech-zone-portal-2026.onrender.com` (HTTPS/443) and the backend hostname `motech-j88l.onrender.com` (HTTPS/443). Also allow the DNS resolution needed for those hostnames. Keep the allow rules limited to these hostnames and required ports.
4. Keep backend `MPESA_ENVIRONMENT=sandbox` and `MIKROTIK_ENABLED=false` until the router API path has been tested and approved. The customer CHAP login page itself does not require enabling the backend RouterOS REST API.

## Install on RouterOS

1. Back up the current Hotspot files and export the current router configuration before changing anything.
2. Upload this file to the router's existing Hotspot HTML directory as `login.html`. The current directory in this installation was reported as `hotspot_custom`; confirm it with `/ip hotspot profile print detail` and the `html-directory` setting first.
3. Do not overwrite other Hotspot files such as `md5.js`, `alogin.html`, `status.html`, `logout.html` or `error.html`.
4. Keep the existing Hotspot server, profile, DNS name, login-by settings, firewall and redirect configuration unchanged.
5. Test using a phone that has forgotten the Wi-Fi network or has no active Hotspot session. Join MOTECH ZONE and open a normal HTTP page to trigger the captive portal. The portal should open automatically; if the phone's captive-network mini-browser blocks it, choose the manual portal link or open a normal browser and visit the router's login page.

## Important limitations and safety

- This is a redirect page; it does not create or change router users, enable RouterOS API access, or change payment mode.
- The automatic CHAP submission requires the router to provide valid `$(link-login-only)`, `$(chap-id)` and `$(chap-challenge)` values. If they are absent, use the manual login fallback.
- Some mobile captive-network assistants restrict external HTTPS redirects or cross-site navigation. Test Android and iOS devices separately.
- The backend must still be configured with valid Daraja sandbox credentials and a public HTTPS callback.
- Do not set `MIKROTIK_ENABLED=true` until the backend-to-router management connection is separately secured and tested. Never expose RouterOS management ports to the public internet.
