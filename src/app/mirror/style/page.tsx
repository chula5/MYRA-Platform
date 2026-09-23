import StylePopoutClient from './StylePopoutClient'

export const dynamic = 'force-dynamic'

// The little box that pops out of a brand site's product. Lives in an iframe
// the MYRA Mirror extension positions beside the tile. It never receives the
// member token in its URL: the extension posts it in once the frame is ready.
export default function MirrorStylePage({ searchParams }: { searchParams: { u?: string } }) {
  return <StylePopoutClient productUrl={searchParams.u ?? ''} />
}
