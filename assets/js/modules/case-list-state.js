/* 案件清單狀態：與 DOM、資料及 renderer 分離，供案件清單模組共用。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.modules = app.modules || {};
  app.modules.caseList = app.modules.caseList || {};
  app.modules.caseList.createState = function(){
    return {src:'', artIdx:-1, sort:'no', asc:false, page:1, q:'', other:'', grp:'', kind:'disc'};
  };
})(window);
