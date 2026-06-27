import { redirect } from 'next/navigation'

// The Edit is now live on the homepage, so /feed (the old "launching soon"
// holding page) just forwards there.
export default function FeedPage() {
  redirect('/')
}
