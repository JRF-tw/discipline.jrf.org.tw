/* 案件清單搜尋語法：只處理查詢字串，不依賴 DOM 或案件資料。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.modules = app.modules || {};

  function normalize(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').toLowerCase(); }
  function tokenize(s){
    var out = [], buf = '';
    function flush(){ if(buf){ out.push({t:'w', v:buf}); buf = ''; } }
    for(var i = 0; i < s.length; i++){
      var ch = s.charAt(i);
      if(ch === '&' || ch === '+'){ flush(); out.push({t:'op', v:ch}); }
      else if(ch === '-'){
        var pc = s.charAt(i-1), nc = s.charAt(i+1);
        if(i > 0 && pc >= '0' && pc <= '9' && nc >= '0' && nc <= '9') buf += ch;
        else { flush(); out.push({t:'op', v:'-'}); }
      }else if(ch === '('){ flush(); out.push({t:'('}); }
      else if(ch === ')'){ flush(); out.push({t:')'}); }
      else if(/\s/.test(ch)){ flush(); out.push({t:'sp'}); }
      else buf += ch;
    }
    flush();
    var r = [];
    for(var k = 0; k < out.length; k++){
      if(out[k].t !== 'sp'){ r.push(out[k]); continue; }
      var a = r[r.length-1], b = null;
      for(var m = k+1; m < out.length; m++) if(out[m].t !== 'sp'){ b = out[m]; break; }
      if(a && b && (a.t === 'w' || a.t === ')') && (b.t === 'w' || b.t === '(')) r.push({t:'op', v:'&'});
    }
    return r;
  }
  function parse(toks){
    var p = 0;
    function primary(){
      var tk = toks[p];
      if(!tk || tk.t === 'op' || tk.t === ')') return null;
      if(tk.t === '('){
        p++;
        var e = expr();
        if(toks[p] && toks[p].t === ')') p++;
        return e;
      }
      p++;
      return {t:'w', v:tk.v};
    }
    function expr(){
      var node = null;
      while(p < toks.length){
        var tk = toks[p];
        if(tk.t === ')') break;
        if(tk.t === 'op'){
          var op = tk.v; p++;
          var rhs = primary();
          if(!rhs) continue;
          if(node === null) node = (op === '-') ? {t:'-', l:{t:'all'}, r:rhs} : rhs;
          else node = {t:op, l:node, r:rhs};
          continue;
        }
        var nd = primary();
        if(!nd){ p++; continue; }
        node = (node === null) ? nd : {t:'&', l:node, r:nd};
      }
      return node;
    }
    var root = expr();
    while(p < toks.length){
      if(toks[p].t === ')'){ p++; continue; }
      var more = expr();
      if(!more){ p++; continue; }
      root = root ? {t:'&', l:root, r:more} : more;
    }
    return root;
  }
  var cache = {s:null, ast:null};
  function ast(q){
    var s = normalize(q);
    if(cache.s === s) return cache.ast;
    cache.s = s;
    cache.ast = s ? parse(tokenize(s)) : null;
    return cache.ast;
  }
  function terms(node, out){
    out = out || [];
    if(!node) return out;
    if(node.t === 'w'){ if(out.indexOf(node.v) < 0) out.push(node.v); return out; }
    if(node.t === '-') return terms(node.l, out);
    if(node.l) terms(node.l, out);
    if(node.r) terms(node.r, out);
    return out;
  }
  app.modules.caseListSearch = {ast:ast, terms:terms};
})(window);
