(function(root){
 'use strict';
 const key='neurovision.device.v2';let id;
 try{id=root.localStorage.getItem(key);if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id)){id=root.crypto.randomUUID();root.localStorage.setItem(key,id);}}
 catch(_){id=root.crypto.randomUUID();}
 root.NVStore={deviceId:()=>id};
})(window);
