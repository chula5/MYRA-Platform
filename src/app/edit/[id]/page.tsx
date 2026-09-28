import { notFound } from 'next/navigation'

// Outfit detail URLs from the retired Edit feed are not part of the live
// product surface.
export default function RetiredEditDetailRoute() {
  notFound()
}
