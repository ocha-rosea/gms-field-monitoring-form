'use strict';
/* ============================================================ zip ==== */
const CRC_T=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c}return t})();
function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRC_T[(c^u8[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
async function inflateRaw(u8){const ds=new DecompressionStream('deflate-raw');return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer())}
async function deflateRaw(u8){const cs=new CompressionStream('deflate-raw');return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer())}

function readZip(buf){
  const u8=new Uint8Array(buf), dv=new DataView(buf);
  let eocd=-1;
  for(let i=u8.length-22;i>=Math.max(0,u8.length-22-65536);i--){
    if(u8[i]===0x50&&u8[i+1]===0x4B&&u8[i+2]===0x05&&u8[i+3]===0x06){eocd=i;break}}
  if(eocd<0)throw new Error('Not a valid .xlsx (zip) file');
  const count=dv.getUint16(eocd+10,true), cdOff=dv.getUint32(eocd+16,true);
  const entries=[]; let p=cdOff;
  const td=new TextDecoder();
  for(let n=0;n<count;n++){
    if(dv.getUint32(p,true)!==0x02014b50)throw new Error('Bad central directory');
    const e={
      flag:dv.getUint16(p+8,true), method:dv.getUint16(p+10,true),
      time:dv.getUint16(p+12,true), date:dv.getUint16(p+14,true),
      crc:dv.getUint32(p+16,true), csize:dv.getUint32(p+20,true), usize:dv.getUint32(p+24,true),
      lho:dv.getUint32(p+42,true)};
    const nlen=dv.getUint16(p+28,true), elen=dv.getUint16(p+30,true), clen=dv.getUint16(p+32,true);
    e.name=td.decode(u8.subarray(p+46,p+46+nlen));
    p+=46+nlen+elen+clen;
    const lnlen=dv.getUint16(e.lho+26,true), lelen=dv.getUint16(e.lho+28,true);
    e.dataOff=e.lho+30+lnlen+lelen;
    entries.push(e);
  }
  return {
    u8, entries,
    raw(name){const e=entries.find(x=>x.name===name);return e?u8.subarray(e.dataOff,e.dataOff+e.csize):null},
    async get(name){const e=entries.find(x=>x.name===name);if(!e)return null;
      const raw=u8.subarray(e.dataOff,e.dataOff+e.csize);
      return e.method===0?raw.slice():await inflateRaw(raw)},
    async getText(name){const b=await this.get(name);return b?new TextDecoder().decode(b):null}
  };
}
async function writeZip(zip, replacements){ // replacements: Map name -> string|Uint8Array
  const te=new TextEncoder(), parts=[], central=[]; let off=0;
  const w16=v=>{const b=new Uint8Array(2);new DataView(b.buffer).setUint16(0,v,true);return b};
  const w32=v=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,v>>>0,true);return b};
  for(const e of zip.entries){
    let method=e.method, crc=e.crc, csize=e.csize, usize=e.usize, data;
    if(replacements.has(e.name)){
      let raw=replacements.get(e.name); if(typeof raw==='string')raw=te.encode(raw);
      data=await deflateRaw(raw); method=8; crc=crc32(raw); csize=data.length; usize=raw.length;
    }else data=zip.u8.subarray(e.dataOff,e.dataOff+e.csize);
    const name=te.encode(e.name), flag=(e.flag&0x0800); // keep utf8 bit, clear bit3
    const lh=[w32(0x04034b50),w16(20),w16(flag),w16(method),w16(e.time),w16(e.date),w32(crc),w32(csize),w32(usize),w16(name.length),w16(0),name];
    central.push({e,flag,method,crc,csize,usize,name,off});
    for(const x of lh){parts.push(x);off+=x.length}
    parts.push(data);off+=data.length;
  }
  const cdStart=off;
  for(const c of central){
    const cd=[w32(0x02014b50),w16(20),w16(20),w16(c.flag),w16(c.method),w16(c.e.time),w16(c.e.date),w32(c.crc),w32(c.csize),w32(c.usize),w16(c.name.length),w16(0),w16(0),w16(0),w16(0),w32(0),w32(c.off),c.name];
    for(const x of cd){parts.push(x);off+=x.length}
  }
  parts.push(w32(0x06054b50),w16(0),w16(0),w16(central.length),w16(central.length),w32(off-cdStart),w32(cdStart),w16(0));
  return new Blob(parts,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

/* ============================================================ xlsx parse ==== */
function decXml(s){return s.replace(/&#x([0-9a-fA-F]+);/g,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(+d)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')}
function encXml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function colToN(c){let n=0;for(const ch of c)n=n*26+ch.charCodeAt(0)-64;return n}
function splitRef(ref){const m=ref.match(/^([A-Z]+)(\d+)$/);return {col:m[1],colN:colToN(m[1]),row:+m[2]}}

const WB={}; // global workbook model
let CURPROJ=null, CURLOC=null; // current project + location records (IndexedDB)
const pad2=n=>String(n).padStart(2,'0');
function toAB(u8){return (u8.byteOffset===0&&u8.byteLength===u8.buffer.byteLength)?u8.buffer:u8.buffer.slice(u8.byteOffset,u8.byteOffset+u8.byteLength);}
function newId(){return crypto.randomUUID?crypto.randomUUID():(String(Date.now())+'-'+Math.round(Math.random()*1e9));}
async function hashBytes(u8){
  try{const h=await crypto.subtle.digest('SHA-256',u8);
    return Array.from(new Uint8Array(h).slice(0,6)).map(b=>b.toString(16).padStart(2,'0')).join('');}
  catch(e){let h=2166136261;for(let i=0;i<u8.length;i++){h^=u8[i];h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
}
async function parseXlsx(buf, fname){
  const zip=readZip(buf);
  const wbXml=await zip.getText('xl/workbook.xml');
  const relsXml=await zip.getText('xl/_rels/workbook.xml.rels');
  const rels={};
  for(const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g))rels[m[1]]=m[2];
  for(const m of relsXml.matchAll(/<Relationship[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g))rels[m[2]]=rels[m[2]]||m[1];
  const sheets=[]; // {name, file}
  for(const m of wbXml.matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="(rId\d+)"[^>]*\/>/g)){
    let t=rels[m[2]]; if(t&&!t.startsWith('xl/'))t='xl/'+t.replace(/^\//,'');
    sheets.push({name:decXml(m[1]),file:t});
  }
  const defined={};
  for(const m of wbXml.matchAll(/<definedName name="([^"]+)"[^>]*>([^<]+)<\/definedName>/g)){
    const nm=m[1]; if(nm.startsWith('_xlnm'))continue;
    const r=decXml(m[2]).match(/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)/);
    if(r)defined[nm]={sheet:r[1],ref:r[2]+r[3]};
  }
  const ssXml=await zip.getText('xl/sharedStrings.xml')||'';
  const shared=[];
  for(const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)){
    let t='';for(const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))t+=decXml(tm[1]);
    shared.push(t);
  }
  const sheetData={}; // name -> {cells:{ref:{v,formula,s}}, rows:[rownums], dvs:[{ranges,options,type}], xml}
  for(const sh of sheets){
    const xml=await zip.getText(sh.file);
    const cells={}, rows=[];
    for(const rm of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)){
      rows.push(+rm[1]);
      for(const cm of rm[2].matchAll(/<c r="([A-Z]+\d+)"((?:[^>]*?))(?:\/>|>([\s\S]*?)<\/c>)/g)){
        const attrs=cm[2]||'', body=cm[3]||'';
        const t=(attrs.match(/ t="(\w+)"/)||[])[1];
        const s=(attrs.match(/ s="(\d+)"/)||[])[1];
        let v=null;
        const vm=body.match(/<v>([\s\S]*?)<\/v>/);
        if(t==='inlineStr'){let txt='';for(const tm of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))txt+=decXml(tm[1]);v=txt}
        else if(vm){v=t==='s'?shared[+vm[1]]:decXml(vm[1])}
        cells[cm[1]]={v,formula:/<f[ >\/]/.test(body),s};
      }
    }
    const dvs=[];
    for(const dm of xml.matchAll(/<dataValidation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/dataValidation>)/g)){
      const a=dm[1], body=dm[2]||'';
      const sqref=(a.match(/sqref="([^"]+)"/)||[])[1]; if(!sqref)continue;
      const type=(a.match(/type="(\w+)"/)||[])[1]||'';
      let options=null;
      const f1=body.match(/<formula1>([\s\S]*?)<\/formula1>/);
      if(type==='list'&&f1){
        const f=decXml(f1[1]).trim();
        if(/^".*"$/s.test(f))options=f.slice(1,-1).split(',').map(s=>s.trim()).filter(Boolean);
      }
      const ranges=sqref.split(' ').map(r=>{
        const p=r.split(':'), a1=splitRef(p[0]), a2=splitRef(p[1]||p[0]);
        return {c1:a1.colN,r1:a1.row,c2:a2.colN,r2:a2.row};
      });
      dvs.push({ranges,options,type});
    }
    sheetData[sh.name]={cells,rows,dvs,file:sh.file};
  }
  Object.assign(WB,{zip,fname,sheets,defined,sheetData});
}
function cellV(sheet,ref){const sd=WB.sheetData[sheet];const c=sd&&sd.cells[ref];let v=c?c.v:null;
  if(v==null)return '';v=String(v).trim();return /^\[insert\]$/i.test(v)?'':v}
