// GOOGLE REVIEW NOTE — one line beside every Connect Gmail / Connect Google
// Calendar button while MYRA's Google verification is pending (Google Cloud
// project myra-508821, published 2026-11-17, scopes under review). Google
// shows "Google hasn't verified this app" and the member has to tap Advanced
// → Go to MYRA; without warning, that page reads as a reason to stop. Delete
// this component (and its mounts) once Google's verification passes.
export const GOOGLE_REVIEW_NOTE =
  "Google will say it hasn't verified MYRA yet: our review with Google is in progress. Tap Advanced, then Go to MYRA, and carry on. The connection is read-only."

export default function GoogleReviewNote({ className = '' }: { className?: string }) {
  return <p className={`text-[clamp(16px,0.95vw,24px)] leading-snug text-[#6E6B65] ${className}`}>{GOOGLE_REVIEW_NOTE}</p>
}
