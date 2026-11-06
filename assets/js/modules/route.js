/* 網站路由模組：頁籤使用網址路徑，篩選狀態使用 query string。 */
(function(global){
  'use strict';

  var TABS = {home:1, list:1, pattern:1, laws:1, stats:1, about:1, reform:1, complaint:1, ethichist:1};
  var TOLERANCE = 2;
  var holdUntil = 0, holding = false, released = false;

  function now(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function decodePart(s){ try{ return decodeURIComponent(s); }catch(e){ return s; } }
  function scrollToInstant(x, y){ window.scrollTo(x, y); }

  function legacyRoute(){
    var h = String(location.hash || '').replace(/^#/, '');
    if(!h) return null;
    var segs = decodePart(h).split('/'), head = String(segs.shift() || '').toLowerCase();
    if(!TABS[head]) return null;
    var parts = [], full = null;
    for(var i = 0; i < segs.length; i++){
      if(/^full=/i.test(segs[i])){ full = {no:segs[i].slice(5), name:segs[i + 1] || ''}; break; }
      if(segs[i]) parts.push(segs[i]);
    }
    return {tab:head, parts:parts, full:full, legacy:true};
  }

  function route(){
    var old = legacyRoute();
    if(old) return old;
    var segs = String(location.pathname || '/').split('/').filter(Boolean).map(decodePart);
    var head = String(segs.shift() || 'home').toLowerCase();
    if(!TABS[head]) return null;
    var parts = segs.slice(), params = new URLSearchParams(location.search || '');
    params.forEach(function(v, k){ if(k !== 'full' && k !== 'name') parts.push(k.toLowerCase() + '=' + v); });
    var fullNo = params.get('full');
    return {tab:head, parts:parts, full:fullNo ? {no:fullNo, name:params.get('name') || ''} : null};
  }
  function active(){ return !!route(); }
  function key(){ var r = route(); return r ? r.tab : null; }

  /* 預設定位到獨立網站的資料庫頁首；頁內目標由主程式提供。 */
  var targetFn = null;
  function target(fn){ targetFn = fn || null; }
  function targetY(){
    if(targetFn){
      var y = targetFn();
      return (y === null || y === undefined || isNaN(y)) ? null : Math.max(0, Math.round(y));
    }
    return 0;
  }
  function snap(){
    var y = targetY();
    if(y === null) return;
    if(Math.abs(window.pageYOffset - y) <= TOLERANCE) return;
    scrollToInstant(0, y);
  }
  function release(){ released = true; holdUntil = 0; }
  function resume(){ released = false; }
  function hold(ms){
    if(released) return;
    holdUntil = Math.max(holdUntil, now() + (ms || 0));
    if(holding) return;
    holding = true;
    (function step(){
      if(released){ holding = false; return; }
      snap();
      if(now() < holdUntil){
        if(window.requestAnimationFrame) window.requestAnimationFrame(step);
        else setTimeout(step, 16);
      }else holding = false;
    })();
  }

  ['wheel','touchstart','keydown','pointerdown','mousedown'].forEach(function(ev){
    window.addEventListener(ev, release, {passive:true});
  });
  global.DBROUTE = {
    active: active, key: key, route: route, snap: snap, hold: hold,
    resume: resume, release: release, target: target
  };
})(window);
