import { ImageResponse } from 'next/og'

export const alt = 'Verso. A notebook for thinking with AI.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        width: '100%', height: '100%', padding: '72px 80px',
        background: '#000000', color: '#f5f5f5',
      }}>
        <div style={{ fontSize: 32 }}>Verso</div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 68, lineHeight: 1.15, letterSpacing: '-2px' }}>
          <div>A notebook for</div>
          <div>thinking with AI.</div>
        </div>
        <div style={{ fontSize: 24, color: '#a3a3a3' }}>thinkwithverso.com</div>
      </div>
    ),
    size,
  )
}
