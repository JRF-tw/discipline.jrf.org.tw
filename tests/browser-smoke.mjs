import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { get } from 'node:http';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';

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

  const useFirefox = process.env.TEST_BROWSER === 'firefox';
  browser = await (useFirefox ? firefox : chromium).launch({
    headless: true,
    ...(useFirefox ? {firefoxUserPrefs:{'accessibility.typeaheadfind':true}} : {})
  });
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

  // 透過既有全文按鈕事件開啟含刑事判決的固定案例，不依賴列表排序與分頁。
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  const source = JSON.parse(await readFile('data/cases.json', 'utf8'));
  await page.locator('#tabbtn-complaint').click();
  assert.equal(await page.locator('#pub-entry .db-pub-item').count(), 12);
  const publicPatternIds = await page.locator('#pub-entry .db-pub-pat').evaluateAll(
    (buttons) => [...new Set(buttons.map((button) => button.dataset.patternId))].sort());
  await page.locator('#tabbtn-pattern').click();
  const patternHint = page.locator('#tab-pattern .db-hint').filter({has:page.locator('.db-pat-common-key')});
  assert.match(await patternHint.innerText(), /實務上民眾可能較常見.*類型/, '淡黃色標示應說明常見態樣的意義');
  async function checkPatternHighlights(){
    const cards = await page.locator('#pattern-list .db-pattern-item').evaluateAll((buttons) => buttons.map((button) => ({
      name:button.firstElementChild.textContent, common:button.classList.contains('db-pat-common'),
      selected:button.classList.contains('db-cur'), background:getComputedStyle(button).backgroundColor
    })));
    for(const card of cards){
      assert.equal(card.common, publicPatternIds.includes(source.patterns.find((p) => p.name === card.name).id), '態樣標示必須與民眾入口一致');
      if(card.common && !card.selected) assert.equal(card.background, 'rgb(255, 248, 220)', '常見態樣應為淡黃色');
    }
    return [...new Set(cards.filter((card) => card.common).map((card) => source.patterns.find((p) => p.name === card.name).id))].sort();
  }
  assert.deepEqual(await checkPatternHighlights(), publicPatternIds, '展開後應標示所有民眾入口對應態樣');
  await page.locator('#pl-toggle-btn').click();
  await checkPatternHighlights();
  await page.locator('#pl-toggle-btn').click();
  assert.deepEqual(await checkPatternHighlights(), publicPatternIds, '展開後應標示所有民眾入口對應態樣');
  await page.goto(`http://127.0.0.1:${port}/`, {waitUntil:'networkidle'});
  const criminalIndex = source.cases.findIndex((c) => c.caseNo === '104年度律懲字第3號');
  assert.ok(criminalIndex >= 0);
  async function openCriminalCase(index = criminalIndex){
    await page.evaluate((index) => {
      const button = document.createElement('button');
      button.id = 'test-criminal-open';
      button.className = 'db-ft-open';
      button.dataset.ftSlot = 'main';
      button.dataset.ftI = String(index);
      document.body.appendChild(button);
      button.click();
    }, index);
    await page.locator('#ft-dlg[open]').waitFor();
    await page.locator('#ft-body [data-criminal-judgment]').first().waitFor({state:'attached'});
    await page.locator('#test-criminal-open').evaluate((button) => button.remove());
  }
  await openCriminalCase();
  await page.clock.install();
  const criminalLabel = page.locator('#ft-body dt[data-criminal-judgment]');
  const criminalValue = page.locator('#ft-body dd[data-criminal-judgment]');
  async function assertCriminalHidden(){
    assert.equal(await criminalLabel.isVisible(), false, '刑事判決標題應隱藏');
    assert.equal(await criminalValue.isVisible(), false, '刑事判決內容應隱藏');
  }
  const blank = () => page.locator('#ft-body').click({position:{x:5,y:5}});
  await assertCriminalHidden();
  await page.keyboard.type('unhide');
  await assertCriminalHidden();
  await page.locator('#ft-body .meta dt').first().click({position:{x:5,y:12}});
  await page.keyboard.type('unhide');
  await assertCriminalHidden();
  await blank();
  await page.clock.fastForward(5001);
  await page.keyboard.type('unhide');
  await assertCriminalHidden();
  await blank();
  await page.keyboard.type('un');
  await page.clock.fastForward(5001);
  await page.keyboard.type('hide');
  await assertCriminalHidden();
  await blank();
  await page.keyboard.type('unxhide');
  await assertCriminalHidden();
  await page.evaluate(() => {
    window.unhideKeyDefaults = [];
    window.addEventListener('keydown', (event) => {
      window.unhideKeyDefaults.push({key:event.key, prevented:event.defaultPrevented});
    });
  });
  await blank();
  await page.keyboard.type('unhide');
  assert.deepEqual(await page.evaluate(() => window.unhideKeyDefaults),
    [...'unhide'].map((key) => ({key, prevented:true})),
    '指令按鍵必須取消預設行為，避免觸發 Firefox 隨打即找');
  assert.equal(await criminalLabel.isVisible(), true, '正確指令應顯示刑事判決標題');
  assert.equal(await criminalValue.isVisible(), true, '正確指令應顯示刑事判決連結');
  assert.ok(await criminalValue.locator('a').count());
  const otherCriminalIndex = source.cases.findIndex((c) => c.caseNo === '114年度律懲字第5號');
  assert.ok(otherCriminalIndex >= 0);
  await openCriminalCase(otherCriminalIndex);
  assert.equal(await criminalValue.isVisible(), true, '切換案件應維持解鎖');
  await page.keyboard.press('Escape');
  // 彈窗切換案件會新增歷史；關閉後先退回上一份全文，再關閉回網站。
  await page.waitForURL((url) => url.searchParams.get('full') === '104年度律懲字第3號');
  await page.locator('#ft-dlg[open]').waitFor();
  assert.equal(await criminalValue.isVisible(), true, '歷史返回也應維持解鎖');
  await page.keyboard.press('Escape');
  await page.waitForURL((url) => !url.searchParams.has('full'));
  await openCriminalCase();
  assert.equal(await criminalValue.isVisible(), true, '關閉重開彈窗應維持解鎖');
  await page.keyboard.press('Escape');
  await page.waitForURL((url) => !url.searchParams.has('full'));
  await page.reload({waitUntil:'networkidle'});
  await openCriminalCase();
  assert.equal(await criminalValue.isVisible(), true, '重新整理應維持解鎖');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#ft-dlg')?.open);
  // 全新的瀏覽工作階段預設仍隱藏。
  const previousPage = page;
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, {waitUntil:'networkidle'});
  await openCriminalCase();
  await assertCriminalHidden();
  await page.close();
  page = previousPage;
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
