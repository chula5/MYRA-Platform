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
