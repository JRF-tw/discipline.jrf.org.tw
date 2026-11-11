import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from 'playwright';

const meta = JSON.parse(await readFile('data/pattern-meta.json', 'utf8'));
const expected = Object.fromEntries(Object.entries(meta.patterns).map(([id, p]) => [id,
  (p.desc?.blocks || []).filter(b => b.type === 'subcats')
    .reduce((n, b) => n + b.rows.filter(r => r.id).length, 0)]));
const server = spawn('python3', ['-u', '-m', 'http.server', '4174', '--directory', '_site']);
await once(server.stderr, 'data');
let browser;
try {
  browser = await ({ chromium, firefox, webkit }[process.env.TEST_BROWSER || 'chromium']).launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4174/?tab=pattern', { waitUntil: 'networkidle' });
  // 使用實際頁籤路由進入總覽，避免靜態伺服器需要路徑回退。
  await page.locator('#tabbtn-pattern').click();
  const cards = page.locator('#pattern-list .db-pattern-item');
  await cards.first().waitFor();
  for (const card of await cards.all()) {
    const id = (await card.getAttribute('href')).split('/').pop();
    const count = expected[id];
    assert.equal(await card.evaluate(e => e.tagName), 'A');
    assert.equal(await card.locator('.db-pattern-item__sub').count(), count ? 1 : 0);
    assert.equal((await card.getAttribute('class')).includes('--has-sub'), count > 0);
    if (count) {
      assert.equal(await card.locator('.db-pattern-item__sub').innerText(), `${count} 子類`);
      assert.equal(await card.locator('svg').getAttribute('aria-hidden'), 'true');
      assert.equal(await card.getAttribute('aria-label'), null);
    }
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: 水平溢出`);
    const boxes = await cards.evaluateAll(items => items.map(e => {
      const r = e.getBoundingClientRect(), sub = e.querySelector('.db-pattern-item__sub');
      const n = e.firstElementChild.getBoundingClientRect(), c = e.lastElementChild.getBoundingClientRect();
      const s = sub?.getBoundingClientRect();
      return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, height:r.height, sub:!!sub,
        ordered:!s || (n.right <= s.x && s.right <= c.x),
        inside:c.right <= r.right, nowrap:!sub || getComputedStyle(sub).whiteSpace === 'nowrap' };
    }));
    for (const [i, box] of boxes.entries()) {
      assert.ok(box.height >= (box.sub ? 56 : 44));
      assert.ok(box.ordered && box.inside && box.nowrap);
      if (box.sub) for (const other of boxes.slice(i + 1)) {
        assert.ok(box.right + 4 <= other.x || other.right <= box.x || box.bottom + 4 <= other.y || other.bottom <= box.y, '疊層重疊');
      }
    }
  }
  const sub = page.locator('.db-pattern-item--has-sub').first();
  await sub.evaluate(e => e.style.setProperty('--pattern-color', '#123456'));
  await sub.hover();
  await page.waitForTimeout(300);
  assert.equal(await sub.locator('.db-pattern-item__sub').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(18, 52, 86)');
  await page.keyboard.press('Tab');
  await sub.focus();
  assert.equal(await sub.evaluate(e => getComputedStyle(e).outlineColor), 'rgb(184, 137, 47)');
  for (const zero of await page.locator('.db-pattern-overview .db-zero').all()) {
    assert.equal(await zero.evaluate(e => getComputedStyle(e).color), 'rgb(107, 112, 121)');
    assert.equal(await zero.locator('.db-cnt').evaluate(e => getComputedStyle(e).color), 'rgb(107, 112, 121)');
  }
  const id = (await sub.getAttribute('href')).split('/').pop();
  await sub.click();
  await page.waitForURL(new RegExp(`/pattern/${id}`));
  assert.equal(await page.locator('#pattern-detail [data-subcat]').count(), expected[id]);
  assert.equal(await page.locator('#pattern-list .db-pattern-item__sub').count(), 0, '內頁不得改變');
  console.log(`Pattern overview passed (${process.env.TEST_BROWSER || 'chromium'}): counts, layout, colors, focus, navigation`);
} finally {
  await browser?.close();
  server.kill();
}
