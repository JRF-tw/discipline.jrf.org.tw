/* 全文 dialog 的事件委派：內容與路由狀態由主程式透過 callback 提供。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.modules = app.modules || {};
  app.modules.fulltextDialogEvents = {
    bind: function(options){
      var dialog = options.dialog;
      var open = options.open;
      var close = options.close;
      var getElement = options.getElement;
      var revealKey = 'discipline.criminalJudgmentsRevealed';
      // 分頁關閉前持續顯示，重新整理也保留；儲存受限時仍維持本次頁面的狀態。
      try{
        if(global.sessionStorage.getItem(revealKey) === '1'){
          getElement('ft-body').setAttribute('data-criminal-revealed', '');
        }
      }catch(ignore){}
      var deadline = 0, sequence = '', armedDoc = null;
      function resetReveal(){
        deadline = 0;
        sequence = '';
        armedDoc = null;
      }
      // 只接受彈窗內真正的空白；文字、連結和控制項都不啟動指令。
      function isBlankClick(e, body){
        var target = e.target;
        if(!body.contains(target) || target.closest('a,button,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="button"]')) return false;
        var walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        var range = document.createRange(), node;
        while((node = walker.nextNode())){
          if(!node.nodeValue.trim()) continue;
          range.selectNodeContents(node);
          var rects = range.getClientRects();
          for(var i = 0; i < rects.length; i++){
            var r = rects[i];
            if(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return false;
          }
        }
        return true;
      }
      dialog.addEventListener('click', function(e){
        resetReveal();
        var body = getElement('ft-body');
        if(!dialog.open || !body || !isBlankClick(e, body)) return;
        deadline = Date.now() + 5000;
        armedDoc = body.firstElementChild;
        body.focus({preventScroll:true});
      });
      document.addEventListener('keydown', function(e){
        var body = getElement('ft-body');
        if(!deadline) return;
        if(!dialog.open || Date.now() > deadline || !body || body.firstElementChild !== armedDoc ||
          !dialog.contains(e.target) || e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])') ||
          e.isComposing || e.keyCode === 229 || e.ctrlKey || e.altKey || e.metaKey || e.repeat){
          resetReveal();
          return;
        }
        if(e.key.length !== 1){ resetReveal(); return; }
        sequence += e.key.toLowerCase();
        if('unhide'.indexOf(sequence) !== 0){ resetReveal(); return; }
        // 取消指令按鍵的預設行為，避免 Firefox「隨打即找」搶走焦點。
        // 僅攔截空白處點擊後 5 秒內符合指令的字元。
        e.preventDefault();
        if(sequence === 'unhide'){
          body.setAttribute('data-criminal-revealed', '');
          try{ global.sessionStorage.setItem(revealKey, '1'); }catch(ignore){}
          resetReveal();
        }
      });
      dialog.addEventListener('close', resetReveal);
      document.addEventListener('click', function(e){
        var target = e.target;
        var button = target.closest ? target.closest('.db-ft-open') : null;
        if(button){
          e.preventDefault();
          var hit = button.getAttribute('data-ft-hit');
          open(button.getAttribute('data-ft-slot'), parseInt(button.getAttribute('data-ft-i'), 10),
            hit == null ? null : parseInt(hit, 10));
          return;
        }
        if(target === getElement('ft-x') || target === dialog) close();
      });
      dialog.addEventListener('close', options.onNativeClose);
    }
  };
})(window);
