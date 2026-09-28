// Renders the PNG app icons in public/ from public/favicon.svg.
// Usage: npm run icons   (set PW_CHROMIUM_PATH to use a preinstalled Chromium)
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
const background = '#1d3f6e'

// full: the whole icon edge to edge (square, no rounded corners).
// scale: shrink the artwork so it stays inside Android's maskable safe zone.
const icons = [
  { file: 'pwa-192.png', size: 192, full: false, scale: 1 },
  { file: 'pwa-512.png', size: 512, full: false, scale: 1 },
  { file: 'pwa-maskable-512.png', size: 512, full: true, scale: 0.8 },
  { file: 'apple-touch-icon.png', size: 180, full: true, scale: 0.9 },
]

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined })
const page = await browser.newPage()

for (const { file, size, full, scale } of icons) {
  const art = full ? inner.replace(/<rect width="512" height="512" rx="112"[^>]*\/>/, '') : inner
  const offset = (512 * (1 - scale)) / 2
  const html = `<html><body style="margin:0">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
      ${full ? `<rect width="512" height="512" fill="${background}"/>` : ''}
      <g transform="translate(${offset} ${offset}) scale(${scale})">${art}</g>
    </svg></body></html>`
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(html)
  await page.screenshot({ path: `public/${file}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  console.log(`wrote public/${file}`)
}

await browser.close()
