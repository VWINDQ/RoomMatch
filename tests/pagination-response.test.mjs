import './helpers/load-client.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { api } = await import('../src/lib/api.ts');
const { Pagination } = await import('../src/components/Pagination.tsx');

test('pagination produces no DOM for zero/one page or missing/invalid metadata',()=>{
  for(const totalPages of [0,1,undefined,null,NaN,Infinity,'2']) {
    assert.equal(renderToStaticMarkup(createElement(Pagination,{page:1,totalPages,busy:false,onChange(){}})),'');
  }
  assert.match(renderToStaticMarkup(createElement(Pagination,{page:1,totalPages:2,busy:false,onChange(){}})),/aria-current="page"/);
});

test('paginated adapters reject legacy, inconsistent, oversized and wrong-page-size responses',async t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;});
  let payload, requestedPath;
  t.mock.method(globalThis,'fetch',async path=>{requestedPath=path;return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});});
  for(const [load,size] of [[api.favoritesPage,12],[api.myRoomsPage,10],[api.roomsPage,12]]) {
    const rooms=Array.from({length:size},(_,i)=>({roomId:i+1,title:`Room ${i+1}`}));
    const valid={rooms,total:size+1,page:1,pageSize:size,totalPages:2};
    const params=new URLSearchParams({page:'1',pageSize:String(size)});
    for(const invalid of [
      {rooms}, {...valid,totalPages:size+1}, {...valid,pageSize:size+1},
      {...valid,rooms:[...rooms,{roomId:size+1}]}, {...valid,page:0},
      {...valid,total:'13'}, {...valid,totalPages:null}, {...valid,total:-1},
      {...valid,rooms:undefined}, {...valid,rooms:[]},
    ]) {
      payload=invalid;
      await assert.rejects(()=>load(params),/แบ่งหน้า/,JSON.stringify(Object.keys(invalid)));
    }
    payload=valid;
    assert.equal((await load(params)).rooms.length,size);
    assert.equal((await load(new URLSearchParams())).rooms.length,size);
    const actualQuery=new URL(requestedPath,'http://localhost').searchParams;
    assert.equal(actualQuery.get('page'),'1');assert.equal(actualQuery.get('pageSize'),String(size));
    payload={rooms:[],total:0,page:1,pageSize:size,totalPages:0};
    assert.equal((await load(params)).totalPages,0);
  }
});
