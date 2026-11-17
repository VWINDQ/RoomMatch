import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './support/postgres.mjs';
import { seedPersonalPagination } from './support/personal-pagination-fixture.mjs';
import { createToken } from '../server/auth.js';
import { startRoomMatchServer } from '../server/app.js';

for(const [endpoint,size,viewer] of [['/favorites',12,3],['/my/rooms',10,1]]) {
  test(`${endpoint} exact boundaries, fixed maximum, account/filter totals and canonical pages`,async t=>{
    const db=await openDatabase({filename:':memory:'});
    const app=await startRoomMatchServer({db,port:0});
    t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));await db.close();});
    const request=async(query,userId=viewer)=>{
      const response=await fetch(`http://127.0.0.1:${app.server.address().port}/api${endpoint}?q=Private%20pagination&${query}`,{headers:{Authorization:`Bearer ${createToken(userId)}`}});
      return {status:response.status,body:await response.json()};
    };
    for(const count of [0,1,size-1,size,size+1,2*size,2*size+1]) {
      await db.prepare("DELETE FROM ROOM WHERE description LIKE 'Private pagination%'").run();
      const rooms=await seedPersonalPagination(db,count);
      const totalPages=Math.ceil(count/size);
      const ids=[];
      for(let page=1;page<=Math.max(1,totalPages);page++) {
        const {status,body}=await request(`page=${page}&pageSize=${size}`);
        assert.equal(status,200);
        assert.equal(body.pageSize,size);assert.equal(body.total,count);assert.equal(body.totalPages,totalPages);assert.equal(body.page,page);
        assert.equal(body.rooms.length,Math.min(size,Math.max(0,count-(page-1)*size)));
        assert.ok(body.rooms.length<=size);ids.push(...body.rooms.map(room=>room.roomId));
      }
      assert.equal(new Set(ids).size,count);
      assert.deepEqual([...ids].sort((a,b)=>a-b),rooms.map(room=>room.room_id).sort((a,b)=>a-b));
      const last=(await request('page=999')).body;
      assert.equal(last.page,Math.max(1,totalPages));assert.equal(last.total,count);assert.equal(last.totalPages,totalPages);
      assert.equal((await request('page=1',4)).body.total,0);
      const filtered=rooms.filter(room=>room.status==='available');
      const result=(await request('page=99&status=available')).body;
      assert.equal(result.total,filtered.length);assert.equal(result.totalPages,Math.ceil(filtered.length/size));
      assert.equal(result.page,Math.max(1,Math.ceil(filtered.length/size)));
    }
    assert.equal((await request(`page=1&pageSize=${size+1}`)).status,400);
  });
}
