/* 資料載入器
   先下載三份 JSON，建立主程式使用的資料節點，再載入 app.js。 */
(function(){
  var FILES = [
    ['db-content-meta', 'data/content-meta.json'],
    ['db-pattern-meta', 'data/pattern-meta.json'],
    ['db',              'data/cases-index.json']
  ];

  function fail(err){
    if(window.console && console.error) console.error('[律師懲戒案件資料庫] 資料載入失敗：', err);
    document.documentElement.classList.remove('db-route-pending');
    var wrap = document.querySelector('.db-wrap');
    if(!wrap) return;
    var p = document.createElement('p');
    p.setAttribute('role', 'alert');
    p.style.cssText = 'margin:16px;padding:12px 16px;border:1px solid #c33;border-radius:6px;background:#fff4f4;color:#900';
    p.textContent = '資料載入失敗，請重新整理頁面。若持續發生，請來信 contact@jrf.org.tw。';
    wrap.insertBefore(p, wrap.firstChild);
  }

  function fetchText(path){
    return fetch(path).then(function(res){
      if(!res.ok) throw new Error(path + ' HTTP ' + res.status);
      return res.text();
    });
  }

  /* 本機直接預覽舊工作目錄時仍可使用原始 cases.json；正式部署由 workflow
     產生較小的 cases-index.json 與按需載入的 cases-fulltext.json。 */
  var dataFetch = fetchText(FILES[2][1]).catch(function(err){
    if(err && /cases-index\.json/.test(String(err.message || err))) return fetchText('data/cases.json');
    throw err;
  });
  Promise.all([fetchText(FILES[0][1]), fetchText(FILES[1][1]), dataFetch]).then(function(texts){
    texts.forEach(function(text, i){
      var node = document.createElement('script');
      node.type = 'application/json';
      node.id = FILES[i][0];
      node.textContent = text;
      document.body.appendChild(node);
    });
    var app = document.createElement('script');
    app.src = 'assets/js/app.js';
    app.onerror = function(){ fail(new Error('assets/js/app.js 載入失敗')); };
    document.body.appendChild(app);
  }).catch(fail);

  window.__loadDisciplineFulltext = function(){
    if(window.__disciplineFulltextPromise) return window.__disciplineFulltextPromise;
    window.__disciplineFulltextPromise = fetchText('data/cases-fulltext.json').then(function(text){
      return JSON.parse(text);
    });
    return window.__disciplineFulltextPromise;
  };
})();
