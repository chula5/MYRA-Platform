'use client'

// Opens the slide-out Wardrobe from anywhere (the Wardrobe listens for this
// event). Gives a clearly discoverable entry point in the header, in addition
// to the right-edge handle.
export default function OpenWardrobeButton() {
  return (
    <button
      type="button"
      onClick={() => { try { window.dispatchEvent(new CustomEvent('myra:open-wardrobe')) } catch { /* ignore */ } }}
      className="text-[9px] tracking-[0.09em] text-[#4A4E57] hover:text-[#0A0A0A] transition-colors"
    >
      MY WARDROBE
    </button>
  )
}