function namedV(n){const d=WB.defined[n];return d?cellV(d.sheet,d.ref):''}
function dvFor(sheet,ref){const sd=WB.sheetData[sheet];if(!sd)return null;const {colN,row}=splitRef(ref);
  for(const dv of sd.dvs)for(const r of dv.ranges)
    if(colN>=r.c1&&colN<=r.c2&&row>=r.r1&&row<=r.r2)return dv;
  return null}

/* ============================================================ catalog ==== */
const YN=['Yes','No'];
/* Mandatory fields — must be filled before moving to the next tab */
const REQUIRED=new Set([
  'fld_monitoringType','fld_monitoringStartDate','fld_monitoringEndDate',
  'fld_visitCountry','fld_visitLocation','fld_visitDate','fld_monLeadType',
  'fld_visitJustification','fld_hasPreviousMonitoring',
  'fld_pi_timeline_score','fld_pi_timelines_comment',
  'fld_pi_progress_score','fld_pi_progress_comment',
  'fld_pi_quality_score','fld_pi_quality_comment',
  'fld_pi_synergies_score','fld_pi_synergies_comment',
  'fld_pi_relevance_score','fld_pi_relevance_comment',
  'fld_pi_satisfaction_score','fld_pi_satisfaction_comment',
  'fld_qp_311_score','fld_qp_311_comment','fld_qp_312_score','fld_qp_312_comment',
  'fld_qp_313_score','fld_qp_313_comment','fld_qp_321_score','fld_qp_321_comment',
  'fld_qp_322_score','fld_qp_322_comment','fld_qp_331_score','fld_qp_331_comment',
  'fld_qp_341_score','fld_qp_341_comment','fld_qp_342_score','fld_qp_342_comment',
  'fld_qp_351_score','fld_qp_351_comment','fld_qp_352_score','fld_qp_352_comment',
  'fld_mon_hasMonActivities','fld_mon_mrPlanFollowed','fld_mon_standardizedForms',
  'fld_mon_overall_score','fld_mon_overall_comment',
  'fld_oa_finding_1','fld_oa_rec_1','fld_oa_rec_1_responsible','fld_oa_narrative',
  'fld_preparedBy_name_1','fld_preparedBy_function_1','fld_preparedBy_contact_1',
]);
const SCORE_HELP='Score 0 to 4 (decimals allowed). See rubric below.';
function F(n,l,type,extra){return Object.assign({n,l,type:type||'text'},extra||{})}
const CATALOG=[
 {id:'s1',title:'1. General',groups:[
  {h:'1.1 Monitoring details',fields:[
    F('fld_monitoringType','Monitoring type','select',{o:['Internal Monitoring','Third Party','Peer to Peer','Ad hoc']}),
    F('fld_monitoringStartDate','Monitoring start date','date'),
    F('fld_monitoringEndDate','Monitoring end date','date'),
    F('fld_reportingPeriodStart','Reporting period start','date'),
    F('fld_reportingPeriodEnd','Reporting period end','date'),
    F('fld_organizationName','Name of partner (visited)','text',{pre:1}),
    F('fld_partnerRiskLevel','Partner risk level','select',{o:['High','Medium','Low'],pre:1}),
  ]},
  {h:'1.1.5 Project location visited',fields:[
    F('fld_visitCountry','Country','select'),
    F('fld_visitLocation','Location name'),
    F('fld_visitGps','GPS data (if available)'),
    F('fld_visitDate','Date(s) of visit','daterange'),
  ]},
  {h:'1.1.6 Monitoring members',fields:[
    F('fld_monLeadType','Monitoring lead','select'),
    F('fld_monCoLeadType','Co-lead','select'),
    F('fld_monJointSpecify','If Joint or Other, specify'),
  ]},
  {h:'Monitoring team',desc:'Members participating in the visit.',table:'participants'},
  {h:'1.1.7 Justification for visit',fields:[
    F('fld_visitJustification','Justification','textarea',{ph:'Regular mid-term/final per M&E workplan, or ad hoc'}),
  ]},
  {h:'1.2 Project information',desc:'Pre-filled from GMS and locked. If anything here is wrong, correct it in OneGMS and export the template again.',fields:[
    F('fld_chfProjectCode','Project number','text',{pre:1}),
    F('fld_projectTitle','Project title','textarea',{pre:1}),
    F('fld_projectLocations','Project location(s)','textarea',{pre:1}),
    F('fld_projectDuration','Project duration','text',{pre:1}),
    F('fld_actualStartDate','Project start date','date',{pre:1}),
    F('fld_actualEndDate','Project end date (per contract)','date',{pre:1}),
    F('fld_hasRevisions','Programme/budget revision/NCE','select',{o:YN,pre:1}),
    F('fld_budget','Total budget (US$)','number',{pre:1}),
    F('fld_totalDisbursed','Disbursement to date (US$)','number',{pre:1}),
    F('fld_totalExpenditure','Reported expenditures (US$)','number',{pre:1}),
    F('fld_finReportEndDate','Expenditures as of','date',{pre:1}),
  ]},
  {h:'1.2.11 Sub-partners (optional)',table:'subgrantees'},
  {h:'1.3 Previous monitoring',fields:[
    F('fld_hasPreviousMonitoring','Monitoring conducted previously?','select',{o:YN}),
    F('fld_prevMonType_1','Previous monitoring 1: type','select',{o:['Internal Monitoring','Third party','Peer to Peer','Remote monitoring','Financial Spot Check','Ad hoc','Other']}),
    F('fld_prevMonLocation_1','Previous monitoring 1: location'),
    F('fld_prevMonDate_1','Previous monitoring 1: date','date'),
    F('fld_prevMonType_2','Previous monitoring 2: type','select',{o:['Internal Monitoring','Third party','Peer to Peer','Remote monitoring','Financial Spot Check','Ad hoc','Other']}),
    F('fld_prevMonLocation_2','Previous monitoring 2: location'),
    F('fld_prevMonDate_2','Previous monitoring 2: date','date'),
    F('fld_prevMonType_3','Previous monitoring 3: type','select',{o:['Internal Monitoring','Third party','Peer to Peer','Remote monitoring','Financial Spot Check','Ad hoc','Other']}),
    F('fld_prevMonLocation_3','Previous monitoring 3: location'),
    F('fld_prevMonDate_3','Previous monitoring 3: date','date'),
    F('fld_prevMonTypeSpec','If "Other", specify'),
    F('fld_summaryFindings','Summary of key findings from previous monitoring','textarea'),
  ]},
 ]},
 {id:'s2',title:'2. Implementation',groups:[
  {h:'2.1.1 Verification of reported results',desc:'Verify progress of outputs, activities and indicators at the location visited.',table:'indicators'},
  {h:'Activities: status observed',desc:'Status scale: 5 = completed (100%) · 4 = near completion (80%) · 3 = partial, modest delays (50%) · 2 = initiated but significantly delayed (20%) · 1 = not initiated/cancelled (0%).',table:'activities'},
  {h:'2.1.2 Timeliness',fields:[
    F('fld_pi_timeline_score','Timeliness score','score'),
    F('fld_pi_delay_a','Delay reason: access problems (security, restricted movement)','select',{o:YN}),
    F('fld_pi_delay_b','Delay reason: late transfer of funding','select',{o:YN}),
    F('fld_pi_delay_c','Delay reason: internal administrative issues','select',{o:YN}),
    F('fld_pi_delay_d','Delay reason: procurement or transportation issues','select',{o:YN}),
    F('fld_pi_delay_e','Delay reason: staffing/recruitment issues','select',{o:YN}),
    F('fld_pi_delay_f','Delay reason: delay in securing supplies from pipeline','select',{o:YN}),
    F('fld_pi_delay_g','Delay reason: other (list in comments)','select',{o:YN}),
    F('fld_pi_timelines_comment','Comments on progress and delays','textarea'),
  ]},
  {h:'2.1.3 Implementation progress vs targets',fields:[
    F('fld_pi_progress_score','Progress score','score'),
    F('fld_pi_progress_comment','Justification for the score','textarea'),
  ]},
  {h:'2.2 Adherence to minimum quality standards',fields:[
    F('fld_pi_quality_score','Quality standards score','score'),
    F('fld_pi_quality_comment','Justification for the score','textarea'),
  ]},
  {h:'2.3 Project synergies',fields:[
    F('fld_pi_synergies_score','Synergies & coordination score','score'),
    F('fld_pi_synergies_comment','Level of synergy and coordination with other actors','textarea'),
  ]},
  {h:'2.4.1 Relevance and appropriateness',fields:[
    F('fld_pi_relevance_score','Relevance score','score'),
    F('fld_pi_relevance_comment','Is the project still relevant and necessary?','textarea'),
  ]},
  {h:'2.4.2 Satisfaction of assisted people',fields:[
    F('fld_pi_satisfaction_score','Satisfaction score','score'),
    F('fld_pi_satisfaction_comment','Key points from interviews (incl. number and profile of interviewees)','textarea'),
  ]},
 ]},
 {id:'s3',title:'3. Quality',groups:[
  {h:'3.1 Accountability to Affected People (AAP)',fields:[
    F('fld_qp_311_score','3.1.1 Participation of affected people in design & implementation','score'),
    F('fld_qp_311_comment','Evidence of participation','textarea'),
    F('fld_qp_312_score','3.1.2 Information sharing with assisted people','score'),
    F('fld_qp_312_comment','Evidence of information sharing','textarea'),
    F('fld_qp_313_score','3.1.3 Complaint & feedback mechanisms in place','score'),
    F('fld_qp_313_comment','Evidence','textarea'),
  ]},
  {h:'3.2 Protection from Sexual Exploitation and Abuse (PSEA)',fields:[
    F('fld_qp_321_score','3.2.1 Staff: zero tolerance, training, reporting channels','score'),
    F('fld_qp_321_comment','Evidence','textarea'),
    F('fld_qp_322_score','3.2.2 Assisted people: awareness & safe access to reporting','score'),
    F('fld_qp_322_comment','Evidence','textarea'),
  ]},
  {h:'3.3 Protection',fields:[
    F('fld_qp_331_score','3.3.1 Protection-oriented response','score'),
    F('fld_qp_331_comment','Evidence','textarea'),
  ]},
  {h:'3.4 Women & girls',fields:[
    F('fld_qp_341_score','3.4.1 Women and girls equality programming','score'),
    F('fld_qp_341_comment','Evidence','textarea'),
    F('fld_qp_342_score','3.4.2 Violence against women & girls: prevention, mitigation, response','score'),
    F('fld_qp_342_comment','Evidence','textarea'),
  ]},
  {h:'3.5 Persons with disability',fields:[
    F('fld_qp_351_score','3.5.1 Inclusion & reduction of barriers','score'),
    F('fld_qp_351_comment','Evidence','textarea'),
    F('fld_qp_352_score','3.5.2 Response to specific needs identified','score'),
    F('fld_qp_352_comment','Evidence','textarea'),
  ]},
 ]},
 {id:'s4',title:'4. M&R',groups:[
  {h:'4.1 Partner monitoring of implementation',fields:[
    F('fld_mon_hasMonActivities','Does the partner conduct self/external monitoring?','select',{o:YN}),
  ]},
  {h:'Monitoring mechanisms used',desc:'For each mechanism: whether conducted, details/dates, and whether a report is available.',table:'mechanisms'},
  {h:'4.2 M&R plan application',fields:[
    F('fld_mon_mrPlanFollowed','Is the M&R plan applied per proposal and workplan?','select',{o:['Yes','No','Partially']}),
    F('fld_mon_mrPlan_comment','If No or Partially, specify','textarea'),
  ]},
  {h:'4.3 Standardized reporting tools',fields:[
    F('fld_mon_standardizedForms','Standardized tools/forms used for disaggregated beneficiary reporting?','select',{o:YN}),
  ]},
  {h:'4.4 Overall assessment of the M&R set-up',fields:[
    F('fld_mon_overall_score','M&R set-up score','score'),
    F('fld_mon_overall_comment','Justification for the score','textarea'),
  ]},
 ]},
 {id:'s5',title:'5. Assessment',groups:[
  {h:'5.1.2 Key monitoring findings',fields:[
    F('fld_oa_finding_1','Finding 1','textarea'),F('fld_oa_finding_2','Finding 2','textarea'),
    F('fld_oa_finding_3','Finding 3','textarea'),F('fld_oa_finding_4','Finding 4','textarea'),
    F('fld_oa_finding_5','Finding 5','textarea'),
  ]},
  {h:'5.1.3 Key recommendations',desc:'Red-flag findings are for internal use and trigger compliance measures.',fields:[
    F('fld_oa_rec_1','Recommendation 1','textarea'),
    F('fld_oa_rec_1_redFlag','Rec 1: red flag?','select',{o:YN}),
    F('fld_oa_rec_1_responsible','Rec 1: responsible actor','select'),
    F('fld_oa_rec_1_timeline','Rec 1: timeline for implementation'),
    F('fld_oa_rec_2','Recommendation 2','textarea'),
    F('fld_oa_rec_2_redFlag','Rec 2: red flag?','select',{o:YN}),
    F('fld_oa_rec_2_responsible','Rec 2: responsible actor','select'),
    F('fld_oa_rec_2_timeline','Rec 2: timeline'),
    F('fld_oa_rec_3','Recommendation 3','textarea'),
    F('fld_oa_rec_3_redFlag','Rec 3: red flag?','select',{o:YN}),
    F('fld_oa_rec_3_responsible','Rec 3: responsible actor','select'),
    F('fld_oa_rec_3_timeline','Rec 3: timeline'),
    F('fld_oa_rec_4','Recommendation 4','textarea'),
    F('fld_oa_rec_4_redFlag','Rec 4: red flag?','select',{o:YN}),
    F('fld_oa_rec_4_responsible','Rec 4: responsible actor','select'),
    F('fld_oa_rec_4_timeline','Rec 4: timeline'),
    F('fld_oa_rec_5','Recommendation 5','textarea'),
    F('fld_oa_rec_5_redFlag','Rec 5: red flag?','select',{o:YN}),
    F('fld_oa_rec_5_responsible','Rec 5: responsible actor','select'),
    F('fld_oa_rec_5_timeline','Rec 5: timeline'),
  ]},
  {h:'5.1.4 Contribution to allocation priorities',fields:[
    F('fld_oa_narrative','Summary of how the project contributed to the corresponding allocation priorities','textarea'),
  ]},
  {h:'5.2 Practices and lessons observed',fields:[
    F('fld_oa_visibility','Key lessons learned and good practices from the monitored project','textarea'),
  ]},
  {h:'5.3 Visibility of CBPF-funded projects',desc:'Weblinks to public posts/articles showing fund visibility.',fields:[
    F('fld_oa_viz_title_1','Item 1: title'),F('fld_oa_viz_link_1','Item 1: weblink'),
    F('fld_oa_viz_title_2','Item 2: title'),F('fld_oa_viz_link_2','Item 2: weblink'),
    F('fld_oa_viz_title_3','Item 3: title'),F('fld_oa_viz_link_3','Item 3: weblink'),
    F('fld_oa_viz_title_4','Item 4: title'),F('fld_oa_viz_link_4','Item 4: weblink'),
  ]},
  {h:'5.4 Final comments by the implementing partner',fields:[
    F('fld_oa_partnerComments','Partner comments','textarea'),
  ]},
  {h:'5.5 Persons met',fields:[
    F('fld_met_name_1','Person 1: name'),F('fld_met_function_1','Person 1: function'),
    F('fld_met_relation_1','Person 1: relation to project'),F('fld_met_contact_1','Person 1: contact'),
    F('fld_met_name_2','Person 2: name'),F('fld_met_function_2','Person 2: function'),
    F('fld_met_relation_2','Person 2: relation to project'),F('fld_met_contact_2','Person 2: contact'),
    F('fld_met_name_3','Person 3: name'),F('fld_met_function_3','Person 3: function'),
    F('fld_met_relation_3','Person 3: relation to project'),F('fld_met_contact_3','Person 3: contact'),
    F('fld_met_name_4','Person 4: name'),F('fld_met_function_4','Person 4: function'),
    F('fld_met_relation_4','Person 4: relation to project'),F('fld_met_contact_4','Person 4: contact'),
  ]},
  {h:'Additional documents attached',fields:[
    F('fld_doc_type_1','Document 1: type'),F('fld_doc_desc_1','Document 1: description'),
    F('fld_doc_type_2','Document 2: type'),F('fld_doc_desc_2','Document 2: description'),
    F('fld_doc_type_3','Document 3: type'),F('fld_doc_desc_3','Document 3: description'),
    F('fld_doc_type_4','Document 4: type'),F('fld_doc_desc_4','Document 4: description'),
  ]},
  {h:'Report prepared by',fields:[
    F('fld_preparedBy_name_1','Prepared by 1: name'),F('fld_preparedBy_function_1','Prepared by 1: function'),
    F('fld_preparedBy_contact_1','Prepared by 1: contact'),
    F('fld_preparedBy_name_2','Prepared by 2: name'),F('fld_preparedBy_function_2','Prepared by 2: function'),
    F('fld_preparedBy_contact_2','Prepared by 2: contact'),
  ]},
 ]},
];

