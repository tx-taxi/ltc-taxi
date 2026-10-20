const test=require('node:test'),assert=require('node:assert/strict');
const {completeUtxos}=require('./blockcypher-utxos.cjs');
test('fallback exposes complete confirmed and pending outputs without accepting partial balances',()=>{
 const address='ltc1fixture',ref={tx_hash:'a'.repeat(64),tx_input_n:-1,tx_output_n:1,value:5000,spent:false,block_height:100,confirmed:'2020-01-01T00:00:00Z'};
 const data={address,final_balance:6000,txrefs:[ref],unconfirmed_txrefs:[{...ref,tx_hash:'b'.repeat(64),value:1000,block_height:-1}]};
 assert.deepEqual(completeUtxos(data,address).map(x=>[x.value,x.status.confirmed]),[[5000,true],[1000,false]]);
 assert.throws(()=>completeUtxos({...data,hasMore:true},address));
 assert.throws(()=>completeUtxos({...data,final_balance:7000},address));
 assert.throws(()=>completeUtxos({...data,txrefs:[]},address));
 assert.throws(()=>completeUtxos(data,'different'));
 assert.deepEqual(completeUtxos({address,final_balance:0},address),[]);
});
