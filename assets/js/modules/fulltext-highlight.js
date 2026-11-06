/* 全文命中反白與摘要定位：只操作傳入的全文容器。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.modules = app.modules || {};

  function create(body, getTerms){
    function clear(){
      var marks = body.querySelectorAll('mark.ft-hit');
      for(var i = 0; i < marks.length; i++){
        var mark = marks[i], parent = mark.parentNode;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      }
    }
    function apply(){
      clear();
      var terms = (typeof getTerms === 'function' ? getTerms() : []) || [];
      if(!terms.length || !body.firstChild) return;
      var re = new RegExp('(' + terms.map(function(term){
        return String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|') + ')', 'gi');
      var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
      var hits = [], node;
      while((node = walker.nextNode())){
        re.lastIndex = 0;
        if(node.nodeValue && re.test(node.nodeValue)) hits.push(node);
      }
      for(var i = 0; i < hits.length; i++){
        var textNode = hits[i], text = textNode.nodeValue;
        var fragment = document.createDocumentFragment(), last = 0, match;
        re.lastIndex = 0;
        while((match = re.exec(text))){
          if(!match[0]){ re.lastIndex++; continue; }
          if(match.index > last) fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
          var mark = document.createElement('mark');
          mark.className = 'ft-hit';
          mark.textContent = match[0];
          fragment.appendChild(mark);
          last = match.index + match[0].length;
        }
        if(last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
        textNode.parentNode.replaceChild(fragment, textNode);
      }
    }
    function goHit(index){
      if(index == null || isNaN(index)) return;
      var marks = body.querySelectorAll('.sec mark.ft-hit');
      if(!marks.length) return;
      var mark = marks[index] || marks[marks.length - 1];
      var current = body.querySelector('mark.ft-hit-cur');
      if(current) current.classList.remove('ft-hit-cur');
      mark.classList.add('ft-hit-cur');
      var top = mark.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      body.scrollTop = Math.max(0, top - body.clientHeight / 3);
    }
    return {clear:clear, apply:apply, goHit:goHit};
  }

  app.modules.fulltextHighlight = {create:create};
})(window);
