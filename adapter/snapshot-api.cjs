'use strict';
// Reuse native block observations when REST is unavailable. Unknown history
// still goes to REST; receiving unrelated feed statistics cannot freshen blocks.
function snapshotApi(feed, path) {
 if (!feed.blocksObservedAt || Date.now()-feed.blocksObservedAt > 900000) return null;
 const stale=feed.freshness().state !== 'live' || Date.now()-feed.blocksObservedAt > 90000;
 const blocks = [...(feed.snapshot.blocks || [])].sort((a,b)=>b.height-a.height);
 if (!blocks.length || blocks.some((b,i)=>!Number.isInteger(b.height) || !/^[a-f0-9]{64}$/.test(b.id) || !Number.isInteger(b.tx_count) || (i && blocks[i-1].height !== b.height+1))) return null;
 let data, match;
 if (path === '/api/blocks' || path === '/api/v1/blocks') data=blocks;
 else if (path === '/api/blocks/tip/height') data=String(blocks[0].height);
 else if (path === '/api/blocks/tip/hash') data=blocks[0].id;
 else if ((match=path.match(/^\/api\/(?:v1\/)?blocks\/(\d+)$/))) {
  const index=blocks.findIndex(b=>b.height===Number(match[1]));
  if (index<0) return null;
  data=blocks.slice(index);
 } else if ((match=path.match(/^\/api\/(?:v1\/)?block\/([a-f0-9]{64})$/))) data=blocks.find(b=>b.id===match[1]);
 else if ((match=path.match(/^\/api\/block-height\/(\d+)$/))) data=blocks.find(b=>b.height===Number(match[1]))?.id;
 if (data === undefined) return null;
 return {data, status:200, source:'litecoinspace-websocket', at:feed.blocksObservedAt, stale};
}
module.exports={snapshotApi};
