/* 全文 dialog 外殼與生命週期：主程式只提供內容與路由 callback。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.modules = app.modules || {};
  app.modules.fulltextDialogController = {
    create: function(options){
      options = options || {};
      var dialog = document.createElement('dialog');
      dialog.id = options.id || 'ft-dlg';
      dialog.setAttribute('aria-modal', 'true');
      dialog.innerHTML = '<button type="button" id="ft-x" aria-label="關閉全文">×</button>' +
        '<div id="ft-body" tabindex="-1"></div>';
      document.body.appendChild(dialog);
      return { dialog: dialog, body: dialog.querySelector('#ft-body') };
    }
  };
})(window);
