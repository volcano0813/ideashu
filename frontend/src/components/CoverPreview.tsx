import type { CoverComposition } from '../api/contracts'

export function CoverPreview({ composition }: { composition: CoverComposition }) {
  return (
    <div className={`cover-preview ${composition.align}`} style={{ '--accent': composition.accentColor, '--title': composition.titleColor } as React.CSSProperties}>
      <div className="cover-grid" />
      <div className="cover-kicker">IDEASHU · LOCAL COMPOSITION</div>
      <div className="cover-copy"><h3>{composition.title || '封面标题'}</h3><p>{composition.subtitle || '可编辑的中文副标题'}</p><i /></div>
      <div className="cover-foot">1080 × 1440 · 3:4</div>
    </div>
  )
}
