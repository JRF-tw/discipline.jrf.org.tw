/* 案件清單分頁呈現：固定槽位，避免頁次切換造成版面跳動。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.modules = app.modules || {};
  function html(pages, page){
    var slots = [];
    if(pages <= 7){
      for(var p = 1; p <= pages; p++) slots.push(p);
    }else if(page <= 4){
      slots = [1,2,3,4,5,'gap',pages];
    }else if(page >= pages - 3){
      slots = [1,'gap',pages-4,pages-3,pages-2,pages-1,pages];
    }else{
      slots = [1,'gap',page-1,page,page+1,'gap2',pages];
    }
    var out = ['<nav class="db-pager" aria-label="頁次">'];
    out.push('<button type="button" data-p="'+(page-1)+'"'+(page===1?' disabled':'')+'>▲</button>');
    out.push('<span class="db-pg-nums">');
    slots.forEach(function(slot){
      if(typeof slot === 'string'){ out.push('<span class="db-gap">…</span>'); return; }
      out.push('<button type="button" data-p="'+slot+'"'+(slot===page?' class="db-cur" aria-current="page"':'')+'>'+slot+'</button>');
    });
    out.push('</span>');
    out.push('<button type="button" data-p="'+(page+1)+'"'+(page===pages?' disabled':'')+'>▼</button>');
    out.push('</nav>');
    return out.join('');
  }
  app.modules.caseListPager = {
    ghost: function(){ return '<nav class="db-pager" style="visibility:hidden" aria-hidden="true"><button type="button" disabled>▲</button></nav>'; },
    html: html
  };
})(window);
