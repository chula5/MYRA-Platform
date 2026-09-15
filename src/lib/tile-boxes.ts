// Boxes for the separate outfit photos found in one screenshot.
//
// Pure: turns the boxes the vision pass returns (in the pixels of the resized
// image it was shown) into crop rectangles on the ORIGINAL image — scaled back
// up, padded a little so a model's feet or bag are not clipped, clamped to the
// image, with slivers and near-duplicates dropped.

export interface TileBox {
  x: number
  y: number
  width: number
  height: number
}

/** Smallest tile kept, as a share of the image's shorter side. */
export const MIN_TILE_SHARE = 0.12
/** Two boxes overlapping more than this (intersection over union) are one photo. */
export const DUPLICATE_IOU = 0.6
/** Padding added on every side, as a share of the tile's own size. */
export const TILE_PAD = 0.015

function iou(a: TileBox, b: TileBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

/**
 * @param boxes boxes in the coordinates of the image the model saw
 * @param scale original size ÷ size shown to the model
 * @param width original image width
 * @param height original image height
 */
export function normaliseTileBoxes(
  boxes: TileBox[],
  scale: number,
  width: number,
  height: number,
): TileBox[] {
  const minSide = Math.min(width, height) * MIN_TILE_SHARE
  const out: TileBox[] = []
  for (const b of boxes) {
    if (![b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))) continue
    const w = b.width * scale
    const h = b.height * scale
    const padX = w * TILE_PAD
    const padY = h * TILE_PAD
    const x = Math.max(0, Math.round(b.x * scale - padX))
    const y = Math.max(0, Math.round(b.y * scale - padY))
    const right = Math.min(width, Math.round(b.x * scale + w + padX))
    const bottom = Math.min(height, Math.round(b.y * scale + h + padY))
    const box = { x, y, width: right - x, height: bottom - y }
    if (box.width < minSide || box.height < minSide) continue
    if (out.some((o) => iou(o, box) > DUPLICATE_IOU)) continue
    out.push(box)
  }
  // Reading order: top to bottom, then left to right, row by row.
  const rowTolerance = Math.min(width, height) * 0.05
  return out.sort((a, b) => (Math.abs(a.y - b.y) > rowTolerance ? a.y - b.y : a.x - b.x))
}

/** True when one box already is (nearly) the whole image — nothing to crop. */
export function coversImage(box: TileBox, width: number, height: number): boolean {
  return (box.width * box.height) / (width * height) >= 0.85
}
