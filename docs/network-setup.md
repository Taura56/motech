# Network and captive portal setup

Operator-reported environment (not independently read from the router): RB951Ui-2HnD, RouterOS 7.20.8 Long-term, router `192.168.10.1`, hotspot server `hotspot1`, reported interface spelling `bridgeLocal`, profile `hsprof1`, address `192.168.10.1`, pool `dhcp_pool0`, DNS name `login.motechzone.local`, HTML directory `hotspot`, login methods `cookie,http-chap`, RADIUS disabled, proxy running, and no existing walled-garden entries. The operator also mentioned `bridgelocal`; these interface spellings and their relationship must be checked on the router before any interface-related change.

## Local portal URL

The existing customer page is the `/` route in `frontend/src/App.jsx`. For LAN testing, run the frontend and backend on the backend computer and open `http://192.168.10.246:5173/` from a Wi-Fi client. Vite listens on `0.0.0.0` through the frontend dev script. The frontend uses same-origin `/api` requests; Vite proxies these to the backend at `127.0.0.1:3000`, so a customer's browser does not contact its own `localhost` and the backend port does not need to be opened to Wi-Fi clients.

The backend and database must be running. Restrict any Windows Defender Firewall inbound rule for TCP 5173 to the local Wi-Fi subnet; do not expose the development server to the public internet. The Vite development server is for local testing only. For ongoing/customer production use, deploy the existing frontend to a reachable HTTPS host and proxy `/api` to the backend, or set `VITE_API_BASE_URL` to the reachable API URL.

## RouterOS captive redirect

The React app is not a RouterOS login page and cannot be copied to the hotspot directory as a working standalone page: it requires the frontend runtime and `/api` backend. For a local test, keep the app on the LAN computer. For production, host this same app and its API on a reachable HTTPS domain.

An unauthenticated HTTP request is intercepted by HotSpot and served from its active HTML directory. The redirect design is to make a minimal, reversible edit to the existing `hotspot/login.html`: on normal captive arrival, send the browser to the portal URL; when the portal's “Return to Wi-Fi login” link adds `?motech-login=1`, leave the original RouterOS login form untouched and visible. The portal link is already set to `http://login.motechzone.local/login?motech-login=1`. This retains the existing `cookie,http-chap` login flow rather than bypassing authentication. HTTPS interception may show certificate errors and is not a reliable redirect mechanism.

The following snippet is a deployment instruction, not an installed router file. After backing up the current `login.html`, add it near the top of that existing file, before its login form. Keep the existing CHAP scripts, RouterOS variables, styles, and form unchanged:

```html
<script>
  if (window.location.search.indexOf('motech-login=1') === -1) {
    window.location.replace('http://192.168.10.246:5173/');
  }
</script>
```

For production, replace that URL with the actual deployed HTTPS portal URL. Do not copy this script into other hotspot pages. If the login file is customized already, merge it into the existing file rather than replacing that file with a generic template.

Before any router change, read the live settings and resolve the interface-name spelling/bridge relationship. The values below are read-only:

```routeros
/ip hotspot print detail
/ip hotspot profile print detail
/ip hotspot walled-garden print detail
/ip hotspot walled-garden ip print detail
/interface print detail where name~"bridge"
/interface bridge port print detail
/file print detail where name~"hotspot"
```

Confirm `hotspot1` is still using `hsprof1`, its active HTML directory is `hotspot`, the `login.html` being edited is in that directory, and `bridgeLocal`/`bridgelocal` mean what the operator intends. Save a backup copy of the current login file off-router before editing it. The customer portal's API calls are same-origin through Vite's `/api` proxy, so the local-test walled garden only needs the one portal server/port. The operator reported the IP walled garden is empty; if the read-only check confirms that, the single narrowly scoped local-test rule is:

```routeros
/ip hotspot walled-garden ip add server=hotspot1 dst-address=192.168.10.246 protocol=tcp dst-port=5173 action=accept comment="MOTECH portal local test"
```

This allows unauthenticated hotspot clients to reach only the app server/port; it does not authenticate them or grant general internet access. Do not run it until live settings are reviewed and the operator approves. Then back up the active login page, make only the snippet change above, and upload only that modified `login.html`. Do not change hotspot profile, login methods, server/interface, WAN, bridge, DHCP, NAT, DNS, wireless, firewall, or hotspot users.

Rollback: restore the saved original `login.html`. If the walled-garden rule was added, find its row with `/ip hotspot walled-garden ip print detail` and remove only that row by its displayed number. Do not remove other entries.

The machine's current `backend/.env` is absent, so the backend cannot be freshly started from this checkout until its local configuration is restored. The frontend currently serves the page, but the backend is not listening and `/api` requests through Vite currently return HTTP 500. A prior local health check succeeded and reported an empty package list; the package endpoint must be rechecked once the configured backend is running. No separate Wi-Fi device was tested. The Vite server is development-only; do not expose it on the public internet. The local portal is not proven reachable from a hotspot client until the separate-device test succeeds.

For production, host the existing portal on a publicly reachable HTTPS domain and allow only the required portal host in the hotspot walled garden. Do not use `.local` for public TLS; it is not a publicly trusted domain. Keep the RouterOS API private and never expose it to the public internet.

## Verification procedure

1. Restore the backend's private `.env` configuration and start the backend, then start the frontend. From a separate phone connected to `MOTECH ZONE`, load `http://192.168.10.246:5173/` directly while unauthenticated. Confirm the page and its same-origin API request load.
2. With the reviewed walled-garden rule and `login.html` redirect deployed, disconnect/reconnect the phone, then open an ordinary HTTP-only test page (for example `http://neverssl.com/`). Confirm it lands on the MOTECH portal.
3. Use “Return to Wi-Fi login” and confirm the original RouterOS form loads. If authorized, verify a known existing hotspot account still logs in normally; do not change its credentials or create a bypass.
4. Repeat with the phone's captive-network prompt. Device assistants vary; HTTPS sites may not redirect cleanly.
5. Roll back by restoring `login.html` and removing only the newly added walled-garden row if either test fails.

No separate-device or live captive-redirect test has been completed from this development computer. Keep the RouterOS API private; a successful TCP probe is not proof of API authentication.
