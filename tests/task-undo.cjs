const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const saved=new Map();const ctx={console,Date,Math,setTimeout,clearTimeout,document:{addEventListener(){}},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)}};
 vm.createContext(ctx);
 for(const file of ['js/data.js','js/store.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
 ctx._initBuiltinTaskRegistry();return ctx;
}
test('new custom task undo retains a newer incomplete record and only deducts once',()=>{
 const c=setup(),added=c.addCustomTask('yuanyuan',{name:'新任务',desc:'测试',points:9,icon:'⭐',iconBg:'#ffffff'});
 assert.equal(added.success,true);const id=added.task.id;
 assert.equal(c.completeTask('yuanyuan',id,9,'新任务').success,true);
 const completed=c.getTodayCheckins('yuanyuan')[id],before=c.getChildState('yuanyuan').points;
 assert.equal(c.undoTask('yuanyuan',id,'新任务').success,true);
 const undone=c.getTodayCheckins('yuanyuan')[id];assert.ok(undone,'undo must leave a syncable record');
 assert.equal(undone.completed,false);assert.ok(undone.time>completed.time);
 assert.equal(c.getChildState('yuanyuan').points,before-9);
 assert.equal(c.undoTask('yuanyuan',id,'新任务').success,false);
 assert.equal(c.getChildState('yuanyuan').points,before-9);
 assert.equal(c.completeTask('yuanyuan',id,9,'新任务').success,true);
  assert.equal(c.isTaskDone('yuanyuan',id),true);
 assert.ok(c.getTodayCheckins('yuanyuan')[id].time>undone.time);
});
test('grade-goal undo also leaves an incomplete record for synchronization',()=>{
 const c=setup();assert.equal(c.completeGradeGoal('yuanyuan','top3').success,true);
 const completed=c.getTodayCheckins('yuanyuan')['grade-goal'];
 assert.equal(c.undoGradeGoal('yuanyuan').success,true);
 const undone=c.getTodayCheckins('yuanyuan')['grade-goal'];assert.ok(undone);
 assert.equal(undone.completed,false);assert.ok(undone.time>completed.time);
});
