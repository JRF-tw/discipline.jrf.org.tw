/* 應用程式共享 Context：模組只透過此命名空間交換服務與資料。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.version = app.version || 1;
  app.context = app.context || {};
  app.services = app.services || {};
  app.modules = app.modules || {};
})(window);
