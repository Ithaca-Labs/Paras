import { ImageResponse } from 'next/og';
import { venuePrices } from '@/components/odds-line';
import { serverApi } from '@/lib/api';
import { cents } from '@/lib/format';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Paras: compare this Event across Venues';

/** Google Fonts subset as TTF (no UA header = truetype, which satori reads). Null on failure. */
async function font(family: string, weight: number, text: string) {
  try {
    const css = await (
      await fetch(
        `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`,
      )
    ).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await serverApi()
    .getEvent({ params: { id } })
    .catch(() => null);
  const title = event?.title ?? 'Compare prediction market odds across Venues';
  const prices = event ? venuePrices(event).slice(0, 4) : [];
  const chips = prices.map((p) => `${p.venue} ${cents(String(p.price))}`);
  const lead = prices[0] && `${prices[0].label} from ${cents(String(prices[0].price))}`;

  const [mincho, gothic] = await Promise.all([
    font('Shippori+Mincho+B1', 800, `Paras${title}`),
    font('Zen+Kaku+Gothic+New', 500, `${chips.join('')}${lead ?? ''}paraspredic.fun·`),
  ]);
  const fonts = [
    ...(mincho ? [{ name: 'Mincho', data: mincho, weight: 800 as const }] : []),
    ...(gothic ? [{ name: 'Gothic', data: gothic, weight: 500 as const }] : []),
  ];
  const titleSize = title.length > 90 ? 46 : title.length > 55 ? 54 : 64;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        background: '#f6f1e6',
        color: '#1e2b3f',
        fontFamily: 'Gothic',
        position: 'relative',
      }}
    >
      {/* The banner's red sun, as a seal. */}
      <div
        style={{
          position: 'absolute',
          top: -170,
          right: -130,
          width: 400,
          height: 400,
          borderRadius: 9999,
          background: '#c3563d',
          opacity: 0.9,
        }}
      />
      <div style={{ display: 'flex', fontFamily: 'Mincho', fontSize: 40, fontWeight: 800 }}>
        Paras
      </div>
      <div
        style={{
          display: 'flex',
          maxWidth: 860,
          fontFamily: 'Mincho',
          fontSize: titleSize,
          fontWeight: 800,
          lineHeight: 1.15,
          lineClamp: 3,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {lead && <div style={{ display: 'flex', fontSize: 28, color: '#2f685b' }}>{lead}</div>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {chips.map((c) => (
              <div
                key={c}
                style={{
                  display: 'flex',
                  padding: '8px 18px',
                  borderRadius: 9999,
                  border: '2px solid #ddd3bf',
                  background: '#fbf8f0',
                  fontSize: 24,
                }}
              >
                {c}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: '#5b6474' }}>paraspredic.fun</div>
        </div>
      </div>
    </div>,
    { ...size, fonts },
  );
}