/* ============================================================ model ==== */
// state: key -> string. key = field name, or "cell|<sheet>|<ref>"
let state={}, inputsIndex=[]; // {key, sheet, ref, type, label, origDisplay}
const DATE_RE=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
function toISO(s){const m=String(s).trim().match(DATE_RE);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''}
function toDMY(iso){const m=String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:String(iso)}

function origValueFor(it){ // value in file, converted to input representation
  let v=cellV(it.sheet,it.ref);
  if(it.type==='date'){const iso=toISO(v);return iso||v}
  return v;
}
function scanRows(sheet, fromRow, stopFn, maxRows){
  const out=[];const sd=WB.sheetData[sheet];if(!sd)return out;
  for(let r=fromRow;r<fromRow+(maxRows||40);r++){
    if(stopFn(r))break; out.push(r);
  }
  return out;
}
function buildTables(){
  const T={};
  // participants (sheet 1)
  let d=WB.defined['fld_participantAnchor'];
  if(d){const sheet=d.sheet, row0=splitRef(d.ref).row;
    const rows=scanRows(sheet,row0,r=>r>row0&&cellV(sheet,'A'+r)!=='' ,6);
    T.participants={sheet,cols:[['B','Name'],['C','Title'],['D','Organization'],['E','Email'],['F','Phone']],rows};}
  // sub-grantees
  d=WB.defined['fld_subGranteeAnchor'];
  if(d){const sheet=d.sheet, row0=splitRef(d.ref).row;
    const rows=scanRows(sheet,row0,r=>r>row0&&cellV(sheet,'A'+r)!=='',5);
    T.subgrantees={sheet,cols:[['C','Sub-partner name'],['D','Budget amount (US$)','number']],rows};}
  // indicators + activities (sheet 2): scan between cluster anchor and section 2.1.2
  d=WB.defined['fld_clusterAnchor'];
  if(d){const sheet=d.sheet, row0=splitRef(d.ref).row, sd=WB.sheetData[sheet];
    const ind=[], act=[]; let context='';
    const maxRow=Math.max(...sd.rows);
    for(let r=row0;r<=maxRow;r++){
      const a=cellV(sheet,'A'+r), b=cellV(sheet,'B'+r);
      if(/^2\.1\.2/.test(a)||/^2\.1\.2/.test(b))break;
      if(/^(Outcome|Output)\s*\d/i.test(b)){context=b}
      else if(/^Indicator\s*\d/i.test(b))ind.push({row:r,desc:b,ctx:context,tgt:cellV(sheet,'C'+r),rep:cellV(sheet,'D'+r)});
      else if(/^Activity\s*\d/i.test(b))act.push({row:r,desc:b,ctx:context});
    }
    T.indicators={sheet,items:ind};T.activities={sheet,items:act};
    T.cluster=cellV(sheet,d.ref);}
  // M&R mechanisms
  const mechs=[['projectReporting','Project reporting'],['fieldVisit','Field visit / third-party monitoring'],
   ['survey','Survey (initial-final)'],['assessment','Assessment (initial-final)'],['focusGroup','Focus group discussion'],
   ['interview','Individual interview'],['dataCollection','Data collection / verification'],
   ['posDistrib','Post-distribution monitoring (SMS, call centre)'],['satellite','Satellite images'],['others','Others (please specify)']];
  T.mechanisms=mechs.filter(([k])=>WB.defined['fld_mon_'+k]).map(([k,label])=>({key:k,label,
    conducted:'fld_mon_'+k, details:'fld_mon_'+k+'_date', avail:'fld_mon_'+k+'_avail'}));
  return T;
}

