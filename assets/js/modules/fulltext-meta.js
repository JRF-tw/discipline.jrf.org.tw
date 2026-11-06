/* 全文 dialog meta 區塊：補上案號／姓名、排序欄位並連結可跳轉案號。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.modules = app.modules || {};

  function create(body, escapeHtml, findXref){
    var fields = {'原決議':1, '覆審':1, '歷審決議':1};
    var shown = ['案號', '被付懲戒人', '決議日期', '原決議', '覆審', '歷審決議', '刑事確定判決'];
    var caseNoPattern = /\d+年度[^\s、，,；<]*?字第\d+號/g;

    function fillMetaHead(){
      var dl = body.querySelector('.meta'), h2 = body.querySelector('.doc h2');
      if(!dl || !h2) return;
      var source = [['被付懲戒人', '.pname'], ['案號', '.cn']];
      for(var i = 0; i < source.length; i++){
        if(dl.querySelector('[data-meta-head="' + source[i][0] + '"]')) continue;
        var node = h2.querySelector(source[i][1]);
        var text = node ? (node.textContent || '').trim() : '';
        if(!text) continue;
        var dt = document.createElement('dt');
        dt.textContent = source[i][0];
        dt.setAttribute('data-meta-head', source[i][0]);
        var dd = document.createElement('dd');
        dd.className = 'wide';
        dd.textContent = text;
        dl.insertBefore(dd, dl.firstChild);
        dl.insertBefore(dt, dl.firstChild);
      }
    }
    function reorderMeta(){
      var dl = body.querySelector('.meta');
      if(!dl) return;
      var dts = dl.querySelectorAll('dt'), pairs = [], i, j;
      for(i = 0; i < dts.length; i++){
        var dd = dts[i].nextElementSibling;
        if(dd && dd.tagName === 'DD') pairs.push({label:(dts[i].textContent || '').trim(), dt:dts[i], dd:dd});
      }
      var visible = [], rest = [];
      for(i = 0; i < shown.length; i++){
        for(j = 0; j < pairs.length; j++) if(pairs[j].label === shown[i]) visible.push(pairs[j]);
      }
      for(j = 0; j < pairs.length; j++) if(visible.indexOf(pairs[j]) < 0) rest.push(pairs[j]);
      function strip(node, add){
        var cls = (node.className || '').replace(/\bhide\b/g, ' ').replace(/\s+/g, ' ').trim();
        if(add && cls.indexOf(add) < 0) cls = (cls + ' ' + add).replace(/\s+/g, ' ').trim();
        node.className = cls;
      }
      visible.forEach(function(pair){ strip(pair.dt, ''); strip(pair.dd, 'wide'); });
      visible.forEach(function(pair){ dl.appendChild(pair.dt); dl.appendChild(pair.dd); });
      rest.forEach(function(pair){ dl.appendChild(pair.dt); dl.appendChild(pair.dd); });
    }
    function linkifyMeta(){
      var dts = body.querySelectorAll('.meta dt');
      for(var i = 0; i < dts.length; i++){
        var label = (dts[i].textContent || '').trim();
        if(!fields[label]) continue;
        var dd = dts[i].nextElementSibling;
        if(!dd || dd.tagName !== 'DD') continue;
        var changed = false;
        var html = dd.innerHTML.replace(caseNoPattern, function(value){
          var hit = findXref(value);
          if(!hit) return value;
          changed = true;
          return '<button type="button" class="full-xref db-ft-open" data-ft-slot="' + hit.slot +
            '" data-ft-i="' + hit.i + '" aria-label="在本頁閱讀決議書全文">' + escapeHtml(value) + '</button>';
        });
        if(changed) dd.innerHTML = html;
      }
    }
    return {fillMetaHead:fillMetaHead, reorderMeta:reorderMeta, linkifyMeta:linkifyMeta};
  }
  app.modules.fulltextMeta = {create:create};
})(window);
