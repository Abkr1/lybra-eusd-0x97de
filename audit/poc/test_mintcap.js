const { setup, E, addr } = require('./harness');
const W = addr(0x77), X = addr(0x88);
(async () => {
  const t = await setup({ price: 2000n * E });
  for (const a of [W, X]) { await t.fund(a, 10n ** 26n); }
  // build circulation above the 10_000_000 eUSD threshold that arms the cap
  await t.depositEther(W, W, 11000000n * E, 20000n * E);
  console.log('totalSupply:', (await t.totalSupply()) / E, 'eUSD (cap is armed above 10,000,000)');

  console.log('\nmint() path - tries to take >10% of circulation as one account:');
  await t.depositEther(X, X, 0, 5000n * E);                      // 5000 ETH collateral, no debt yet
  try { await t.mint(X, X, 5000000n * E); console.log('  mint(5,000,000) SUCCEEDED'); }
  catch (e) { console.log('  mint(5,000,000) ->', e.message); }

  console.log('\ndepositEtherToMint() path - same economic action, same account:');
  try {
    await t.depositEther(X, X, 5000000n * E, 1n * E);
    console.log('  depositEtherToMint(mint 5,000,000) SUCCEEDED');
    console.log('  borrowed[X] =', (await t.borrowed(X)) / E, 'eUSD =',
      Number((await t.borrowed(X)) * 100n / (await t.totalSupply())), '% of circulation');
    console.log('  -> the 10% per-account cap in mint() (Lybra.sol:274-277) is not applied on the deposit paths');
  } catch (e) { console.log('  ->', e.message); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
