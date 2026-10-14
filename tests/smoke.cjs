const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let useHook;
const errors=[], warnings=[];
const sandbox={
  Hooks:{on(name,callback){if(name==="dnd5e.preUseActivity")useHook=callback;}},
  ui:{notifications:{
    error(value){errors.push(value);},
    warn(value){warnings.push(value);}
  }},
  console
};
vm.runInNewContext(fs.readFileSync("scripts/main.mjs","utf8"),sandbox);
assert.equal(typeof useHook,"function","D&D5e use hook installed");

const drain=()=>new Promise(resolve=>setImmediate(resolve));
let id=0;
function fixture({
  name="Вересковый закат",type="consumable",subtype="food",
  quantity=4,usesMax=0,spent=0,enabled=undefined,
  post=true,isOwner=true
}={}) {
  const uid=++id;
  const calls={cards:0,updates:[],deletes:0};
  const actor={items:new Map()};
  const item={
    id:"item-"+uid,uuid:"Actor.test.Item."+uid,
    name,type,actor,isOwner,
    system:{quantity,type:{value:subtype},uses:{max:usesMax,spent}},
    getFlag(module,name) {return enabled;},
    async displayCard() {
      calls.cards++;
      if(post==="throw")throw new Error("Chat failed");
      if(post===false)return undefined;
      return {id:"message-"+uid};
    },
    async update(changes) {
      calls.updates.push(changes);
      if(Object.hasOwn(changes,"system.uses.spent"))item.system.uses.spent=changes["system.uses.spent"];
      if(Object.hasOwn(changes,"system.quantity"))item.system.quantity=changes["system.quantity"];
    },
    async delete(){calls.deletes++; actor.items.delete(item.id);}
  };
  actor.items.set(item.id,item);
  // D&D5e clones activity.item before preUseActivity, but updates must target
  // the ORIGINAL embedded item from actor.items.
  const activity={actor,item:{id:item.id,actor,type,itemClone:true}};
  return {item,actor,activity,calls};
}

async function run() {
  {
    const x=fixture({name:'Бочка пива "Последняя медь"',type:"equipment",
                     subtype:"gear",quantity:1,usesMax:100,spent:45});
    assert.equal(useHook(x.activity),false,"beer barrel should bypass native charge prompt");
    await drain();
    assert.equal(x.calls.cards,1,"barrel must appear in chat exactly once");
    assert.equal(x.calls.updates.length,1);
    assert.equal(x.calls.updates[0]["system.uses.spent"],46,"spend one charge");
    assert.equal(x.calls.updates[0]["system.quantity"],undefined,"never delete charged barrel");
    assert.equal(x.item.system.quantity,1);
    assert.equal(x.calls.deletes,0);
  }
  {
    const x=fixture({name:"Бочка пива",type:"equipment",quantity:1,usesMax:100,spent:99});
    assert.equal(useHook(x.activity),false);
    await drain();
    assert.equal(x.item.system.uses.spent,100,"last charge is consumed");
    assert.equal(x.calls.deletes,0,"empty vessel must remain");
    assert.equal(x.item.system.quantity,1);
  }
  {
    const x=fixture({name:"Бочка пива",type:"equipment",quantity:1,usesMax:100,spent:100});
    assert.equal(useHook(x.activity),false);
    await drain();
    assert.equal(x.calls.cards,0,"empty barrel doesn't send a fake use card");
    assert.equal(x.calls.updates.length,0,"empty barrel cannot spend another charge");
    assert.equal(warnings.length,1,"notify of empty barrel");
  }
  {
    const x=fixture({quantity:4});
    assert.equal(useHook(x.activity),false);
    await drain();
    assert.equal(x.item.system.quantity,3,"un-charged food still consumes one quantity");
    assert.equal(x.calls.cards,1);
  }
  {
    const x=fixture({quantity:1});
    assert.equal(useHook(x.activity),false);
    await drain();
    assert.equal(x.calls.deletes,1,"last food unit removed");
  }
  {
    const x=fixture({name:"Сухой паёк",type:"consumable",subtype:"food",usesMax:3,spent:1,quantity:1});
    assert.equal(useHook(x.activity),false);
    await drain();
    assert.equal(x.item.system.uses.spent,2,"charged food uses charges before quantity");
    assert.equal(x.calls.deletes,0);
  }
  {
    const x=fixture({name:"Жезл огненных шаров",type:"equipment",subtype:"gear",usesMax:7});
    assert.equal(useHook(x.activity),undefined,"magic wand unchanged");
    await drain();
    assert.equal(x.calls.cards,0);
  }
  {
    const x=fixture({name:"Бочка с маслом",type:"equipment",subtype:"gear",usesMax:50});
    assert.equal(useHook(x.activity),undefined,"nonfood liquid not auto consumed");
  }
  {
    const x=fixture({name:"My Custom Ration",type:"equipment",subtype:"gear",usesMax:3,enabled:true});
    assert.equal(useHook(x.activity),false,"explicit opt in");
    await drain();
    assert.equal(x.item.system.uses.spent,1);
  }
  {
    const x=fixture({name:"Бочка пива",type:"equipment",usesMax:3,enabled:false});
    assert.equal(useHook(x.activity),undefined,"explicit opt out");
  }
  {
    const x=fixture({post:false});
    assert.equal(useHook(x.activity),false);
    await drain();
    assert.equal(x.calls.updates.length,0,"no charge or quantity spent if card suppressed");
  }
  {
    const x=fixture({post:"throw"});
    assert.equal(useHook(x.activity),false);
    await drain();
    assert.equal(x.calls.updates.length,0);
    assert.equal(errors.length,1);
  }
  {
    const x=fixture({name:"Бочка пива",type:"equipment",usesMax:100,quantity:1});
    assert.equal(useHook(x.activity),false);
    assert.equal(useHook(x.activity),false,"duplicate interaction swallowed");
    await drain();
    assert.equal(x.calls.cards,1,"duplicate click only one chat card");
    assert.equal(x.calls.updates.length,1,"duplicate click only one charge");
  }
  {
    const x=fixture({name:"Бочка пива",type:"equipment",usesMax:100,isOwner:false});
    assert.equal(useHook(x.activity),undefined,"unowned item remains untouched");
  }
  console.log("Instant Consumables v1.2.0: charged barrels, food quantity, chat, empty/no prompt, opt-in and race protection passed.");
}
run().catch(error=>{console.error(error);process.exitCode=1;});