/* ============================================================ render ==== */
const $=s=>document.querySelector(s);
function el(tag,attrs,html){const e=document.createElement(tag);if(attrs)for(const k in attrs)e.setAttribute(k,attrs[k]);if(html!=null)e.innerHTML=html;return e}

let RCTX={si:0,gi:0}; // section/step context during render
function registerInput(container,{key,sheet,ref,type,label,options,ph,pre,rubric}){
  const orig=cellV(sheet,ref);
  const req=REQUIRED.has(key);
  const it={key,sheet,ref,type,label,orig,req,si:RCTX.si,gi:RCTX.gi};
  inputsIndex.push(it);
  const wrap=el('div',{class:'fld'+(req?' req':'')});
  it.wrap=wrap;
  const penHint=type==='textarea'?'<span class="penhint" title="On a stylus device, write here by hand and your device converts it to text">&#9998;</span>':'';
  const lab=el('label',null,encXml(label)+penHint+(pre?'<span class="pre">pre-filled from GMS</span>':''));
  wrap.appendChild(lab);
  let input;
  const cur=key in state?state[key]:origValueFor(it);
  if(type==='daterange'){
    // two date pickers writing one "DD/MM/YYYY - DD/MM/YYYY" text cell
    const m=String(cur).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4}))?/);
    const iso=(d,mo,y)=>y+'-'+mo.padStart(2,'0')+'-'+d.padStart(2,'0');
    const d1=el('input',{type:'date'}), d2=el('input',{type:'date'});
    if(m){d1.value=iso(m[1],m[2],m[3]);if(m[4])d2.value=iso(m[4],m[5],m[6])}
    const paint=()=>{d1.classList.toggle('filled',!!d1.value);d2.classList.toggle('filled',!!d2.value)};
    const upd=()=>{
      const v1=d1.value?toDMY(d1.value):'', v2=d2.value?toDMY(d2.value):'';
      state[key]=v1&&v2?v1+' - '+v2:(v1||v2);
      wrap.classList.remove('err');paint();onStateChange();
    };
    d1.addEventListener('input',upd);d2.addEventListener('input',upd);paint();
    const cols=el('div',{class:'cols'});
    const w1=el('div',{class:'fld sub'},'<label>First day</label>'), w2=el('div',{class:'fld sub'},'<label>Last day</label>');
    w1.appendChild(d1);w2.appendChild(d2);cols.appendChild(w1);cols.appendChild(w2);
    wrap.appendChild(cols);
    container.appendChild(wrap);
    return it;
  }
  if(type==='select'){
    input=el('select');
    input.appendChild(el('option',{value:''},'Select…'));
    let opts=options;
    if(!opts){const dv=dvFor(sheet,ref);opts=dv&&dv.options||[]}
    const seen=new Set();
    for(const o of opts){input.appendChild(el('option',{value:o},encXml(o)));seen.add(o)}
    if(cur&&!seen.has(cur))input.appendChild(el('option',{value:cur},encXml(cur)));
    input.value=cur;
  }else if(type==='textarea'){
    input=el('textarea');input.value=cur;if(ph)input.placeholder=ph;
  }else{
    const t=type==='score'?'number':(type==='number'?'number':type==='date'?'date':'text');
    input=el('input',{type:t});
    if(type==='score'){input.min=0;input.max=4;input.step='0.05';input.classList.add('num')}
    if(ph)input.placeholder=ph;
    input.value=cur;
  }
  input.dataset.key=key;
  if(pre){ // GMS pre-filled fields are locked; corrections belong in OneGMS before export
    if(input.tagName==='SELECT')input.disabled=true;else input.readOnly=true;
    input.classList.add('ro');
  }else{
    input.addEventListener('input',()=>{state[key]=input.value;wrap.classList.remove('err');input.classList.toggle('filled',input.value!=='');onStateChange()});
    input.classList.toggle('filled',String(cur)!=='');
  }
  if(type==='score'&&rubric!==false){
    const row=el('div',{class:'score-row'});
    row.appendChild(input);
    const rub=rubricText(sheet,ref);
    if(rub){const det=el('details',null,'<summary>Scoring rubric</summary>');det.appendChild(el('pre',null,encXml(rub)));row.appendChild(det)}
    wrap.appendChild(row);
  }else wrap.appendChild(input);
  container.appendChild(wrap);
  return it;
}
function rubricText(sheet,ref){
  const {row}=splitRef(ref);
  for(const col of ['B','C']){const t=cellV(sheet,col+row);if(/Point/i.test(t))return t}
  return '';
}
function cellKey(sheet,ref){return 'cell|'+sheet+'|'+ref}

function renderTable(container,tbl,kind){
  if(kind==='participants'||kind==='subgrantees'){
    for(const r of tbl.rows){
      const card=el('div',{class:'tbl-card'});
      const rowLab=kind==='subgrantees'?(cellV(tbl.sheet,'B'+r)||'Sub-partner'):'Member '+(r-tbl.rows[0]+1);
      card.appendChild(el('div',{class:'ttl'},encXml(rowLab.replace(/:$/,''))));
      const cols=el('div',{class:'cols'});
      for(const [c,label,type] of tbl.cols){
        const ref=c+r;
        const sub=el('div',{class:'fld'});
        cols.appendChild(sub);
        registerInput(sub,{key:cellKey(tbl.sheet,ref),sheet:tbl.sheet,ref,type:type||'text',label});
      }
      card.appendChild(cols);container.appendChild(card);
    }
  }
  if(kind==='indicators'){
    if(tbl.items.length===0){container.appendChild(el('p',{class:'desc'},'No indicator rows found in this template.'));return}
    let lastCtx='';
    for(const it of tbl.items){
      if(it.ctx&&it.ctx!==lastCtx){container.appendChild(el('h4',{style:'margin:14px 0 2px;color:var(--blue-deep)'},encXml(it.ctx)));lastCtx=it.ctx}
      const card=el('div',{class:'tbl-card'});
      card.appendChild(el('div',{class:'ttl'},encXml(it.desc)));
      card.appendChild(el('div',{class:'meta'},'Overall target: <b>'+encXml(it.tgt||'n/a')+'</b> &nbsp;·&nbsp; Reported to date: <b>'+encXml(it.rep||'n/a')+'</b>'));
      const cols=el('div',{class:'cols'});
      for(const [c,label] of [['E','Target at location visited'],['F','Achieved at location visited'],['G','Comment']]){
        const ref=c+it.row, sub=el('div',{class:'fld'});cols.appendChild(sub);
        registerInput(sub,{key:cellKey(tbl.sheet,ref),sheet:tbl.sheet,ref,type:c==='G'?'text':'number',label});
      }
      card.appendChild(cols);container.appendChild(card);
    }
  }
  if(kind==='activities'){
    if(tbl.items.length===0){container.appendChild(el('p',{class:'desc'},'No activity rows found in this template.'));return}
    for(const it of tbl.items){
      const card=el('div',{class:'tbl-card'});
      card.appendChild(el('div',{class:'ttl'},encXml(it.desc)));
      const cols=el('div',{class:'cols'});
      let sub=el('div',{class:'fld'});cols.appendChild(sub);
      registerInput(sub,{key:cellKey(tbl.sheet,'C'+it.row),sheet:tbl.sheet,ref:'C'+it.row,type:'select',label:'Status'});
      sub=el('div',{class:'fld'});cols.appendChild(sub);
      registerInput(sub,{key:cellKey(tbl.sheet,'D'+it.row),sheet:tbl.sheet,ref:'D'+it.row,type:'textarea',label:'Comments on progress'});
      card.appendChild(cols);container.appendChild(card);
    }
  }
  if(kind==='mechanisms'){
    for(const m of tbl){
      const card=el('div',{class:'tbl-card'});
      card.appendChild(el('div',{class:'ttl'},encXml(m.label)));
      const cols=el('div',{class:'cols'});
      const defs=[[m.conducted,'Conducted?','select',YN],[m.details,'Specify (dates/details)','text',null],[m.avail,'Report available?','select',YN]];
      for(const [name,label,type,o] of defs){
        const d=WB.defined[name];if(!d)continue;
        const sub=el('div',{class:'fld'});cols.appendChild(sub);
        registerInput(sub,{key:name,sheet:d.sheet,ref:d.ref,type,label,options:o});
      }
      card.appendChild(cols);container.appendChild(card);
    }
  }
}

