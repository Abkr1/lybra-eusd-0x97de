const { setup, E, addr } = require('./harness');

let seed = BigInt(process.argv[2] || 1);
function rnd(n) { seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n); return Number((seed >> 33n) % BigInt(n)); }

const ACTORS = [addr(0xA1), addr(0xA2), addr(0xA3), addr(0xA4)];

async function snapshot(t) {
  const s = { borrowed: 0n, shares: 0n, dep: 0n, per: {} };
  for (const a of ACTORS.concat([t.pool, t.lybra])) {
    const b = await t.borrowed(a), sh = await t.sharesOf(a), d = await t.deposited(a);
    s.borrowed += b; s.shares += sh; s.dep += d;
    s.per[a] = { b, sh, d, st: await t.stBal(a), eusd: await t.eusdBal(a) };
  }
  s.totalSupply = await t.totalSupply(); s.totalShares = await t.totalShares();
  s.totalDep = await t.totalDeposited(); s.lybraSt = await t.stBal(t.lybra);
  return s;
}

function check(s, step, action) {
  const bad = [];
  if (s.borrowed !== s.totalSupply) bad.push(`I1 sum(borrowed)=${s.borrowed} != totalSupply=${s.totalSupply}`);
  if (s.shares !== s.totalShares) bad.push(`I2 sum(shares)=${s.shares} != totalShares=${s.totalShares}`);
  if (s.dep !== s.totalDep) bad.push(`I3 sum(deposited)=${s.dep} != totalDepositedEther=${s.totalDep}`);
  if (s.lybraSt < s.totalDep) bad.push(`I4 INSOLVENT: lybra stETH=${s.lybraSt} < totalDepositedEther=${s.totalDep}`);
  if (s.totalShares === 0n && s.totalSupply > 0n) bad.push(`I5 totalShares==0 while totalSupply=${s.totalSupply}`);
  if (bad.length) { console.log(`\n!!! step ${step} after ${action}`); bad.forEach(b => console.log('   ', b)); return true; }
  return false;
}

(async () => {
  const t = await setup();
  for (const a of ACTORS) { await t.fund(a, 10000n * E); await t.stMint(a, 5000n * E); await t.stApprove(a, t.lybra, (1n << 255n)); }
  let price = 2000n * E;
  let violations = 0;
  const log = [];

  for (let step = 0; step < 400; step++) {
    const me = ACTORS[rnd(4)], other = ACTORS[rnd(4)];
    const k = rnd(13);
    let action = '';
    try {
      if (k === 0) { const v = BigInt(1 + rnd(20)) * E; action = `depositEther(${me}->${other}, mint 0, ${v / E}ETH)`; await t.depositEther(me, other, 0, v); }
      else if (k === 1) { const v = BigInt(1 + rnd(20)) * E; const m = BigInt(rnd(5000)) * E; action = `depositEtherToMint(${me}->${other}, mint ${m / E}, ${v / E}ETH)`; await t.depositEther(me, other, m, v); }
      else if (k === 2) { const v = BigInt(1 + rnd(20)) * E; const m = BigInt(rnd(5000)) * E; action = `depositStETH(${me}->${other}, ${v / E}, mint ${m / E})`; await t.depositStETH(me, other, v, m); }
      else if (k === 3) { const m = BigInt(1 + rnd(5000)) * E; action = `mint(${me}->${other}, ${m / E})`; await t.mint(me, other, m); }
      else if (k === 4) { const m = BigInt(1 + rnd(3000)) * E; action = `burn(${me}->${other}, ${m / E})`; await t.burn(me, other, m); }
      else if (k === 5) { const v = BigInt(1 + rnd(10)) * E; action = `withdraw(${me}->${other}, ${v / E})`; await t.withdraw(me, other, v); }
      else if (k === 6) { const m = BigInt(1 + rnd(2000)) * E; action = `transferEUSD(${me}->${other}, ${m / E})`; await t.transferEUSD(me, other, m); }
      else if (k === 7) { action = `becomeProvider(${me})`; await t.becomeProvider(me, true); }
      else if (k === 8) { const m = BigInt(1 + rnd(2000)) * E; action = `rigidRedeem(${me} vs ${other}, ${m / E})`; await t.rigidRedeem(me, other, m); }
      else if (k === 9) { await t.approveEUSD(other, t.lybra, (1n << 200n)); const v = BigInt(1 + rnd(5)) * E; action = `liquidate(keeper=${me}, provider=${other}, victim=${ACTORS[rnd(4)]}, ${v / E})`; await t.liquidate(me, other, ACTORS[rnd(4)], v); }
      else if (k === 10) { await t.approveEUSD(other, t.lybra, (1n << 200n)); const v = BigInt(1 + rnd(5)) * E; action = `superLiquidate(keeper=${me}, provider=${other}, ${v / E})`; await t.superLiquidate(me, other, ACTORS[rnd(4)], v); }
      else if (k === 11) { const m = BigInt(1 + rnd(500)) * E; action = `excessIncome(${me}, ${m / E})`; await t.excessIncome(me, m); }
      else { const dir = rnd(2), pct = BigInt(1 + rnd(30)); price = dir ? price * (100n + pct) / 100n : price * (100n - pct) / 100n; action = `price -> ${price / E}`; await t.setPrice(price); await t.stRebase(BigInt(rnd(50)) * E / 10n); t.ch.warp(3600 * (1 + rnd(72))); }
    } catch (e) { action += ` [revert: ${e.message}]`; }
    log.push(action);
    const s = await snapshot(t);
    if (check(s, step, action)) { violations++; console.log('   last 6 actions:'); log.slice(-6).forEach(a => console.log('     -', a)); if (violations > 3) break; }
  }
  const s = await snapshot(t);
  console.log('\n=== final ===');
  console.log('totalSupply   ', s.totalSupply / E, ' sum(borrowed)', s.borrowed / E);
  console.log('totalShares   ', s.totalShares / E);
  console.log('totalDeposited', s.totalDep / E, ' lybra stETH', s.lybraSt / E);
  console.log('violations:', violations);
})().catch(e => { console.error('ERR', e); process.exit(1); });
