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
