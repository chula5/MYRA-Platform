# Share to MYRA on iPhone

Holding on a piece in Safari (or sharing a brand's Instagram) and choosing
**MYRA** in the share sheet hands the link to MYRA. A piece goes to her saved
items; an Instagram brand is followed back to its website and added to brand
watch. The sheet answers in one sentence — kept, or why not.

## How it fits together

- `Share Extension/` — the share sheet itself (`MYRA Share` target). It reads
  the shared link, POSTs it to `/api/mirror/share`, and shows the answer.
- `App/MirrorBridgePlugin.swift` — the app hands its sign-in to the share
  sheet. Every time the app opens the member area, the site mints her Mirror
  token (`src/components/me/NativeShareBridge.tsx`) and the plugin writes it
  to the shared container. Signing out on the YOU page clears it. So the only
  setup she does is sign in to the app.
- `App Extension/SafariWebExtensionHandler.swift` — the other way in: when she
  connects MYRA in Safari, the extension writes the same token. Disconnecting
  clears it.
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
   apps') under **MYRA**. New share targets land at the end of the app row:
   scroll the row of app icons to the right, or tap **More** at its end, and
   use **Edit** to pin MYRA near the front.

## Trying it

1. Open the MYRA app and sign in (or just open it, if already signed in).
2. In Safari, open any piece on a brand's site, tap Share, choose MYRA.
3. The sheet answers "Kept …" and the piece is in her saved items.

"Not connected yet" means the app has not opened the member area since this
build was installed — open the app once, then share again.

For TestFlight, archive the `App` scheme as usual; both extensions are
embedded automatically. Nothing else changes in the release process.
