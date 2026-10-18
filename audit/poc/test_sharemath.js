const { setup, E, addr } = require('./harness');
const A = addr(0xAA), B = addr(0xBB), C = addr(0xCC);

(async () => {
  const t = await setup({ price: 2000n * E });
  for (const a of [A, B, C]) { await t.fund(a, 10n ** 24n); await t.stMint(a, 100000n * E); await t.stApprove(a, t.lybra, 1n << 255n); }

  console.log('### 1. ratio R = totalEUSDCirculation / totalShares across operations');
  const R = async () => { const T = await t.totalSupply(), S = await t.totalShares(); return S === 0n ? 'n/a' : (Number(T * 10n ** 9n / S) / 1e9).toFixed(9); };
  await t.depositEther(A, A, 100000n * E, 1000n * E);
  console.log('  after first mint            R =', await R());
  await t.depositEther(B, B, 50000n * E, 500n * E);
  console.log('  after second mint           R =', await R());
  await t.burn(A, A, 10000n * E);
  console.log('  after repay                 R =', await R());
  await t.transferEUSD(A, C, 1000n * E);
  console.log('  after transfer              R =', await R());
  // yield -> excessIncomeDistribution burns shares without lowering supply => R rises
  await t.stRebase(100n * E);
  await t.excessIncome(A, 100n * E);
  console.log('  after excessIncome (burn)   R =', await R(), '  <-- only op that moves R');

  console.log('\n### 2. how far can an unprivileged caller push R?');
  console.log('  excessIncome burns sh = (payAmount-income)*S/T, bounded by payoutEther <= stETH excess.');
  console.log('  To reach S << T you must spend excess stETH worth ~T, i.e. yield >= entire eUSD supply.');
  let st = await t.stBal(t.lybra), td = await t.totalDeposited();
  console.log('  current excess stETH =', Number((st - td) * 1000n / E) / 1000, 'stETH  vs totalSupply =', (await t.totalSupply()) / E, 'eUSD');

  console.log('\n### 3. the _mintEUSD zero-fallback (Lybra.sol:521-523) at the current R');
  const T = await t.totalSupply(), S = await t.totalShares();
  // fallback triggers when amount*S < T  i.e. amount < T/S = R
  const trigger = T / S;
  console.log('  fallback triggers for mintAmount <', trigger.toString(), 'wei  (R =', await R(), ')');
  console.log('  => at a realistic R the fallback is reachable only for sub-wei-scale mints: max value');
  console.log('     a minter can capture per call is (R-1) * amount < ' + (trigger).toString() + ' wei.');

  console.log('\n### 4. _repay has NO zero-fallback (Lybra.sol:551) - free debt clearing?');
  const borBefore = await t.borrowed(B), shBefore = await t.sharesOf(A);
  try {
    await t.burn(A, B, trigger > 1n ? trigger - 1n : 1n);   // amount < R  => sharesAmount rounds to 0
    const burned = shBefore - (await t.sharesOf(A));
    const cleared = borBefore - (await t.borrowed(B));
    console.log('  burn(amount =', (trigger > 1n ? trigger - 1n : 1n).toString(), 'wei): shares burned =', burned.toString(), ', debt cleared =', cleared.toString(), 'wei');
    console.log('  => debt cleared for free, but capped at R-1 =', (trigger - 1n).toString(), 'wei per call. Not amplifiable.');
  } catch (e) { console.log('  reverted:', e.message); }

  console.log('\n### 5. can totalShares reach 0 while totalSupply > 0?  (would let next minter capture whole supply)');
  console.log('  _repay burns floor(a*S/T) and lowers T by a; the final full repay burns exactly S. Verified:');
  const t2 = await setup({ price: 2000n * E });
  await t2.fund(A, 10n ** 24n);
  await t2.depositEther(A, A, 1000n * E, 10n * E);
  await t2.burn(A, A, 999n * E);
  console.log('   after repaying 999/1000:  T =', (await t2.totalSupply()).toString(), ' S =', (await t2.totalShares()).toString());
  await t2.burn(A, A, 1n * E);
  console.log('   after repaying the rest:  T =', (await t2.totalSupply()).toString(), ' S =', (await t2.totalShares()).toString(), ' -> both hit 0 together');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
