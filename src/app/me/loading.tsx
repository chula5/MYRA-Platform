import RoomLoading from '@/components/me/RoomLoading'

// Shown inside the /me layout while any room is being fetched, so the tab
// bar answers at the tap and the server's work happens behind a mirror.
export default function Loading() {
  return <RoomLoading />
}