let TABLES=null, CUR=0;
const stepPos={}, visited={};
function isFilled(it){const v=it.key in state?state[it.key]:origValueFor(it);return String(v).trim()!==''}
function missingRequired(si){return inputsIndex.filter(it=>it.req&&(si==null||it.si===si)&&!isFilled(it))}
function stepMissing(si,gi){return inputsIndex.filter(it=>it.req&&it.si===si&&it.gi===gi&&!isFilled(it))}

function renderForm(){
  inputsIndex=[];
  TABLES=buildTables();
  const tabs=$('#tabs'),main=$('#form');
  tabs.innerHTML='';main.innerHTML='';
  for(const k in stepPos)delete stepPos[k];
  for(const k in visited)delete visited[k];
  CATALOG.forEach((sec,i)=>{
    const b=el('button',{id:'tabbtn-'+i},encXml(sec.title));
    b.addEventListener('click',()=>showTab(i));
    tabs.appendChild(b);
    const panel=el('section',{id:'panel-'+i,class:i?'hidden':''});
    if(sec.id==='s2'&&TABLES.cluster)
      panel.appendChild(el('div',{class:'notice info',style:'margin:10px 0 0'},'Cluster: <b>'+encXml(TABLES.cluster)+'</b>'));
    const stepbar=el('div',{class:'stepbar'});
    stepbar.appendChild(el('div',{class:'dots'}));
    stepbar.appendChild(el('div',{class:'where'}));
    panel.appendChild(stepbar);
    sec.groups.forEach((g,gi)=>{
      RCTX={si:i,gi};
      const step=el('div',{class:'step'+(gi?' hidden':'')});
      const box=el('div',{class:'group'});
      box.appendChild(el('h3',null,encXml(g.h)));
      if(g.desc)box.appendChild(el('p',{class:'desc'},encXml(g.desc)));
      if(g.fields)for(const f of g.fields){
        const d=WB.defined[f.n];if(!d)continue;
        registerInput(box,{key:f.n,sheet:d.sheet,ref:d.ref,type:f.type,label:f.l,options:f.o,ph:f.ph,pre:f.pre});
      }
      if(g.table){
        if(g.table==='mechanisms')renderTable(box,TABLES.mechanisms,'mechanisms');
        else if(TABLES[g.table])renderTable(box,TABLES[g.table],g.table);
      }
      step.appendChild(box);
      const nav=el('div',{class:'stepnav'});
      const back=el('button',{class:'btn ghost'},'&#9666; Back');
      if(i===0&&gi===0)back.disabled=true;
      back.addEventListener('click',()=>{
        if(gi>0)showStep(i,gi-1);
        else if(i>0){activateTab(i-1);showStep(i-1,CATALOG[i-1].groups.length-1)}
      });
      const lastStep=gi===sec.groups.length-1, lastSec=i===CATALOG.length-1;
      const next=el('button',{class:'btn'},lastStep?(lastSec?'Finish &#10003;':'Next section &#9656;'):'Next &#9656;');
      next.addEventListener('click',()=>{
        const miss=stepMissing(i,gi);
        if(miss.length){flagMissing(i,miss);return}
        if(!lastStep)showStep(i,gi+1);
        else if(!lastSec)showTab(i+1);
        else{
          const missAll=missingRequired();
          if(missAll.length)flagMissing(missAll[0].si,missingRequired(missAll[0].si));
          else notice('ok','All mandatory fields are complete. Generate the Excel with the button below.');
        }
      });
      nav.appendChild(back);nav.appendChild(next);
      step.appendChild(nav);
      panel.appendChild(step);
    });
    main.appendChild(panel);
  });
  CUR=0;
  activateTab(0);showStep(0,0);
  $('#landing').classList.add('hidden');
  $('#records').classList.add('hidden');
  $('#project').classList.add('hidden');
  $('#btnNew').textContent=(CURPROJ&&CURPROJ.mode==='multi')?'Back to locations':'All reports';
  tabs.classList.remove('hidden');main.classList.remove('hidden');
  $('#storagebadge').classList.remove('hidden');
  try{if(!localStorage.getItem('gmsfm:pentipDismissed'))$('#pentip').classList.remove('hidden');}catch(e){}
  $('#topbar').classList.remove('hidden');
  // in multi mode, the final Excel is generated only from the consolidation, not per location
  $('#btnGen').classList.toggle('hidden', !!(CURPROJ&&CURPROJ.mode==='multi'&&!(CURLOC&&CURLOC.consolidated)));
  $('#chips').classList.remove('hidden');$('#hdractions').classList.remove('hidden');
  const chips=$('#chips');chips.innerHTML='';
  for(const [lab,val] of [['Project',namedV('fld_chfProjectCode')],['Partner',namedV('fld_organizationName')],
      ['Country',namedV('fld_visitCountry')],['Score at export',namedV('fld_totalScore')&&(+namedV('fld_totalScore')).toFixed(1)]])
    if(val)chips.appendChild(el('span',{class:'chip'},'<b>'+encXml(lab)+':</b> '+encXml(String(val))));
  $('#hdrsub').textContent=WB.fname;
  onStateChange();
}
function activateTab(i){
  CUR=i;
  document.querySelectorAll('#tabs button').forEach((b,j)=>b.classList.toggle('on',i===j));
  document.querySelectorAll('main section').forEach((p,j)=>p.classList.toggle('hidden',i!==j));
}
function showTab(i){
  if(i>CUR){ // moving forward: all earlier sections must have mandatory fields complete
    for(let s=0;s<i;s++){
      const miss=missingRequired(s);
      if(miss.length){flagMissing(s,miss);return}
    }
  }
  activateTab(i);
  showStep(i,stepPos[i]||0);
}
function flagMissing(si,miss){
  miss.forEach(it=>it.wrap&&it.wrap.classList.add('err'));
  activateTab(si);
  showStep(si,miss[0].gi);
  notice('warn','Please complete <b>'+miss.length+'</b> mandatory field(s) in &ldquo;'+encXml(CATALOG[si].title)+'&rdquo; before continuing.');
  setTimeout(()=>miss[0].wrap&&miss[0].wrap.scrollIntoView({behavior:'smooth',block:'center'}),80);
}
function showStep(si,gi){
  stepPos[si]=gi;(visited[si]=visited[si]||new Set()).add(gi);
  const panel=document.getElementById('panel-'+si);if(!panel)return;
  panel.querySelectorAll(':scope > .step').forEach((st,j)=>st.classList.toggle('hidden',j!==gi));
  updateStepper(si);
  window.scrollTo({top:0});
}
function updateStepper(si){
  const panel=document.getElementById('panel-'+si);if(!panel)return;
  const dots=panel.querySelector('.dots'),where=panel.querySelector('.where');
  const n=CATALOG[si].groups.length,cur=stepPos[si]||0;
  if(dots.children.length!==n){dots.innerHTML='';
    for(let j=0;j<n;j++){const d=el('button',{type:'button',title:CATALOG[si].groups[j].h},String(j+1));
      d.addEventListener('click',()=>{
        const from=stepPos[si]||0;
        if(j>from)for(let k=from;k<j;k++){ // forward jump: every step on the way must be complete
          const miss=stepMissing(si,k);
          if(miss.length){flagMissing(si,miss);return}
        }
        showStep(si,j);
      });dots.appendChild(d)}}
  Array.from(dots.children).forEach((d,j)=>{
    const reqs=inputsIndex.filter(it=>it.si===si&&it.gi===j&&it.req);
    const miss=reqs.filter(it=>!isFilled(it));
    let cls=j===cur?'cur':'';
    if(reqs.length&&!miss.length)cls+=' good';
    else if(miss.length&&visited[si]&&visited[si].has(j)&&j!==cur)cls+=' bad';
    d.className=cls.trim();
  });
  where.textContent='Step '+(cur+1)+' of '+n+': '+CATALOG[si].groups[cur].h;
}
function notice(cls,html,sticky){
  const n=el('div',{class:'notice '+cls},html);
  $('#notices').appendChild(n);
  if(!sticky)setTimeout(()=>n.remove(),9000);
  return n;
}

