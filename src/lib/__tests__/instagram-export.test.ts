import { describe, it, expect } from 'vitest'
import { fixMojibake, isPostPhoto, isPostsList, monthFromPath, pickPostPhotos, readPostsList } from '@/lib/archival/instagram-export'

describe('isPostPhoto', () => {
  it('takes her feed photos', () => {
    expect(isPostPhoto('media/posts/202403/12345_n.jpg')).toBe(true)
    expect(isPostPhoto('instagram-chloe-2026-09-21/media/posts/202512/a.webp')).toBe(true)
    expect(isPostPhoto('media\\posts\\202401\\b.JPG')).toBe(true)
  })
  it('never touches messages, stories, reels, videos or profile pictures', () => {
    for (const p of [
      'your_instagram_activity/messages/inbox/friend_123/photos/x.jpg',
      'media/stories/202403/s.jpg',
      'media/reels/202403/r.jpg',
      'media/posts/202403/clip.mp4',
      'media/profile/202001/me.jpg',
      'media/other/202403/o.jpg',
    ]) expect(isPostPhoto(p)).toBe(false)
  })
})

describe('reading the export', () => {
  it('dates a photo from its folder when the list says nothing', () => {
    expect(monthFromPath('media/posts/202403/a.jpg')).toBe('2024-03-01T12:00:00.000Z')
    expect(monthFromPath('media/posts/other/a.jpg')).toBeNull()
  })

  it('reads dates and captions from posts_1.json, mending Instagram\'s text encoding', () => {
    const listed = readPostsList([
      { media: [{ uri: 'media/posts/202403/a.jpg', creation_timestamp: 1710000000, title: 'CafÃ© days' }] },
      { title: 'Two at once', creation_timestamp: 1700000000, media: [{ uri: 'media/posts/202311/b.jpg' }, { uri: 'media/posts/202311/c.jpg' }] },
    ])
    expect(listed.get('media/posts/202403/a.jpg')).toEqual({ takenAt: new Date(1710000000 * 1000).toISOString(), caption: 'Café days' })
    expect(listed.get('media/posts/202311/c.jpg')?.caption).toBe('Two at once')
    expect(fixMojibake('plain')).toBe('plain')
  })

  it('picks the newest post photos first, capped, from a nested zip', () => {
    const listed = readPostsList([{ media: [{ uri: 'media/posts/202403/a.jpg', creation_timestamp: 1710000000 }] }])
    const picked = pickPostPhotos([
      'export/media/posts/202201/old.jpg',
      'export/media/posts/202403/a.jpg',
      'export/media/posts/202506/new.jpg',
      'export/media/stories/202506/story.jpg',
      'export/your_instagram_activity/messages/inbox/x/photos/p.jpg',
    ], listed, 2)
    expect(picked.map((p) => p.path)).toEqual(['export/media/posts/202506/new.jpg', 'export/media/posts/202403/a.jpg'])
    expect(picked[1].takenAt).toBe(new Date(1710000000 * 1000).toISOString())
  })

  it('knows the list of posts when it sees it', () => {
    expect(isPostsList('your_instagram_activity/media/posts_1.json')).toBe(true)
    expect(isPostsList('content/posts_2.json')).toBe(true)
    expect(isPostsList('media/posts/202403/a.jpg')).toBe(false)
  })
})
