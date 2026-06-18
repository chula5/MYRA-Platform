'use client'

import WaitlistModal from '@/components/WaitlistModal'
import LandingTracker, { trackLandingClick } from '@/components/analytics/LandingTracker'

export default function LandingPageClient({ triggerClassName }: { triggerClassName: string }) {
  return (
    <>
      <LandingTracker />
      <WaitlistModal
        triggerClassName={triggerClassName}
        onOpen={() => trackLandingClick('cta_click')}
      />
    </>
  )
}
