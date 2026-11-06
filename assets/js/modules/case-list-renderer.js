/* 案件清單完整 renderer：表頭、資料列、摘要列與分頁。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.modules = app.modules || {};

  function create(options){
    options = options || {};
    var columns = options.columns || [];
    var pageSize = options.pageSize || 20;
    var pager = options.pager;
    var icons = options.groupIcons || {};

    return function render(ctx){
      ctx = ctx || {};
      var idxList = ctx.idxList || [], tableBox = ctx.tableBox;
      var pagerBoxes = Array.isArray(ctx.pagerBoxes) ? ctx.pagerBoxes : [ctx.pagerBoxes];
      var page = ctx.page || 1, onPage = ctx.onPage, sortCfg = ctx.sortCfg;
      var groupCfg = ctx.groupCfg, revVisible = ctx.revVisible !== false;
      var curPatId = ctx.curPatId || '', snip = ctx.snip;
      var deps = options.deps();
      var total = idxList.length, pages = Math.max(1, Math.ceil(total / pageSize));
      tableBox._dbTableSort = sortCfg || null;
      tableBox._dbTableGroup = groupCfg || null;
      deps.setPattern(curPatId);
      if(!tableBox._dbEventsBound){
        tableBox.addEventListener('click', function(e){
          var g = e.target.closest ? e.target.closest('button[data-grp]') : null;
          if(g && tableBox.contains(g)){
            var gc = tableBox._dbTableGroup;
            if(gc && gc.onGroup){ e.preventDefault(); e.stopPropagation(); gc.onGroup(g.getAttribute('data-grp')); }
            return;
          }
          var th = e.target.closest ? e.target.closest('th.db-th-sort') : null;
          var sc = tableBox._dbTableSort;
          if(th && tableBox.contains(th) && sc && sc.onSort) sc.onSort(th.getAttribute('data-sk'));
        });
        tableBox.addEventListener('keydown', function(e){
          if(e.key !== 'Enter' && e.key !== ' ') return;
          var th = e.target.closest ? e.target.closest('th.db-th-sort') : null;
          var sc = tableBox._dbTableSort;
          if(th && tableBox.contains(th) && sc && sc.onSort){ e.preventDefault(); sc.onSort(th.getAttribute('data-sk')); }
        });
        tableBox._dbEventsBound = true;
      }
      pagerBoxes.forEach(function(bx, bi){
        if(!bx) return;
        bx._dbPagerState = {pages:pages, page:page, onPage:onPage, bi:bi};
        if(bx._dbEventsBound) return;
        bx.addEventListener('click', function(e){
          var b = e.target.closest ? e.target.closest('button[data-p]') : null;
          var state = bx._dbPagerState;
          if(!b || !state || !bx.contains(b)) return;
          var p = parseInt(b.getAttribute('data-p'), 10);
          if(p >= 1 && p <= state.pages && p !== state.page) state.onPage(p, state.bi);
        });
        bx._dbEventsBound = true;
      });
      if(page > pages) page = pages;
      var ghost = pager ? pager.ghost() : '<nav class="db-pager" style="visibility:hidden" aria-hidden="true"><button type="button" disabled>▲</button></nav>';
      if(!total){
        tableBox.innerHTML = '<div class="db-table-scroll"><div class="db-no-result">查無符合條件之案件。</div></div>';
        tableBox.classList.toggle('db-rev-hidden', !revVisible);
        pagerBoxes.forEach(function(bx){ if(bx) bx.innerHTML = ghost; });
        return;
      }
      function thCell(label, key, tip){
        if(!sortCfg || !key) return '<th>'+label+'</th>';
        var on = sortCfg.key === key;
        var arr = on ? (sortCfg.asc ? '▲' : '▼') : '⇅';
        return '<th class="db-th-sort" data-sk="'+key+'" role="button" tabindex="0" title="點擊依「'+(tip||label)+'」排序" aria-sort="'+(on ? (sortCfg.asc ? 'ascending' : 'descending') : 'none')+'">'+label+'<span class="db-arr">'+arr+'</span></th>';
      }
      function grpBtn(kind, label){
        if(!groupCfg) return '';
        var on = groupCfg.active === kind;
        return '<button type="button" class="db-th-grp'+(on ? ' db-on' : '')+'" data-grp="'+kind+'" aria-pressed="'+(on ? 'true' : 'false')+'" data-ft-tip="'+label+'" aria-describedby="db-ft-tip" aria-label="'+label+'">'+((on && icons[kind+'On']) || icons[kind])+'</button>';
      }
      var colHtml = columns.map(function(c){ return '<col class="'+c.col+'">'; }).join('');
      var headHtml = columns.map(function(c){
        if(c.headSkip) return '';
        if(c.head > 1) return '<th colspan="'+c.head+'">'+c.label+'</th>';
        if(c.group){
          var gb = grpBtn(c.group, c.group === 'case' ? '檢索「一案多人」' : '檢索「一人多案」');
          if(c.group === 'name') return '<th class="db-th-name"><span class="db-th-lbl">'+c.label+'</span>'+gb+'</th>';
          return '<th class="db-th-1line">'+c.label+gb+'</th>';
        }
        return thCell(c.label, c.sort, c.tip);
      }).join('');
      var start = (page - 1) * pageSize, slice = idxList.slice(start, start + pageSize);
      var snipTerms = snip && snip.terms && snip.terms.length ? snip.terms : null;
      var snipRe = snipTerms ? deps.snipRegex(snipTerms) : null;
      var snipSpan = deps.snipSpan(revVisible), snipAny = false;
      var h = ['<div class="db-table-scroll"><table><colgroup>'+colHtml+'</colgroup><thead><tr>'+headHtml+'</tr></thead><tbody>'];
      slice.forEach(function(i, n){
        var c = deps.data.cases[i], zb = !!(snipTerms && (n % 2));
        var sr = snipTerms ? deps.snipRowHtml(i, snipTerms, snipRe, snipSpan, zb) : '';
        if(sr) snipAny = true;
        var rc = snipTerms ? ((sr ? 'db-snip-main' : '') + (zb ? ' db-zb' : '')).replace(/^\s+/, '') : '';
        h.push('<tr'+(rc ? ' class="'+rc+'"' : '')+'>'+columns.map(function(col){ return col.cell(c, i); }).join('')+'</tr>'+sr);
      });
      h.push('</tbody></table></div>');
      if(snipAny) h[0] = h[0].replace('<table>', '<table class="db-has-snip">');
      tableBox.innerHTML = h.join('');
      tableBox.classList.toggle('db-rev-hidden', !revVisible);
      if(snipRe) deps.snipMarkCells(tableBox, snipRe);
      deps.fitTableScroll();
      if(pages <= 1){ pagerBoxes.forEach(function(bx){ if(bx) bx.innerHTML = ghost; }); return; }
      var pageHtml = pager ? pager.html(pages, page) : '';
      pagerBoxes.forEach(function(bx){ if(bx) bx.innerHTML = pageHtml; });
    };
  }

  app.modules.caseListRenderer = { create: create };
})(window);
