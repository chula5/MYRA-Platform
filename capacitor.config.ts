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
    url: 'https://www.myraassistant.co.uk',
    // Allow the in-app browser to navigate the live site over HTTPS.
    allowNavigation: ['www.myraassistant.co.uk', 'myraassistant.co.uk'],
  },
  ios: {
    contentInset: 'always',
  },
}

export default config
