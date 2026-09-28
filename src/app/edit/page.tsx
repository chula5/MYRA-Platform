import { notFound } from 'next/navigation'

// `/edit` was the old client home. It is retired completely: the private-
// stylist client home is `/me`.
export default function RetiredEditRoute() {
  notFound()
}
