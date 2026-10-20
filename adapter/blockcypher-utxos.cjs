'use strict';
// Never represent a truncated or unbalanced index response as complete UTXOs.
function completeUtxos(data, address) {
 if (data.address !== address || data.hasMore || !Number.isSafeInteger(data.final_balance) || data.final_balance < 0)
  throw new Error('Incomplete fallback address index');
 const refs = [...(data.txrefs || []), ...(data.unconfirmed_txrefs || [])];
 const seen = new Set();
 const result = refs.filter(r=>r.tx_input_n === -1 && r.spent === false).map(r=>{
  const key = `${r.tx_hash}:${r.tx_output_n}`;
  if (!/^[a-f0-9]{64}$/.test(r.tx_hash) || !Number.isSafeInteger(r.tx_output_n) || r.tx_output_n < 0 ||
      !Number.isSafeInteger(r.value) || r.value < 0 || r.double_spend || seen.has(key))
   throw new Error('Invalid fallback UTXO');
  seen.add(key);
  const confirmed = Number.isSafeInteger(r.block_height) && r.block_height >= 0;
  const blockTime = Math.floor(Date.parse(r.confirmed) / 1000);
  if (confirmed && !Number.isSafeInteger(blockTime)) throw new Error('Missing fallback confirmation time');
  return {txid:r.tx_hash,vout:r.tx_output_n,value:r.value,status:confirmed
   ? {confirmed:true,block_height:r.block_height,block_time:blockTime} : {confirmed:false}};
 });
 if (result.reduce((n,r)=>n+r.value,0) !== data.final_balance)
  throw new Error('Fallback UTXOs do not reconcile with the indexed balance');
 return result;
}
module.exports={completeUtxos};