/* ============================================================ drafts ==== */
function draftKey(){return 'gmsfm:'+WB.fname}
let saveTimer=null;
function onStateChange(){
  // progress
  let total=0,done=0;
  for(const it of inputsIndex){total++;if(isFilled(it))done++}
  const missAll=missingRequired();
  $('#progfill').style.width=(total?Math.round(done/total*100):0)+'%';
  $('#progtxt').innerHTML=done+' / '+total+' fields filled'+
    (missAll.length?' &middot; <span class="req">'+missAll.length+' mandatory remaining</span>'
                   :' &middot; <span style="color:var(--green)">all mandatory complete &#10003;</span>');
  // tab badges
  CATALOG.forEach((sec,i)=>{
    const b=document.getElementById('tabbtn-'+i);if(!b)return;
    const reqs=inputsIndex.filter(it=>it.si===i&&it.req);
    const miss=reqs.filter(it=>!isFilled(it));
    b.innerHTML=encXml(sec.title)+(reqs.length?(miss.length?' <span class="todo">'+miss.length+'</span>':' <span class="ok">&#10003;</span>'):'');
    b.classList.toggle('on',i===CUR);
  });
  const gen=$('#btnGen');
  gen.disabled=missAll.length>0;
  gen.title=missAll.length?'Complete all mandatory fields to enable ('+missAll.length+' remaining)':'Generate the filled Excel for upload to OneGMS';
  updateStepper(CUR);
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    const t=$('#sbTime'),b=$('#sbBtn');
    if(!CURLOC)return;
    const ok=()=>{if(t&&Object.keys(state).length){t.textContent='saved on this device '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});b.classList.remove('warn');}};
    const fail=()=>{if(t){t.textContent='could not save on this device. Use Export draft to keep your work';b.classList.add('warn');}};
    if(CURLOC.consolidated){if(CURPROJ){CURPROJ.consolidationState=state;Store.putProject(CURPROJ).then(ok).catch(fail);}return;}
    CURLOC.formState=state;
    CURLOC.status=missAll.length?'draft':'complete';
    Store.putLocation(CURLOC).then(()=>{
      if(CURPROJ&&CURPROJ.status!=='generated'&&CURPROJ.status!=='uploaded'){CURPROJ.status=CURLOC.status;Store.putProject(CURPROJ);}
      ok();
    }).catch(fail);
  },400);
}

/* ============================================================ generate ==== */
function escT(s){return encXml(String(s).replace(/\r\n?/g,'\n'))}
function setCellInXml(xml,ref,val,numeric){
  const {colN,row}=splitRef(ref);
  const cellRe=new RegExp('<c r="'+ref+'"[^>]*?(?:/>|>[\\s\\S]*?</c>)');
  const m=xml.match(cellRe);
  const sAttr=m?((m[0].match(/ s="\d+"/)||[''])[0]):'';
  let cell;
  if(String(val).trim()===''){cell='<c r="'+ref+'"'+sAttr+'/>'}
  else if(numeric){cell='<c r="'+ref+'"'+sAttr+'><v>'+val+'</v></c>'}
  else{cell='<c r="'+ref+'"'+sAttr+' t="inlineStr"><is><t xml:space="preserve">'+escT(val)+'</t></is></c>'}
  if(m)return xml.replace(cellRe,cell);
  // cell missing: find/insert row
  const rowOpenRe=new RegExp('<row r="'+row+'"([^>]*?)(/?)>');
  const rm=xml.match(rowOpenRe);
  if(rm){
    if(rm[2]==='/') return xml.replace(rowOpenRe,'<row r="'+row+'"$1>'+cell+'</row>');
    const start=xml.indexOf(rm[0])+rm[0].length;
    const end=xml.indexOf('</row>',start);
    const body=xml.slice(start,end);
    let insertAt=body.length;
    for(const cm of body.matchAll(/<c r="([A-Z]+)(\d+)"/g)){
      if(colToN(cm[1])>colN){insertAt=cm.index;break}
    }
    return xml.slice(0,start+insertAt)+cell+xml.slice(start+insertAt);
  }
  // row missing
  const rowXml='<row r="'+row+'">'+cell+'</row>';
  for(const rm2 of xml.matchAll(/<row r="(\d+)"/g)){
    if(+rm2[1]>row)return xml.slice(0,rm2.index)+rowXml+xml.slice(rm2.index);
  }
  return xml.replace('</sheetData>',rowXml+'</sheetData>');
}
function ensureFullCalc(wbXml){
  if(/fullCalcOnLoad=/.test(wbXml))return wbXml;
  if(/<calcPr\b/.test(wbXml))return wbXml.replace(/<calcPr\b/,'<calcPr fullCalcOnLoad="1"');
  if(/<\/definedNames>/.test(wbXml))return wbXml.replace('</definedNames>','</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/>');
  return wbXml.replace('</sheets>','</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/>');
}
function collectEdits(){
  const edits=[]; // {sheet, ref, val, numeric}
  for(const it of inputsIndex){
    if(!(it.key in state))continue;
    let v=String(state[it.key]);
    if(it.type==='date'&&v)v=toDMY(v);
    const orig=it.orig||'';
    if(v===orig)continue;
    if(v===''&&orig==='')continue;
    const numeric=(it.type==='number'||it.type==='score')&&/^-?\d+(\.\d+)?$/.test(v.trim());
    edits.push({sheet:it.sheet,ref:it.ref,val:numeric?v.trim():v,numeric});
  }
  return edits;
}
async function generate(){
  const missAll=missingRequired();
  if(missAll.length){
    const list=missAll.slice(0,12).map(m=>'• '+m.label).join('\n');
    if(!confirm(missAll.length+' mandatory field(s) are still empty:\n\n'+list+(missAll.length>12?'\n…':'')+'\n\nGenerate the Excel anyway?'))return;
  }
  const edits=collectEdits();
  const bySheet={};
  for(const e of edits)(bySheet[e.sheet]=bySheet[e.sheet]||[]).push(e);
  const repl=new Map();
  for(const sheet in bySheet){
    const file=WB.sheetData[sheet].file;
    let xml=await WB.zip.getText(file);
    for(const e of bySheet[sheet])xml=setCellInXml(xml,e.ref,e.val,e.numeric);
    repl.set(file,xml);
  }
  let wbXml=await WB.zip.getText('xl/workbook.xml');
  repl.set('xl/workbook.xml',ensureFullCalc(wbXml));
  const blob=await writeZip(WB.zip,repl);
  const d=new Date();
  const ts=''+d.getFullYear()+pad2(d.getMonth()+1)+pad2(d.getDate())+'-'+pad2(d.getHours())+pad2(d.getMinutes());
  const filename=(WB.fname||'Monitoring').replace(/\.xlsx$/i,'')+'_final-'+ts+'.xlsx';
  if(CURPROJ){
    try{
      const bytes=new Uint8Array(await blob.arrayBuffer());
      await Store.putGenerated({projectKey:CURPROJ.projectKey,filename,bytes,generatedAt:d.toISOString()});
      CURPROJ.status='generated';await Store.putProject(CURPROJ);
    }catch(e){console.error(e);}
  }
  const a=el('a',{href:URL.createObjectURL(blob),download:filename});
  document.body.appendChild(a);a.click();a.remove();
  notice('ok','<b>'+edits.length+' field(s) written.</b> Saved to your records as <b>'+encXml(filename)+'</b>. Open it once in Excel to refresh the score formulas, then upload to OneGMS.');
  return blob;
}

