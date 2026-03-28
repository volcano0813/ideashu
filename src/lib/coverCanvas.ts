/** 3:4 封面合成，输出 JPEG Blob（与产品规格一致：1080×1440） */

export const COVER_CANVAS_W = 1080
export const COVER_CANVAS_H = 1440

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = ch
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : [' ']
}

/** 底部渐变 + 白字描边，统一「小红书风」封面大字 */
export function drawXhsOverlay(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  overlayText: string,
) {
  const gradient = ctx.createLinearGradient(0, canvasH * 0.83, 0, canvasH)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, 'rgba(0,0,0,0.62)')
  ctx.fillStyle = gradient
  const bandTop = Math.floor(canvasH * 0.78)
  ctx.fillRect(0, bandTop, canvasW, canvasH - bandTop)

  const text = overlayText.trim() || ' '
  const fontSize = text.length > 14 ? 44 : text.length > 8 ? 52 : 64
  ctx.font = `bold ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const maxW = canvasW - 80
  const lines = wrapTextLines(ctx, text, maxW)
  const lineHeight = fontSize * 1.2
  const totalH = lines.length * lineHeight
  const centerY = canvasH - 110
  let startY = centerY - totalH / 2 + lineHeight / 2

  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  for (const line of lines) {
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.fillStyle = '#ffffff'
    ctx.strokeText(line, canvasW / 2, startY)
    ctx.fillText(line, canvasW / 2, startY)
    startY += lineHeight
  }
}

function drawImageCoverCrop(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  overlayText: string,
) {
  const targetRatio = 3 / 4
  const imgRatio = img.width / img.height
  let sx = 0
  let sy = 0
  let sw = img.width
  let sh = img.height
  if (imgRatio > targetRatio) {
    sw = img.height * targetRatio
    sx = (img.width - sw) / 2
  } else {
    sh = img.width / targetRatio
    sy = (img.height - sh) / 2
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, COVER_CANVAS_W, COVER_CANVAS_H)
  drawXhsOverlay(ctx, COVER_CANVAS_W, COVER_CANVAS_H, overlayText)
}

function loadImageFromSource(source: File | string): Promise<HTMLImageElement> {
  if (source instanceof File) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(source)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        resolve(img)
      }
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('file load'))
      }
      img.src = objectUrl
    })
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (source.startsWith('http://') || source.startsWith('https://')) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('url load'))
    img.src = source
  })
}

/**
 * 从本地文件或图片 URL（data / https，需 CDN 支持 CORS 才能导出 canvas）合成 3:4 封面 JPEG。
 */
export async function compositeCoverFromImageSource(
  source: File | string,
  overlayText: string,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = COVER_CANVAS_W
  canvas.height = COVER_CANVAS_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  try {
    const img = await loadImageFromSource(source)
    drawImageCoverCrop(ctx, img, overlayText)
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92)
    })
  } catch {
    return null
  }
}

export function generateCoverPreview(imageFile: File, overlayText: string): Promise<Blob | null> {
  return compositeCoverFromImageSource(imageFile, overlayText)
}

export function revokeCoverObjectUrl(url: string) {
  try {
    URL.revokeObjectURL(url)
  } catch {
    // ignore
  }
}
