import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {toCnyCents} from '../global-trips/journal-ledger.mjs';
const dir=new URL('../global-trips/trips/2026-maldives-bangkok/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,dir),'utf8');
const ledger=JSON.parse(read('ledger.json'));
const journal=read('journal.html');
test('V11 retains eight dates and all 69 journal images with local resources',()=>{
 assert.equal((journal.match(/class="day"/g)||[]).length,8);
 for(const date of ['09.30','10.01','10.02','10.03','10.04','10.05','10.06','10.07']) assert.ok(journal.includes(date));
 const photos=[...journal.matchAll(/<img[^>]*src="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(photos.length,69);assert.equal(new Set(photos).size,69);
 for(const rel of photos){assert.ok(/^(\.\/)?assets\/photos\/[\w-]+\.jpg$/.test(rel));const buf=fs.readFileSync(new URL(rel,dir));assert.equal(buf.readUInt16BE(0),0xffd8);assert.equal(buf.readUInt16BE(buf.length-2),0xffd9);}
 assert.ok(!/data:image|<script|\son\w+=/.test(journal));
});
test('loaded fragments have no duplicate IDs or collisions with the host page',()=>{
 const text=read('index.html')+journal+read('ledger.html');
 const ids=[...text.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 const trip=JSON.parse(read('trip.json'));for(const name of ['content','ledger','ledgerView']) assert.ok(fs.existsSync(new URL(trip.journal[name],dir)));
});
test('ledger preserves confirmed payment, refund removal and non-counted references',()=>{
 assert.equal(ledger.rows.length,56);assert.equal(new Set(ledger.rows.map(r=>r.id)).size,56);
 assert.equal(ledger.rows.find(r=>r.id==='alipay190').amount,190.14);
 assert.equal(ledger.rows.find(r=>r.id==='palace').included,false);
 assert.equal(ledger.rows.find(r=>r.id==='grabfood').included,false);
 assert.ok(!ledger.rows.some(r=>r.item.includes('小吊带')));
 const total=rate=>ledger.rows.filter(r=>r.included).reduce((sum,r)=>sum+(toCnyCents(r,rate)??0),0);
 assert.equal(total(.2),6708719);assert.equal(total(.21),6713722);
});
test('money distinguishes unknown, zero and invalid values; rounds THB to cents',()=>{
 assert.equal(toCnyCents({amount:null,currency:'CNY'},.2),null);
 assert.equal(toCnyCents({amount:0,currency:'CNY'},.2),0);
 assert.equal(toCnyCents({amount:190.14,currency:'CNY'},.2),19014);
 assert.equal(toCnyCents({amount:99,currency:'THB'},.2),1980);
 assert.equal(toCnyCents({amount:-5,currency:'CNY'},.2),null);
 assert.equal(toCnyCents({amount:10,currency:'THB'},0),null);
});
