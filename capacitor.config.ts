import type { CapacitorConfig } from '@capacitor/cli'

// MYRA iOS shell (Capacitor).
// The app loads the live, server-rendered MYRA site inside a native wrapper.
// IMPORTANT: appId is the permanent App Store identity — do not change after the
// first submission. Switching to native (Swift/React Native) later reuses this id.
const config: CapacitorConfig = {
  appId: 'uk.co.myraassistant.app',
  appName: 'MYRA',
  webDir: 'cap-shell',
  server: {
    // The app opens straight into the private-stylist member area. Not-signed-in
    // users are sent through the member sign-in flow by the server.
    url: 'https://www.myraassistant.co.uk/me',
    // Allow the in-app browser to navigate the live site over HTTPS.
    allowNavigation: ['www.myraassistant.co.uk', 'myraassistant.co.uk'],
  },
  ios: {
    contentInset: 'always',
  },
}

export default config
