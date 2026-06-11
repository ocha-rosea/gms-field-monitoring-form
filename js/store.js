'use strict';
/* IndexedDB store for the GMS field monitoring records.
   Stores: projects (one per monitoring report), locations (Stage 3),
   generated (final Excel files with timestamps), meta (app settings).
   Binary fields (templateBytes, generated.bytes) are Uint8Array. */
(function(){
const DB_NAME='gmsfm', DB_VERSION=1;
let _db=null;

function open(){
  if(_db)return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('projects'))
        db.createObjectStore('projects',{keyPath:'projectKey'});
      if(!db.objectStoreNames.contains('locations')){
        const s=db.createObjectStore('locations',{keyPath:'id'});
        s.createIndex('byProject','projectKey');
      }
      if(!db.objectStoreNames.contains('generated')){
        const s=db.createObjectStore('generated',{keyPath:'id',autoIncrement:true});
        s.createIndex('byProject','projectKey');
      }
      if(!db.objectStoreNames.contains('meta'))
        db.createObjectStore('meta',{keyPath:'k'});
    };
    req.onsuccess=()=>{_db=req.result;res(_db);};
    req.onerror=()=>rej(req.error);
  });
}

// Transaction is created and the single request issued synchronously inside the
// same microtask, so the transaction never auto-closes across an await.
function readReq(store,method,arg,index){
  return open().then(db=>new Promise((res,rej)=>{
    const os=db.transaction(store,'readonly').objectStore(store);
    const src=index?os.index(index):os;
    const r=arg!==undefined?src[method](arg):src[method]();
    r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
  }));
}
function writeReq(store,method,arg){
  return open().then(db=>new Promise((res,rej)=>{
    const os=db.transaction(store,'readwrite').objectStore(store);
    const r=os[method](arg);
    r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
  }));
}
const byNewest=key=>(a,b)=>(b[key]||'').localeCompare(a[key]||'');

const Store={
  open,
  getProject(k){return readReq('projects','get',k);},
  putProject(p){p.updatedAt=new Date().toISOString();if(!p.createdAt)p.createdAt=p.updatedAt;return writeReq('projects','put',p).then(()=>p);},
  listProjects(){return readReq('projects','getAll').then(a=>a.sort(byNewest('updatedAt')));},
  deleteProject(k){
    return open().then(db=>new Promise((res,rej)=>{
      const t=db.transaction(['projects','locations','generated'],'readwrite');
      t.objectStore('projects').delete(k);
      ['locations','generated'].forEach(sn=>{
        const cur=t.objectStore(sn).index('byProject').openCursor(IDBKeyRange.only(k));
        cur.onsuccess=e=>{const c=e.target.result;if(c){c.delete();c.continue();}};
      });
      t.oncomplete=()=>res();t.onerror=()=>rej(t.error);
    }));
  },
  putLocation(l){l.updatedAt=new Date().toISOString();return writeReq('locations','put',l).then(()=>l);},
  listLocations(projectKey){return readReq('locations','getAll',projectKey,'byProject');},
  deleteLocation(id){return writeReq('locations','delete',id);},
  putGenerated(g){if(!g.generatedAt)g.generatedAt=new Date().toISOString();return writeReq('generated','put',g);},
  updateGenerated(g){return writeReq('generated','put',g);},
  listGenerated(projectKey){return readReq('generated','getAll',projectKey,'byProject').then(a=>a.sort(byNewest('generatedAt')));},
  getMeta(k){return readReq('meta','get',k).then(r=>r?r.v:undefined);},
  setMeta(k,v){return writeReq('meta','put',{k,v});},
  persist(){return (navigator.storage&&navigator.storage.persist)?navigator.storage.persist().catch(()=>false):Promise.resolve(false);},
  estimate(){return (navigator.storage&&navigator.storage.estimate)?navigator.storage.estimate().catch(()=>null):Promise.resolve(null);},

  // whole-database backup; binary fields base64-encoded into JSON
  exportAll(){
    return Promise.all([readReq('projects','getAll'),readReq('locations','getAll'),
      readReq('generated','getAll'),readReq('meta','getAll')])
      .then(([projects,locations,generated,meta])=>({
        app:'gms-field-monitoring-form', v:1, exportedAt:new Date().toISOString(),
        projects:projects.map(encBin), locations, generated:generated.map(encBin), meta}));
  },
  importAll(data){
    if(!data||!Array.isArray(data.projects))throw new Error('Not a valid backup file');
    return open().then(db=>new Promise((res,rej)=>{
      const t=db.transaction(['projects','locations','generated','meta'],'readwrite');
      (data.projects||[]).forEach(p=>t.objectStore('projects').put(decBin(p)));
      (data.locations||[]).forEach(l=>t.objectStore('locations').put(l));
      (data.generated||[]).forEach(g=>t.objectStore('generated').put(decBin(g)));
      (data.meta||[]).forEach(m=>t.objectStore('meta').put(m));
      t.oncomplete=()=>res();t.onerror=()=>rej(t.error);
    }));
  }
};

function u8ToB64(u8){let s='';const C=0x8000;for(let i=0;i<u8.length;i+=C)s+=String.fromCharCode.apply(null,u8.subarray(i,i+C));return btoa(s);}
function b64ToU8(b){const s=atob(b);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;}
function encBin(o){const c=Object.assign({},o);
  if(c.templateBytes instanceof Uint8Array)c.templateBytes={__b64:u8ToB64(c.templateBytes)};
  if(c.bytes instanceof Uint8Array)c.bytes={__b64:u8ToB64(c.bytes)};
  return c;}
function decBin(o){const c=Object.assign({},o);
  if(c.templateBytes&&c.templateBytes.__b64)c.templateBytes=b64ToU8(c.templateBytes.__b64);
  if(c.bytes&&c.bytes.__b64)c.bytes=b64ToU8(c.bytes.__b64);
  return c;}

window.Store=Store;
})();
