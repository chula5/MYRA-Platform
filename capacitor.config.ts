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
    // The app opens straight into The Edit (the website landing page is unchanged
    // for web visitors). Not-signed-in users get the early-access sign-in first.
    url: 'https://www.myraassistant.co.uk/edit',
    // Allow the in-app browser to navigate the live site over HTTPS.
    allowNavigation: ['www.myraassistant.co.uk', 'myraassistant.co.uk'],
  },
  ios: {
    contentInset: 'always',
  },
}

export default config
