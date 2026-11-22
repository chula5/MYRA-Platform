// HER VIEW's IPHONE APP frame (admin/private-stylist/HerViewTab) names its
// iframe with this, so her pages can draw as the iPhone app draws them —
// the app's class on <html>, the iPhone wording, Safari not Chrome — even
// though Chloe is on a computer. A frame's name survives every navigation
// inside it and is never set anywhere else, so her real phone and her
// browser are untouched. It only changes what is SHOWN: anything that
// actually hands off to the app (Safari, push, the share sheet) still asks
// Capacitor itself.
export const PHONE_FRAME_NAME = 'myra-her-view-iphone'

/** True inside HER VIEW's iPhone frame. Client only. */
export function inPhoneFrame(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.name === PHONE_FRAME_NAME } catch { return false }
}
