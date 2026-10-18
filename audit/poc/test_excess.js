const { setup, E, addr } = require('./harness');
const W = addr(0xD1), S = addr(0xD2), Z = addr(0xD3);
const n = x => (Number(x * 100n / E) / 100).toLocaleString();

// Does calling excessIncomeDistribution extract value, or is calling dominated by waiting?
async function run(whaleCalls) {
  const t = await setup({ price: 2000n * E });
  for (const a of [W, S, Z]) await t.fund(a, 10n ** 25n);
  await t.depositEther(W, W, 500000n * E, 1000n * E);   // whale: 500k eUSD (50%)
  await t.depositEther(S, S, 500000n * E, 1000n * E);   // other holders: 500k
  await t.stRebase(100n * E);                            // 100 stETH of yield accrues
  // give the non-whale caller some eUSD so they can be the one to call
  await t.transferEUSD(S, Z, 100000n * E);
  const before = await t.eusdBal(W), stBefore = await t.stBal(W);
  const caller = whaleCalls ? W : Z;
  await t.excessIncome(caller, 100000n * E);
  const after = await t.eusdBal(W), stAfter = await t.stBal(W);
  return { eusd: after - before, st: stAfter - stBefore, net: (after - before) + (stAfter - stBefore) * 2000n };
}

(async () => {
  const a = await run(true), b = await run(false);
  console.log('Whale holds 500,000 of 1,000,000 eUSD. payAmount = 100,000. income ~ 0.\n');
  console.log('  whale CALLS excessIncomeDistribution:');
  console.log('    eUSD change  ', n(a.eusd), '   stETH received', n(a.st), '($' + n(a.st * 2000n) + ')');
  console.log('    NET to whale  $', n(a.net));
  console.log('  whale does NOT call (someone else does):');
  console.log('    eUSD change  ', n(b.eusd), '   stETH received', n(b.st));
  console.log('    NET to whale  $', n(b.net));
  console.log('\n  => calling is', a.net > b.net ? 'BETTER (extraction!)' : 'WORSE by $' + n(b.net - a.net) + ' - strictly dominated by waiting; no extraction');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
