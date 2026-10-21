// WEBSITE-ONLY CONTENT.
//
// Wraps the parts of a page that are the website — the sign-in form, the
// landing page — and must never be seen inside the iPhone app. The shell
// marks <html> as the app at document start (root layout), and
// `html.myra-app .myra-web-only` hides this from the very first paint, so a
// slow connection or a cold launch never flashes the website before the door
// (AppDoor) has hydrated over it. In Safari and on the desktop the wrapper is
// inert: display: contents, no box, nothing hidden.
export default function WebOnly({ children }: { children: React.ReactNode }) {
  return <div className="myra-web-only contents">{children}</div>
}
