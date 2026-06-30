// The referral code LandingTracker persists in localStorage (first-seen wins).
// Read it on any client-tracked action so behaviour (occasion/item/search) is
// attributed to the source that brought the visitor in.
export const REF_KEY = 'myra_ref'

export function getStoredRef(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(REF_KEY)
  } catch {
    return null
  }
}
