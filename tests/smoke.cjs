const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const hooks = new Map(), errors = [], warnings = [];
const moduleState = {};
const sandbox = {
  Hooks: {
    on(name, fn) { hooks.set(name,fn); },
    once(name, fn) { hooks.set(name,fn); }
  },
  game: { modules:new Map([["lipatos-instant-consumables",moduleState]]) },
  ui:{notifications:{
    error(v){errors.push(v);},
    warn(v){warnings.push(v);}
  }},
  console
};
vm.runInNewContext(fs.readFileSync("scripts/main.mjs","utf8"),sandbox);
hooks.get("ready")();
const api=moduleState.api, hook=hooks.get("dnd5e.preUseActivity");
assert.equal(typeof hook,"function");
assert.equal(typeof api.useItem,"function");
assert.equal(typeof api.canUse,"function");

const drain=()=>new Promise(resolve=>setImmediate(resolve));
let nextId=0;
function make({
  name="Обычный предмет",type="loot",quantity=4,max=0,spent=0,
  enabled=undefined,owner=true,posted=true
}={}) {
  const id="item-"+(++nextId);
  const calls={cards:0,updates:[],deleted:0};
  const actor={items:new Map()};
  const item={
    id,uuid:"Actor.test.Item."+id,name,actor,
    documentName:"Item",type,isOwner:owner,
    system:{uses:{max,spent},quantity},
    getFlag(){return enabled;},
    async displayCard(){
      calls.cards++;
      if(posted==="throw")throw Error("Chat failure");
      return posted ? {id:"card"} : undefined;
    },
    async update(change){
      calls.updates.push(change);
      if(Object.hasOwn(change,"system.uses.spent"))item.system.uses.spent=change["system.uses.spent"];
      if(Object.hasOwn(change,"system.quantity"))item.system.quantity=change["system.quantity"];
    },
    async delete(){calls.deleted++;actor.items.delete(id);}
  };
  actor.items.set(id,item);
  return {item,calls,activity:{item:{id,actor},actor,type:"utility"}};
}

async function run(){
  for(const type of ["consumable","loot","tool","weapon"]){
    const x=make({type,quantity:2});
    assert.equal(api.useItem(x.item),true,type+" menu command accepted");
    await drain();
    assert.equal(x.calls.cards,1,type+" card");
    assert.equal(x.item.system.quantity,1,type+" stack reduced");
    assert.equal(x.calls.deleted,0);
  }
  for(const type of ["equipment","container","backpack"]){
    const x=make({type,name:'Бочка пива "Последняя медь"',max:100,enabled:true});
    assert.equal(api.canUse(x.item),false,type+" explicitly excluded");
    assert.equal(api.useItem(x.item),false);
    assert.equal(hook(x.activity),undefined,type+" native behaviour preserved");
    await drain();
    assert.equal(x.calls.updates.length,0);
    assert.equal(x.calls.cards,0);
  }
  for(const type of ["feat","spell","class","subclass","race","background","facility"]){
    const x=make({type,max:10});
    assert.equal(api.canUse(x.item),false,type+" never delete actor build entries");
    assert.equal(api.useItem(x.item),false);
  }
  {
    const x=make({type:"consumable",name:"Potion",max:10,spent:4,quantity:1});
    assert.equal(hook(x.activity),false,"use consumes charge without dialog");
    await drain();
    assert.equal(x.item.system.uses.spent,5,"charge-first");
    assert.equal(x.item.system.quantity,1,"preserve charged item");
    assert.equal(x.calls.cards,1);
  }
  {
    const x=make({type:"weapon",name:"Dagger",quantity:1});
    x.activity.type="attack";
    assert.equal(hook(x.activity),undefined,"weapon attack not swallowed");
    assert.equal(api.useItem(x.item),true,"explicit inventory Use spends weapon");
    await drain();
    assert.equal(x.calls.deleted,1,"last physical item removed by Use");
  }
  {
    const x=make({type:"consumable",quantity:1});
    assert.equal(hook(x.activity),false);
    await drain();
    assert.equal(x.calls.deleted,1,"last stack item deleted");
  }
  {
    const x=make({type:"tool",max:2,spent:1,quantity:1});
    assert.equal(api.useItem(x.item),true);
    await drain();
    assert.equal(x.item.system.uses.spent,2,"last charge spent");
    assert.equal(x.calls.deleted,0,"empty rechargeable tool remains");
    assert.equal(api.useItem(x.item),true);
    await drain();
    assert.equal(x.calls.cards,1,"empty item never sent to chat again");
    assert.ok(warnings.length>0,"empty item warning");
  }
  {
    const x=make({type:"loot",quantity:10});
    assert.equal(api.useItem(x.item),true);
    assert.equal(api.useItem(x.item),true);
    await drain();
    assert.equal(x.calls.updates.length,1,"rapid double-use deduplicated");
  }
  {
    const x=make({type:"consumable",enabled:false});
    assert.equal(api.useItem(x.item),false,"explicit disable works");
  }
  {
    const x=make({type:"loot",posted:false});
    assert.equal(api.useItem(x.item),true);
    await drain();
    assert.equal(x.calls.updates.length,0,"cancelled card does not consume");
  }
  {
    const x=make({type:"loot",posted:"throw"});
    assert.equal(api.useItem(x.item),true);
    await drain();
    assert.equal(x.calls.updates.length,0,"failed card does not consume");
    assert.equal(errors.length,1);
  }
  {
    const x=make({type:"consumable",owner:false});
    assert.equal(api.useItem(x.item),false,"permission check");
  }
  console.log("Instant Consumables v1.3.0: all physical inventory categories, exclusions, charge-first, quantity, attacks, chat and pending guard passed.");
}
run().catch(error=>{console.error(error);process.exitCode=1;});
