// Shared invite code that gates the public early-access sign-up link
// (/earlyaccess/join?key=…). Anyone with the link can create their own
// login, but random web crawlers without the key cannot. Override with
// EARLY_ACCESS_INVITE_CODE in the environment to rotate it.
export const EARLY_ACCESS_INVITE_CODE =
  process.env.EARLY_ACCESS_INVITE_CODE || 'myra-preview-9k3xq2'
