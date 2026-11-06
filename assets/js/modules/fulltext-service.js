/* 全文資料服務：只負責按需取得與快取全文 JSON，不處理畫面與彈窗。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  var promise = null;

  function fetchJson(){
    return fetch('data/cases-fulltext.json').then(function(res){
      if(!res.ok) throw new Error('data/cases-fulltext.json HTTP ' + res.status);
      return res.json();
    });
  }

  app.services = app.services || {};
  app.services.fulltext = {
    load: function(){
      if(!promise) promise = fetchJson().catch(function(err){ promise = null; throw err; });
      return promise;
    },
    reset: function(){ promise = null; }
  };
})(window);
