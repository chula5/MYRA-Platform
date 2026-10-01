# Share to MYRA on iPhone

Holding on a piece in Safari (or sharing a brand's Instagram) and choosing
**MYRA** in the share sheet hands the link to MYRA. A piece goes to her saved
items; an Instagram brand is followed back to its website and added to brand
watch. The sheet answers in one sentence — kept, or why not.

## How it fits together

- `Share Extension/` — the share sheet itself (`MYRA Share` target). It reads
  the shared link, POSTs it to `/api/mirror/share`, and shows the answer.
- `App Extension/SafariWebExtensionHandler.swift` — when she connects MYRA in
  Safari, the token is written to the shared container, so the share sheet
  never asks her to sign in. Disconnecting clears it.
- All three targets (App, MYRA Mirror Extension, MYRA Share) share the app
  group `group.uk.co.myraassistant.app`, declared in each target's
  `.entitlements` file.

## One-time Apple setup

1. Open `ios/App/App.xcworkspace` in Xcode.
2. For each of the three targets, open **Signing & Capabilities** and confirm
   **App Groups** lists `group.uk.co.myraassistant.app`. With automatic
   signing Xcode registers the group in the developer portal for you; if it
   cannot, create the group once under
   [Certificates, Identifiers & Profiles → Identifiers → App Groups](https://developer.apple.com/account/resources/identifiers/list/applicationGroup)
   using the exact name above.
3. Build and run. The share sheet appears in Safari's share menu (and other
   apps') under **MYRA** — she may need to tap **Edit Actions…** once to pin
   it near the top.

For TestFlight, archive the `App` scheme as usual; both extensions are
embedded automatically. Nothing else changes in the release process.
