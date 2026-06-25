import { chromium } from 'playwright';

const projectId = '69d405c9-1eee-4b0f-91b4-2e677ba10c23';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: 'playwright/.auth/user.json',
  viewport: { width: 390, height: 844 }
});
const page = await ctx.newPage();
await page.goto('http://localhost:3000/dashboard');
await page.waitForTimeout(2000);
await page.goto(`http://localhost:3000/project/${projectId}/chat/channel-general`);
await page.waitForTimeout(5000);
await page.screenshot({ path: '/tmp/chat_debug.png', fullPage: false });

// Inspect ALL aside elements
const asides = await page.evaluate(() => {
  const all = document.querySelectorAll('aside');
  return Array.from(all).map(el => {
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      class: el.className.slice(0, 100),
      position: cs.position,
      transform: cs.transform,
      left: cs.left,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      visibility: cs.visibility,
      display: cs.display,
    };
  });
});
console.log('Asides:', JSON.stringify(asides, null, 2));

// Inspect the center section
const section = await page.evaluate(() => {
  const el = document.querySelector('section');
  if (!el) return null;
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    class: el.className.slice(0, 100),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
  };
});
console.log('Section:', JSON.stringify(section));

await browser.close();
