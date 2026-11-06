import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { get } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const port = 4173;
const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', '_site'], {
  stdio: ['ignore', 'pipe', 'pipe']
});
let browser;
let page;
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('測試網站啟動逾時')), 10000);
    const check = () => {
      const request = get(`http://127.0.0.1:${port}/`, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 400) {
          clearTimeout(timer);
          resolve();
          return;
        }
        setTimeout(check, 100);
      });
      request.on('error', () => setTimeout(check, 100));
    };
    server.once('error', reject);
    check();
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error);
    console.error('[browser pageerror]', error.stack || error.message);
  });
  page.on('console', (message) => {
    if(message.type() === 'error') console.error('[browser console]', message.text());
  });
  page.on('requestfailed', (request) => console.error('[request failed]', request.url(), request.failure()));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.locator('#tabbtn-list').click();
  await page.locator('#list-table table').waitFor();
  assert.ok((await page.locator('#list-table tbody tr').count()) > 0, '案件列表沒有資料');

  const fulltextButton = page.locator('#list-table .db-ft-open').first();
  await fulltextButton.waitFor();
  console.log('Opening fulltext:', await fulltextButton.evaluate((button) => ({slot:button.dataset.ftSlot, index:button.dataset.ftI})));
  await fulltextButton.click();
  await page.locator('#ft-dlg[open]').waitFor();
  assert.ok((await page.locator('#ft-body').innerText()).length > 0, '全文對話框沒有內容');
  await page.locator('#ft-x').click();
  await page.waitForFunction(() => !document.querySelector('#ft-dlg')?.open);
  assert.equal(errors.length, 0, errors.map((error) => error.message).join('\n'));
  await browser.close();
  browser = null;
  console.log('Browser smoke test passed');
} catch (error) {
  if(page) console.error('[failure state]', await page.evaluate(() => ({
    url: location.href,
    dialogExists: !!document.querySelector('#ft-dlg'),
    dialogOpen: !!document.querySelector('#ft-dlg')?.open
  })).catch(() => 'page unavailable'));
  throw error;
} finally {
  if(browser) await browser.close();
  server.kill('SIGTERM');
  await once(server, 'close').catch(() => {});
}
