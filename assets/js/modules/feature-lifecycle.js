/* 功能生命週期：集中管理一次性初始化，避免頁籤模組重複掛載事件。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  var states = {};
  app.features = {
    init: function(name, fn){
      if(states[name]) return false;
      states[name] = true;
      try{ fn(); }
      catch(err){ states[name] = false; throw err; }
      return true;
    },
    ready: function(name){ return !!states[name]; },
    reset: function(name){ delete states[name]; }
  };
})(window);
