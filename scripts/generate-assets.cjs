// Original geometric ReceiptMind artwork. No fonts, stock art or network inputs.
const fs = require('node:fs/promises');
const sharp = require('sharp');
const paper = '<path d="M340 270Q340 246 364 246H550L650 346V722L611 697L572 722L533 697L494 722L455 697L416 722L377 697L340 722Z" fill="#F8FAF4"/>';
const mark = `${paper}<path d="M550 246V326Q550 346 570 346H650" fill="#C9E2D2"/>
<path d="M392 386H550M392 443H526M392 500H468" fill="none" stroke="#246B45" stroke-width="24" stroke-linecap="round"/>
<circle cx="570" cy="581" r="87" fill="#246B45" stroke="#F8FAF4" stroke-width="18"/>
<circle cx="570" cy="581" r="47" fill="none" stroke="#EBC46B" stroke-width="20"/>
<path d="M630 645L701 716" stroke="#F8FAF4" stroke-width="51" stroke-linecap="round"/>
<path d="M630 645L701 716" stroke="#EBC46B" stroke-width="27" stroke-linecap="round"/>`;
const svg = (content, viewBox = '0 0 1024 1024') => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${viewBox}">${content}</svg>`;
async function main() {
  await fs.mkdir('assets', { recursive: true });
  await fs.writeFile('assets/brand-mark.svg', svg(mark));
  const outputs = [
    ['icon.png', svg(`<rect width="1024" height="1024" fill="#164D35"/><g transform="translate(512 512) scale(1.28) translate(-512 -512)">${mark}</g>`)],
    ['adaptive-foreground.png', svg(mark)],
    ['adaptive-monochrome.png', svg(`${paper}<circle cx="570" cy="581" r="87" fill="white"/><path d="M630 645L701 716" stroke="white" stroke-width="51" stroke-linecap="round"/>`)],
    ['splash-mark.png', svg(mark, '280 220 480 540')],
  ];
  for (const [name, input] of outputs) await sharp(Buffer.from(input)).png().toFile(`assets/${name}`);
  const icon = await sharp('assets/icon.png').resize(256).toBuffer();
  const adaptive = await sharp('assets/adaptive-foreground.png').resize(256).toBuffer();
  await sharp({ create: { width: 576, height: 288, channels: 4, background: '#F5F7F4' } })
    .composite([{ input: icon, left: 16, top: 16 }, { input: adaptive, left: 304, top: 16 }]).png().toFile('assets/asset-preview.png');
}
main().catch(() => { console.error('Asset generation failed.'); process.exitCode = 1; });
