/* 全文 renderer 的純資料工具：來源 metadata、網址網域與日期轉換。 */
(function(global){
  'use strict';
  var app = global.DisciplineApp = global.DisciplineApp || {};
  app.modules = app.modules || {};
  app.modules.fulltextRenderer = {
    sites: {
      'lawyerbc.moj.gov.tw': {name:'法務部查詢系統'},
      'gazette.nat.gov.tw':  {name:'行政院公報資訊網'},
      'www.twba.org.tw':     {name:'律師懲戒案例選集', paper:true}
    },
    agencies: ['臺灣律師懲戒委員會','律師懲戒委員會','律師懲戒覆審委員會'],
    join: function(value){
      if(!value) return null;
      return typeof value === 'string' ? value : value.join('\n');
    },
    host: function(value){
      var match = /^https?:\/\/([^\/?#]+)/i.exec(String(value || ''));
      return match ? match[1].toLowerCase() : '';
    },
    roc: function(iso){
      var match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(iso || ''));
      if(!match) return '';
      return '民國' + (+match[1] - 1911) + '年' + (+match[2]) + '月' + (+match[3]) + '日';
    },
    criminalDate: function(value){
      var match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ''));
      return match ? '民國' + (+match[1]) + '年' + (+match[2]) + '月' + (+match[3]) + '日' : '';
    }
  };
})(window);
