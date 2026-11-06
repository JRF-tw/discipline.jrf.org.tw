/* 案件清單呈現元件：先抽出全文欄標籤，逐步降低 app.js 對列表 HTML 的耦合。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.modules = app.modules || {};

  function fullWord(value, revValue, index, slot, hasFulltext){
    var valueText = String(value == null ? '' : value).trim();
    if(typeof hasFulltext === 'function' && hasFulltext(slot || 'main', index)) return '全文';
    if(/^https?:\/\//i.test(valueText)) return '全文';
    var revText = String(revValue == null ? '' : revValue).trim();
    if((valueText === '無全文' || valueText === '') && /^https?:\/\//i.test(revText)) return '詳覆審';
    if(valueText === '無全文') return '無全文';
    return '';
  }

  function fullTag(value, revValue, index, slot, hasFulltext, escapeHtml){
    var sl = slot || 'main';
    var word = fullWord(value, revValue, index, sl, hasFulltext);
    if(word === '全文'){
      return '<button type="button" class="db-full-tag db-ft-open" data-ft-slot="'+sl+
        '" data-ft-i="'+index+'" aria-label="在本頁閱讀決議書全文">全文</button>';
    }
    var tip = ' tabindex="0" data-ft-tip="1" aria-describedby="db-ft-tip"';
    if(word === '詳覆審') return '<span class="db-full-tag db-ft-rev"'+tip+'>詳覆審</span>';
    if(word === '無全文') return '<span class="db-full-tag db-ft-none"'+tip+'>無全文</span>';
    return '';
  }

  app.modules.caseListView = {fullWord: fullWord, fullTag: fullTag};
})(window);
