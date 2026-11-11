# Google sign-in: resolve `400 origin_mismatch`

This error comes from Google's OAuth configuration before FMRC receives a token.
Deploying JavaScript or clearing Laravel configuration cannot authorize a website
in Google Cloud. The owner of the existing Google Cloud project must save its
authorized origins.

## Production configuration

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients)
   using the account that owns FMRC's existing project.
2. Select the **Web application** with this client ID (a public identifier):

   `55704463190-43888rtrprqlb7drpkmq52h5bhpr5p9u.apps.googleusercontent.com`

3. In **Authorized JavaScript origins**, add these two entries, keeping existing
   valid entries:

   ```text
   https://ucn-fabmanlab.com
   https://www.ucn-fabmanlab.com
   ```

4. Save. Google's documentation says changes can take **5 minutes to a few hours**.
5. Reopen the Customer login page and retry Google sign-in on both addresses.
   Check the normal website and `/apps/customer/customer-auth/auth` if using the PWA.

Origins contain only the scheme and hostname, plus a non-default port when used.
Do not include `/customer-auth/auth`, `/api/auth/google`, query strings, or a
trailing slash. The current FMRC browser popup uses a JavaScript callback; adding
a redirect URI alone does not fix its authorized JavaScript origin.

Staging needs its own entry, `https://staging.ucn-fabmanlab.com`, only if Google
sign-in is used on that deployment. Local development likewise needs the exact
frontend origin and port. Paths within the same origin do not need separate entries.

## Verify the existing client

- `customer-auth/auth.js` contains the public client ID used by the browser.
- `backend/.env` has `GOOGLE_CLIENT_ID`; it should identify the same application.
- Do not create a replacement project or rotate credentials to fix an origin entry.
- Never paste `GOOGLE_CLIENT_SECRET` into HTML, JavaScript, screenshots, or chat.
- A school-managed Google account may have a separate administrator restriction;
  that is a different problem from `origin_mismatch`.

## If the project owner's account was forgotten

Open [the client list for project number 55704463190](https://console.cloud.google.com/auth/clients?project=55704463190).
Try the Google accounts used by the development team using the top-right account
menu. The full OAuth client ID above identifies the client to find; a repository
commit author does not prove Google Cloud ownership.

If each account reports no permission, ask the groupmate who created the Google
Cloud project to open the existing client and save the two origins. Do not send
passwords, OTPs, or client secrets. If the existing project cannot be recovered,
arrange an owned replacement Web client before changing FMRC's client ID; a code
edit alone cannot create or authorize it.

## Release and verification

Deploy `customer-auth/auth.js` and `customer-auth/auth.html` together. No migration
is required. The scoped code change adds visible popup/load errors and retry
handling; it does **not** replace the Google Cloud configuration above.

An end-to-end verification requires an actual successful Google authorization,
followed by FMRC's `/api/auth/google` response and the Customer account page.
Mocked browser/provider tests cannot prove that the production origins were saved.

Sources:

- [Google Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- [Manage OAuth clients: origins and propagation time](https://support.google.com/cloud/answer/15549257?hl=en)
- [Google OAuth popup error callbacks](https://developers.google.com/identity/oauth2/web/reference/js-reference#TokenClientConfig)
