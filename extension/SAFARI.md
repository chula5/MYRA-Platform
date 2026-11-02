# MYRA Mirror on iPhone Safari

MYRA Mirror uses the same `extension/` source for Chrome and Safari.

## Developer setup

1. Run `npx cap sync ios`.
2. Open `ios/App/App.xcworkspace` in Xcode.
3. Select the `App` scheme and choose an iPhone running iOS 16.4 or later.
4. Select the Apple Developer team for both `App` and `MYRA Mirror Extension`.
5. Build and run the app.
6. On the iPhone, open **Settings → Safari → Extensions → MYRA Mirror Extension**.
7. Enable the extension and set **All Websites** to **Allow**.
8. Open Safari, open the MYRA Mirror extension sheet, and choose **Connect to MYRA**.

For a beta release, archive the `App` target and distribute it through
TestFlight. Alison will install the containing MYRA app from TestFlight, enable
the Safari extension once, and then use it from Safari.

After the TestFlight build exists, set `NEXT_PUBLIC_MIRROR_IOS_URL` in Vercel
to its public invitation link. The private client welcome screen will then show
the iPhone install button alongside the Chrome link.

The extension target is linked to the repository's `extension/` directory, so
Chrome and Safari do not have separate copies of the JavaScript to keep in
sync.

# MYRA Mirror on Mac Safari

`safari-mac/MYRA Mirror/` is a macOS container app made with
`xcrun safari-web-extension-converter`. Its extension files point at this same
`extension/` folder, so Chrome, iPhone Safari and Mac Safari share one copy.

Build and install:

```bash
cd "safari-mac/MYRA Mirror"
xcodebuild -project "MYRA Mirror.xcodeproj" -scheme "MYRA Mirror" -configuration Release -derivedDataPath build DEVELOPMENT_TEAM=2LSB76B969 -allowProvisioningUpdates build
ditto "build/Build/Products/Release/MYRA Mirror.app" "/Applications/MYRA Mirror.app"
open "/Applications/MYRA Mirror.app"
```

Then in Safari: **Settings → Extensions → tick MYRA Mirror Extension**, set it to
allow on every website, and press the toolbar button → **Connect to MYRA**.
Rebuild after changing `extension/` (Safari does not re-read the folder live).

## Mac TestFlight

The Mac app uses the iPhone app's bundle IDs (`uk.co.myraassistant.app` and
`uk.co.myraassistant.app.mirror`), so it is the macOS side of the same App Store
Connect app and the same TestFlight testers. In App Store Connect add the macOS
platform to the app once, then:

```bash
cd "safari-mac/MYRA Mirror"
xcodebuild -project "MYRA Mirror.xcodeproj" -scheme "MYRA Mirror" -configuration Release -archivePath build/MYRA-Mirror.xcarchive DEVELOPMENT_TEAM=2LSB76B969 -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath build/MYRA-Mirror.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath build/export -allowProvisioningUpdates
```

Bump `CURRENT_PROJECT_VERSION` before every new upload.
