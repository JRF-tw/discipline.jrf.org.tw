/* 資料載入器
   主程式（app.js）原本設計為從頁面內的 <script type="application/json"> 節點讀取資料
   （#db、#db-content-meta、#db-pattern-meta）。資料拆成 data/*.json 獨立檔後，
   由本檔先下載三份 JSON、放回同 id 的節點，再載入 app.js，主程式因此不必修改。 */
(function(){
  var FILES = [
    ['db-content-meta', 'data/content-meta.json'],
    ['db-pattern-meta', 'data/pattern-meta.json'],
    ['db',              'data/cases.json']
  ];

  function fail(err){
    if(window.console && console.error) console.error('[律師懲戒案件資料庫] 資料載入失敗：', err);
    var wrap = document.querySelector('.db-wrap');
    if(!wrap) return;
    var p = document.createElement('p');
    p.setAttribute('role', 'alert');
    p.style.cssText = 'margin:16px;padding:12px 16px;border:1px solid #c33;border-radius:6px;background:#fff4f4;color:#900';
    p.textContent = '資料載入失敗，請重新整理頁面。若持續發生，請來信 contact@jrf.org.tw。';
    wrap.insertBefore(p, wrap.firstChild);
  }

  Promise.all(FILES.map(function(f){
    return fetch(f[1]).then(function(res){
      if(!res.ok) throw new Error(f[1] + ' HTTP ' + res.status);
      return res.text();
    });
  })).then(function(texts){
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
})();
