// Integer cents keep the imported ledger's two currencies precise.
export function toCnyCents(row, rate) {
  if (row.amount === null || row.amount === '' || !Number.isFinite(row.amount) || row.amount < 0) return null;
  if (!['CNY','THB'].includes(row.currency) || !Number.isFinite(rate) || rate <= 0 || rate > 1) return null;
  return Math.round((row.amount * (row.currency === 'THB' ? rate : 1) + Number.EPSILON) * 100);
}


export function mountLedger(root, data){
  const seed=data.rows;
  const key='jtqx-trip001-memory-budget-20261011-v4';
  const statuses={contract:'合同价',estimate:'用户估计',stated:'本人报金额',lower:'下界/约数',reference:'参考估算',unconfirmed:'未确认支付',missing:'待补',paid:'实际支付',likely:'待核归属',duplicate:'重复参考（不计入）'};
  const order=['大项','交通','体验','餐饮','购物','行前采购','待核项目','待补'];
  let rows=seed.map(r=>({...r})); let rate=.20;
  try {const old=JSON.parse(localStorage.getItem(key)||'null');if(old&&Array.isArray(old.rows)&&old.rows.every(r=>r&&typeof r.id==='string'&&typeof r.item==='string'&&['CNY','THB'].includes(r.currency)&&(r.amount===null||Number.isFinite(r.amount)&&r.amount>=0))){rows=old.rows;rate=Number(old.rate)>0&&Number(old.rate)<=1?Number(old.rate):.20}}catch(e){}
  root.querySelector('#journal-'+'fxRate').value=rate.toFixed(3);
  const money=n=>'¥'+n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const convert=r=> { const cents=toCnyCents(r,rate);return cents===null?null:cents/100; };
  const save=()=>{try{localStorage.setItem(key,JSON.stringify({rows,rate,lastEditedAt:new Date().toISOString()}))}catch(e){}};
  function render(){
    const body=root.querySelector('#journal-'+'ledgerBody'); body.textContent='';
    [...rows].sort((a,b)=>order.indexOf(a.category)-order.indexOf(b.category)).forEach(row=>{
      const tr=document.createElement('tr');if(!row.included)tr.className='unincluded';
      function td(cls){const el=document.createElement('td'); if(cls)el.className=cls;tr.appendChild(el);return el}
      td('group-cell').textContent=row.category;
      const item=td('item');const nm=document.createElement('strong');nm.textContent=row.item;nm.title='双击修改项目名称';nm.style.cursor='text';nm.ondblclick=()=>{const v=prompt('修改消费项目名称',row.item);if(v&&v.trim()){row.item=v.trim();update()}};const note=document.createElement('span');note.textContent=row.note||'';note.title='双击修改备注';note.style.cursor='text';note.ondblclick=()=>{const v=prompt('修改备注',row.note||'');if(v!==null){row.note=v;update()}};item.append(nm,note);
      const curr=td();const cs=document.createElement('select'); ['CNY','THB'].forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v==='CNY'?'人民币':'泰铢';o.selected=v===row.currency;cs.appendChild(o)});cs.setAttribute('aria-label',row.item+' 币种');cs.onchange=()=>{row.currency=cs.value;update()};curr.appendChild(cs);
      const amt=td();const inp=document.createElement('input');inp.className='money';inp.type='number';inp.min='0';inp.step='0.01';inp.placeholder='待填';inp.value=(row.amount??'');inp.setAttribute('aria-label',row.item+' 金额');inp.onchange=()=>{if(!inp.validity.valid){inp.reportValidity();inp.value=row.amount??'';return;}row.amount=inp.value===''?null:Number(inp.value);if(row.amount!==null&&row.status==='missing')row.status='stated';if(row.amount!==null)row.included=true;update()};amt.appendChild(inp);
      const status=td();const sel=document.createElement('select');for(const [v,t] of Object.entries(statuses)){const op=document.createElement('option');op.value=v;op.textContent=t;op.selected=v===row.status;sel.appendChild(op)}sel.setAttribute('aria-label',row.item+' 金额依据');sel.onchange=()=>{row.status=sel.value;update()};status.appendChild(sel);
      const check=td();const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!row.included;cb.setAttribute('aria-label',row.item+' 计入合计');cb.onchange=()=>{row.included=cb.checked;update()};check.appendChild(cb);
      const cny=td();const val=convert(row);cny.textContent=val==null?'—':money(val);if(row.status==='estimate'||row.status==='lower')cny.className='est';if(row.status==='unconfirmed')cny.className='unc';body.appendChild(tr);
    });
    const considered=rows.filter(r=>r.included&&convert(r)!==null);
    const major=considered.filter(r=>r.category==='大项').reduce((s,r)=>s+convert(r),0);
    const other=considered.filter(r=>r.category!=='大项').reduce((s,r)=>s+convert(r),0);
    root.querySelector('#journal-'+'majorTotal').textContent='≈ '+money(major);
    root.querySelector('#journal-'+'otherTotal').textContent='≈ '+money(other);
    root.querySelector('#journal-'+'grandTotal').textContent='≈ '+money(major+other);
    root.querySelector('#journal-'+'footerTotal').textContent=money(major+other);
    root.querySelector('#journal-'+'countNotice').textContent='已计入 '+considered.length+' 笔；尚有 '+rows.filter(r=>!r.included || convert(r)===null).length+' 笔待补或暂不计入';
    const groups=[{name:'交通',color:'#457f9c',test:r=>r.category==='交通'||r.id==='air'},{name:'住宿',color:'#63aa9a',test:r=>r.id==='ozen'||r.id==='fourpoints'},{name:'餐饮',color:'#dba875',test:r=>r.category==='餐饮'},{name:'采购',color:'#b57f9d',test:r=>r.category==='购物'||r.category==='行前采购'},{name:'体验及其他',color:'#8d8b9f',test:r=>true}];
    let cum=0;const stops=[];const legend=root.querySelector('#journal-'+'spendLegend');legend.replaceChildren();
    groups.forEach(g=>{const subset=considered.filter(r=>g.test(r)&&!groups.slice(0,groups.indexOf(g)).some(prev=>prev.test(r)));const val=subset.reduce((s,r)=>s+convert(r),0);if(!val)return;const pct=100*val/(major+other);stops.push(`${g.color} ${cum}% ${cum+pct}%`);cum+=pct;const line=document.createElement('div');line.className='legend-line';line.innerHTML=`<span class="legend-dot" style="background:${g.color}"></span><strong>${g.name}</strong><span>${money(val)}</span><em>${pct.toFixed(1)}%</em>`;legend.appendChild(line)});
    root.querySelector('#journal-'+'spendDonut').style.background=stops.length?'conic-gradient('+stops.join(',')+')':'#dbe8ea';root.querySelector('#journal-'+'donutTotal').textContent=money(major+other);

    save();
  }
  function update(){render()}
  root.querySelector('#journal-'+'fxRate').onchange=e=>{const n=Number(e.target.value);if(n>0&&n<=1){rate=n;update()}else{e.target.value=rate}};
  root.querySelector('#journal-'+'addRow').onclick=()=>{const n=String(rows.length+1);rows.push({id:'custom_'+Date.now(),category:'待补',item:'新增消费 '+n,amount:null,currency:'THB',status:'missing',included:false,note:'双击项目名称或备注可修改'});update()};
  function download(text,file,type){const blob=new Blob([text],{type});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=file;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
  root.querySelector('#journal-'+'exportJson').onclick=()=>download(JSON.stringify({tripId:'2026-maldives-bangkok',exportedAt:new Date().toISOString(),exchangeRateTHBtoCNY:rate,rows},null,2),'Trip001_预算账本.json','application/json');
  root.querySelector('#journal-'+'exportCsv').onclick=()=>{const h=['category','item','amount','currency','status','included','note'];const lines=[h.join(','),...rows.map(r=>h.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(','))];download('\ufeff'+lines.join('\n'),'Trip001_预算账本.csv','text/csv;charset=utf-8')};
  root.querySelector('#journal-'+'resetBudget').onclick=()=>{if(confirm('还原至最初填写的旅行预算吗？当前修改会被覆盖。')){rows=seed.map(r=>({...r}));rate=.2;root.querySelector('#journal-'+'fxRate').value='0.200';update()}};
  render();
}