/* ============================================================ records + wiring ==== */
async function loadFile(file){
  try{
    const buf=await file.arrayBuffer();
    await parseXlsx(buf,file.name);
    if(!Object.keys(WB.defined).some(n=>n.startsWith('fld_'))){
      notice('warn','This workbook has no GMS <code>fld_*</code> named ranges, so it does not look like a OneGMS monitoring template export.',true);return;
    }
    const templateBytes=new Uint8Array(buf);
    const code=namedV('fld_chfProjectCode')||file.name.replace(/\.xlsx$/i,'');
    const projectKey=code+'|'+(await hashBytes(templateBytes));
    let proj=await Store.getProject(projectKey);
    const mode=(document.querySelector('input[name=repmode]:checked')||{}).value||'single';
    if(!proj){
      proj={projectKey,projectCode:namedV('fld_chfProjectCode')||'',partner:namedV('fld_organizationName')||'',
        country:namedV('fld_visitCountry')||'',filename:file.name,templateBytes,mode,status:'draft'};
      await Store.putProject(proj);
    }
    CURPROJ=proj;
    if(proj.mode==='multi'){CURLOC=null;await enterProjectView();return;}
    const locs=await Store.listLocations(projectKey);
    if(locs[0]){CURLOC=locs[0];notice('info','Reopened a saved report. Your earlier entries were restored.');}
    else{CURLOC={id:newId(),projectKey,locationName:namedV('fld_visitLocation')||'',formState:{},status:'draft'};await Store.putLocation(CURLOC);}
    state=Object.assign({},CURLOC.formState||{});
    renderForm();
  }catch(err){notice('warn','Could not read file: '+encXml(err.message),true);console.error(err)}
}
async function openProject(projectKey){
  try{
    const proj=await Store.getProject(projectKey);
    if(!proj){notice('warn','Report not found.');return;}
    await parseXlsx(toAB(proj.templateBytes),proj.filename||'template.xlsx');
    CURPROJ=proj;
    if(proj.mode==='multi'){CURLOC=null;await enterProjectView();return;}
    const locs=await Store.listLocations(projectKey);
    CURLOC=locs[0]||{id:newId(),projectKey,locationName:'',formState:{},status:'draft'};
    if(!locs[0])await Store.putLocation(CURLOC);
    state=Object.assign({},CURLOC.formState||{});
    renderForm();
  }catch(err){notice('warn','Could not open report: '+encXml(err.message),true);console.error(err)}
}
function hideAll(){
  for(const id of ['landing','records','project','tabs','form','topbar','storagebadge','pentip','chips','hdractions'])
    $('#'+id).classList.add('hidden');
}
/* ---- multi-location project view ---- */
async function enterProjectView(){
  hideAll();
  $('#hdrsub').textContent='Multiple-location report';
  await renderProjectView();
  $('#project').classList.remove('hidden');
  window.scrollTo(0,0);
}
async function showProject(projectKey){
  const proj=await Store.getProject(projectKey);if(!proj){notice('warn','Report not found.');return;}
  await parseXlsx(toAB(proj.templateBytes),proj.filename||'template.xlsx');
  CURPROJ=proj;CURLOC=null;
  await enterProjectView();
}
async function renderProjectView(){
  const p=CURPROJ;
  $('#projTitle').textContent=p.projectCode||p.filename||'Report';
  const locs=await Store.listLocations(p.projectKey);
  const done=locs.filter(l=>l.status==='complete').length;
  $('#projMeta').innerHTML='<b>Multiple-location report.</b> '+
    [p.partner&&('Partner: '+encXml(p.partner)),p.country&&('Country: '+encXml(p.country))].filter(Boolean).join(' &middot; ')+
    ((p.partner||p.country)?' &middot; ':'')+done+' of '+locs.length+' location(s) complete. '+
    'Share with your team using <b>Export field pack</b> (internal channels only).';
  const list=$('#loclist');list.innerHTML='';
  if(!locs.length){list.innerHTML='<div class="rec-empty">No locations yet. Choose <b>Add location</b> to plan the sites to visit.</div>';return;}
  for(const loc of locs){
    const card=el('div',{class:'reccard'});
    const main=el('div',{class:'rc-main'});
    main.innerHTML='<div class="rc-code">'+encXml(loc.locationName||'(unnamed location)')+
      ' <span class="rc-status '+(loc.status||'planned')+'">'+encXml(loc.status||'planned')+'</span></div>'+
      '<div class="rc-meta">'+(loc.author?('By '+encXml(loc.author)+' &middot; '):'')+
      (loc.updatedAt?('Updated '+new Date(loc.updatedAt).toLocaleString()):'not started')+'</div>';
    card.appendChild(main);
    const acts=el('div',{class:'rc-actions'});
    const open=el('button',{class:'btn sm'},'Open');open.addEventListener('click',()=>openLocation(loc));acts.appendChild(open);
    const del=el('button',{class:'btn sm ghost'},'Delete');
    del.addEventListener('click',async()=>{if(confirm('Delete this location and its entries?')){await Store.deleteLocation(loc.id);renderProjectView();}});
    acts.appendChild(del);
    card.appendChild(acts);list.appendChild(card);
  }
}
function openLocation(loc){CURLOC=loc;state=Object.assign({},loc.formState||{});renderForm();}
async function addLocation(){
  const name=(prompt('Location name (the site to visit):')||'').trim();
  if(!name)return;
  const loc={id:newId(),projectKey:CURPROJ.projectKey,locationName:name,
    formState:{fld_visitLocation:name},status:'planned',planned:true};
  await Store.putLocation(loc);
  renderProjectView();
}
function backFromForm(){flushDraft();if(CURPROJ&&CURPROJ.mode==='multi')enterProjectView();else showHome();}
function u8b64(u8){let s='';const C=0x8000;for(let i=0;i<u8.length;i+=C)s+=String.fromCharCode.apply(null,u8.subarray(i,i+C));return btoa(s);}
function b64u8(b){const s=atob(b);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;}
// optional passphrase encryption for shared files (offline, Web Crypto, PBKDF2 + AES-GCM)
async function deriveKey(pass,salt){
  const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encryptObj(obj,pass){
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveKey(pass,salt);
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj))));
  return {app:'gms-field-monitoring-form',kind:'fieldpack-enc',v:1,salt:u8b64(salt),iv:u8b64(iv),ct:u8b64(ct)};
}
async function decryptObj(w,pass){
  const key=await deriveKey(pass,b64u8(w.salt));
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64u8(w.iv)},key,b64u8(w.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function exportFieldPack(){
  if(!CURPROJ){notice('warn','Open a report first.');return;}
  try{
    const locs=await Store.listLocations(CURPROJ.projectKey);
    const bundle={app:'gms-field-monitoring-form',kind:'fieldpack',v:1,exportedAt:new Date().toISOString(),
      projectKey:CURPROJ.projectKey,projectCode:CURPROJ.projectCode,partner:CURPROJ.partner,country:CURPROJ.country,
      filename:CURPROJ.filename,mode:CURPROJ.mode,templateB64:u8b64(CURPROJ.templateBytes),
      locations:locs.map(l=>({id:l.id,projectKey:l.projectKey,locationName:l.locationName,formState:l.formState,
        status:l.status,planned:l.planned,author:l.author,updatedAt:l.updatedAt}))};
    const pass=(prompt('Optional passphrase to encrypt this field pack.\nLeave blank for no encryption. Share the passphrase with your team through a separate channel.')||'').trim();
    let payload=bundle,enc='';
    if(pass){payload=await encryptObj(bundle,pass);enc='-encrypted';}
    const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
    const safe=(CURPROJ.projectCode||'report').replace(/[^\w.-]+/g,'_');
    const a=el('a',{href:URL.createObjectURL(blob),download:'fieldpack-'+safe+enc+'.json'});
    document.body.appendChild(a);a.click();a.remove();
    notice('ok','Field pack exported'+(pass?' (encrypted)':'')+'. Share it through internal channels only.');
  }catch(e){notice('warn','Export failed: '+encXml(e.message),true);console.error(e);}
}
async function importFieldPack(data){
  if(data&&data.kind==='fieldpack-enc'){
    const pass=(prompt('This field pack is encrypted. Enter the passphrase:')||'').trim();
    if(!pass)throw new Error('Passphrase required');
    try{data=await decryptObj(data,pass);}catch(e){throw new Error('Wrong passphrase or corrupted file');}
  }
  if(!data||data.kind!=='fieldpack')throw new Error('Not a field pack file');
  let proj=await Store.getProject(data.projectKey);
  if(!proj){
    proj={projectKey:data.projectKey,projectCode:data.projectCode||'',partner:data.partner||'',country:data.country||'',
      filename:data.filename||'template.xlsx',templateBytes:b64u8(data.templateB64),mode:data.mode||'multi',status:'draft'};
    await Store.putProject(proj);
  }
  const existing={};(await Store.listLocations(data.projectKey)).forEach(l=>existing[l.id]=l);
  let added=0,updated=0;
  for(const bl of (data.locations||[])){
    const ex=existing[bl.id];
    if(!ex){await Store.putLocation(bl);added++;}
    else if((bl.updatedAt||'')>(ex.updatedAt||'')){await Store.putLocation(Object.assign({},ex,bl));updated++;}
  }
  return {added,updated};
}
function fieldMeta(key){
  if(!fieldMeta._m){fieldMeta._m={};for(const sec of CATALOG)for(const g of sec.groups)if(g.fields)for(const f of g.fields)fieldMeta._m[f.n]={type:f.type};}
  return fieldMeta._m[key];
}
// Aggregate location form-states into one consolidated state (field-type aware).
// Numbers sum; free text concatenates with LocationName_ prefix; selects/dates take first;
// scores are never auto-filled (the reviewer sets the single official score).
function aggregateLocations(locs){
  const out={};const keys=new Set();
  locs.forEach(l=>Object.keys(l.formState||{}).forEach(k=>keys.add(k)));
  for(const key of keys){
    const vals=locs.map(l=>({name:l.locationName||l.id,v:(l.formState||{})[key]})).filter(x=>x.v!=null&&String(x.v).trim()!=='');
    if(!vals.length)continue;
    const t=(fieldMeta(key)||{}).type;
    if(t==='score')continue;
    const allNum=vals.every(x=>/^-?\d+(\.\d+)?$/.test(String(x.v).trim()));
    if(t==='number'||(!t&&allNum&&key.indexOf('cell|')===0)){
      out[key]=String(vals.reduce((a,x)=>a+parseFloat(x.v),0));
    }else if(t==='select'||t==='date'||t==='daterange'){
      out[key]=vals[0].v;
    }else{
      out[key]=vals.map(x=>x.name+'_: '+x.v).join('\n');
    }
  }
  return out;
}
async function consolidateAndReview(){
  if(!CURPROJ)return;
  const locs=(await Store.listLocations(CURPROJ.projectKey)).filter(l=>l.status&&l.status!=='planned');
  if(!locs.length){notice('warn','No started locations to consolidate yet. Open and fill at least one location first.');return;}
  let consolidated=aggregateLocations(locs);
  if(CURPROJ.consolidationState)consolidated=Object.assign(consolidated,CURPROJ.consolidationState);
  CURLOC={id:'__consolidated__',projectKey:CURPROJ.projectKey,locationName:'Consolidated',formState:consolidated,status:'draft',consolidated:true};
  state=Object.assign({},consolidated);
  renderForm();
  notice('info','Consolidated from '+locs.length+' location(s). Numbers were summed and text combined with location prefixes. Review and edit anything, set the scores, then Generate the final Excel.');
}
async function showHome(){
  flushDraft();
  hideAll();
  $('#hdrsub').textContent='Fill the GMS monitoring template on any device, then regenerate the exact Excel for upload to OneGMS.';
  await renderRecords();
  $('#records').classList.remove('hidden');
  window.scrollTo(0,0);
}
function showLanding(){hideAll();$('#landing').classList.remove('hidden');window.scrollTo(0,0);}
async function renderRecords(){
  const list=$('#reclist');list.innerHTML='';
  let projects=[];try{projects=await Store.listProjects();}catch(e){console.error(e);}
  if(!projects.length){list.innerHTML='<div class="rec-empty">No saved reports yet. Choose <b>New report</b> to load a GMS template and start.</div>';return;}
  for(const p of projects){
    const gens=await Store.listGenerated(p.projectKey);const lastGen=gens[0];
    const meta=[p.partner&&('Partner: '+encXml(p.partner)),p.country&&('Country: '+encXml(p.country)),
      'Updated '+new Date(p.updatedAt).toLocaleString(),
      lastGen?('Last generated '+new Date(lastGen.generatedAt).toLocaleString()):''].filter(Boolean).join(' &middot; ');
    const card=el('div',{class:'reccard'});
    const main=el('div',{class:'rc-main'});
    main.innerHTML='<div class="rc-code">'+encXml(p.projectCode||p.filename||'Report')+
      ' <span class="rc-status '+(p.status||'draft')+'">'+encXml(p.status||'draft')+'</span></div>'+
      '<div class="rc-meta">'+meta+'</div>';
    card.appendChild(main);
    const acts=el('div',{class:'rc-actions'});
    const open=el('button',{class:'btn sm'},'Open');open.addEventListener('click',()=>openProject(p.projectKey));acts.appendChild(open);
    if(lastGen){
      const dl=el('button',{class:'btn sm ghost'},'Download Excel');
      dl.addEventListener('click',()=>{const b=new Blob([lastGen.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        const a=el('a',{href:URL.createObjectURL(b),download:lastGen.filename});document.body.appendChild(a);a.click();a.remove();});
      acts.appendChild(dl);
      const mk=el('button',{class:'btn sm ghost'},p.status==='uploaded'?'Uploaded ✓':'Mark uploaded');
      mk.addEventListener('click',async()=>{p.status='uploaded';await Store.putProject(p);lastGen.uploadedAt=new Date().toISOString();await Store.updateGenerated(lastGen);renderRecords();});
      acts.appendChild(mk);
    }
    const del=el('button',{class:'btn sm ghost'},'Delete');
    del.addEventListener('click',async()=>{if(confirm('Delete this report and its saved files from this device?')){await Store.deleteProject(p.projectKey);renderRecords();}});
    acts.appendChild(del);
    card.appendChild(acts);list.appendChild(card);
  }
}
const dz=$('#dropzone'),fi=$('#fileinput');
dz.addEventListener('click',()=>fi.click());
fi.addEventListener('change',()=>fi.files[0]&&loadFile(fi.files[0]));
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag')});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');e.dataTransfer.files[0]&&loadFile(e.dataTransfer.files[0])});
$('#btnGen').addEventListener('click',()=>generate().catch(e=>{notice('warn','Generation failed: '+encXml(e.message),true);console.error(e)}));
$('#btnExport').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({file:WB.fname,ts:new Date().toISOString(),state},null,1)],{type:'application/json'});
  const a=el('a',{href:URL.createObjectURL(blob),download:(WB.fname||'report').replace(/\.xlsx$/i,'')+'-draft.json'});
  document.body.appendChild(a);a.click();a.remove();
});
$('#btnImport').addEventListener('click',()=>{
  const inp=el('input',{type:'file',accept:'.json'});
  inp.addEventListener('change',async()=>{
    try{const d=JSON.parse(await inp.files[0].text());state=d.state||{};
      if(CURLOC){CURLOC.formState=state;await Store.putLocation(CURLOC);}renderForm();notice('info','Draft imported.');}
    catch(e){notice('warn','Invalid draft file.')}
  });
  inp.click();
});
$('#btnReset').addEventListener('click',async()=>{
  if(!confirm('Discard your entries for this report and start from the template values?'))return;
  state={};if(CURLOC){CURLOC.formState={};CURLOC.status='draft';await Store.putLocation(CURLOC);}renderForm();
});
$('#btnNew').addEventListener('click',()=>backFromForm());
$('#btnNewReport').addEventListener('click',()=>showLanding());
$('#btnProjBack').addEventListener('click',()=>showHome());
$('#btnAddLoc').addEventListener('click',()=>addLocation());
$('#btnFieldPack').addEventListener('click',()=>exportFieldPack());
$('#btnConsolidate').addEventListener('click',()=>consolidateAndReview());
$('#btnBackupExport').addEventListener('click',async()=>{
  try{const data=await Store.exportAll();
    const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
    const d=new Date();const ts=''+d.getFullYear()+pad2(d.getMonth()+1)+pad2(d.getDate())+'-'+pad2(d.getHours())+pad2(d.getMinutes());
    const a=el('a',{href:URL.createObjectURL(blob),download:'gms-field-monitor-backup-'+ts+'.json'});
    document.body.appendChild(a);a.click();a.remove();
    notice('ok','Backup exported. Keep it on an internal channel only.');
  }catch(e){notice('warn','Backup failed: '+encXml(e.message),true);console.error(e);}
});
$('#btnBackupImport').addEventListener('click',()=>{
  const inp=el('input',{type:'file',accept:'.json'});
  inp.addEventListener('change',async()=>{
    try{const data=JSON.parse(await inp.files[0].text());await Store.importAll(data);await renderRecords();
      notice('ok','Backup imported.');}catch(e){notice('warn','Invalid backup file: '+encXml(e.message),true);console.error(e);}
  });
  inp.click();
});
$('#btnImportPack').addEventListener('click',()=>{
  const inp=el('input',{type:'file',accept:'.json'});
  inp.addEventListener('change',async()=>{
    try{const data=JSON.parse(await inp.files[0].text());const res=await importFieldPack(data);await renderRecords();
      notice('ok','Field pack imported: '+res.added+' location(s) added, '+res.updated+' updated.');}
    catch(e){notice('warn','Invalid field pack: '+encXml(e.message),true);console.error(e);}
  });
  inp.click();
});
$('#sbBtn').addEventListener('click',()=>$('#sbInfo').classList.toggle('hidden'));
$('#pentipX').addEventListener('click',()=>{$('#pentip').classList.add('hidden');try{localStorage.setItem('gmsfm:pentipDismissed','1')}catch(e){}});
// data-loss disclaimer: dismissible, remembered so it does not nag returning users
(function(){
  const d=$('#disclaimer');if(!d)return;
  try{if(localStorage.getItem('gmsfm:discDismissed'))d.classList.add('hidden')}catch(e){}
  $('#discDismiss').addEventListener('click',()=>{
    d.classList.add('hidden');
    try{localStorage.setItem('gmsfm:discDismissed','1')}catch(e){}
  });
})();
// flush the current entries immediately if the page is hidden or closed mid-debounce
function flushDraft(){
  if(!CURLOC)return;
  clearTimeout(saveTimer);
  try{
    if(CURLOC.consolidated){if(CURPROJ){CURPROJ.consolidationState=state;Store.putProject(CURPROJ);}}
    else{CURLOC.formState=state;Store.putLocation(CURLOC);if(CURPROJ)Store.putProject(CURPROJ);}
  }catch(e){}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushDraft()});
window.addEventListener('pagehide',flushDraft);
// offline support: after the first online visit the page loads with no connection
if('serviceWorker' in navigator&&location.protocol!=='file:')
  navigator.serviceWorker.register('sw.js').catch(()=>{});
// startup: open the records home if there are already saved reports
(async function(){
  try{await Store.open();Store.persist();
    const projects=await Store.listProjects();
    if(projects.length)await showHome();
  }catch(e){console.error(e);}
})();

// test hook (no UI impact)
window.__gms={WB,get state(){return state},set state(s){state=s},loadBuffer:async(buf,name)=>{await parseXlsx(buf,name);CURPROJ=null;CURLOC=null;state={};renderForm()},
  collectEdits,generate,setVal:(k,v)=>{state[k]=v;onStateChange()},inputs:()=>inputsIndex,cellV,namedV,
  openProject,showHome,renderRecords,loadFileObj:loadFile,showProject,enterProjectView,addLocation,openLocation,
  exportFieldPack,importFieldPack,consolidateAndReview,encryptObj,decryptObj,
  get curproj(){return CURPROJ},get curloc(){return CURLOC}};
