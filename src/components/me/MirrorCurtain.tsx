// The screen as only the mirror: a pearl curtain over everything with the
// mirror wiggling in the middle. `leaving` sends it up to the logo and lifts
// the curtain (styles in globals.css, .myra-curtain).

export default function MirrorCurtain({ leaving = false }: { leaving?: boolean }) {
  return (
    <div className={`myra-curtain myra-pearl ${leaving ? 'leaving' : ''}`} aria-busy={!leaving}>
      <img src="/myra-mirror-transparent.png" alt="" className="myra-curtain-mirror h-52 md:h-72 w-auto" />
    </div>
  )
}
