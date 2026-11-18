import {newPractice,practiceView,legalCommands,advancePractice,validatePracticeOrders} from "./practice-core.mjs";
let session=null;
self.onmessage=(message)=>{
  const {id,type,seed,topology,opponentPolicy,unitId,action,orders}=message.data??{};
  if(!Number.isSafeInteger(id))return;
  try{
    if(type==="START"){
      session=newPractice(seed,topology??"frontier127",opponentPolicy??"legacy-v1");
      self.postMessage({id,ok:true,state:practiceView(session)});
      return;
    }
    if(!session)throw new Error("Start a battle first");
    if(type==="SELECT"){
      self.postMessage({id,ok:true,
        legal:legalCommands(session,"A",unitId,orders?.move??null),
        state:practiceView(session)});
      return;
    }
    if(type==="PREVIEW"){
      const result=validatePracticeOrders(session,"A",orders);
      self.postMessage({id,ok:true,...result});
      return;
    }
    if(type==="ACTION"){
      const result=advancePractice(session,orders??action);
      self.postMessage({id,ok:true,...result});
      return;
    }
    if(type==="STATE"){
      self.postMessage({id,ok:true,state:practiceView(session)});
      return;
    }
    throw new Error("Unknown practice request");
  }catch(error){
    self.postMessage({id,ok:false,error:String(error?.message??error)});
  }
};