const { compile, enc, Chainlet } = require('./lib');

const LIDO = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
const FEED = '0x4c517D4e2C851CA76d7eC94B805269Df0f2201De';
const E = 10n ** 18n;
const A = n => '0x' + n.toString(16).padStart(40, '0').replace(/(.)/, '$1'); // simple addr
const addr = n => '0x' + n.toString(16).padStart(40, '0');

async function setup({ price = 2000n * E } = {}) {
  const c = compile();
  const ch = await Chainlet.create();
  
  const deployer = addr(0x9000);
  await ch.fund(deployer, 10n ** 27n);

  // mocks grafted onto the hardcoded mainnet addresses
  const lidoTmp = await ch.deploy(c.MockLido, deployer);
  await ch.graft(lidoTmp, LIDO);
  const feedTmp = await ch.deploy(c.MockPriceFeed, deployer);
  await ch.graft(feedTmp, FEED);
  await ch.call(deployer, FEED, enc('setPrice(uint256)', [price]));

  const lybra = await ch.deploy(c.Lybra, deployer);
  const minter = await ch.deploy(c.MockMinter, deployer);
  const pool = await ch.deploy(c.MockFeePool, deployer);
  await ch.call(deployer, lybra, enc('setESLBRMinter(address)', [minter]));
  await ch.call(deployer, lybra, enc('setLbrStakingPool(address)', [pool]));

  const api = {
    ch, c, lybra, pool, minter, deployer, LIDO, FEED,
    addr,
    async fund(a, wei) { await ch.fund(a, wei); },
    async setPrice(p) { await ch.call(deployer, FEED, enc('setPrice(uint256)', [p])); },
    async price() { return ch.view(FEED, enc('fetchPrice()')); },
    // stETH
    async stMint(to, amt) { await ch.call(deployer, LIDO, enc('mintTo(address,uint256)', [to, amt])); },
    async stRebase(add) { await ch.call(deployer, LIDO, enc('rebase(uint256)', [add])); },
    async stBal(a) { return ch.view(LIDO, enc('balanceOf(address)', [a])); },
    async stApprove(from, sp, amt) { await ch.call(from, LIDO, enc('approve(address,uint256)', [sp, amt])); },
    // lybra
    async depositEther(from, onBehalfOf, mintAmount, value) {
      return ch.call(from, lybra, enc('depositEtherToMint(address,uint256)', [onBehalfOf, mintAmount]), value);
    },
    async depositStETH(from, onBehalfOf, stAmt, mintAmount) {
      return ch.call(from, lybra, enc('depositStETHToMint(address,uint256,uint256)', [onBehalfOf, stAmt, mintAmount]));
    },
    async mint(from, onBehalfOf, amt) { return ch.call(from, lybra, enc('mint(address,uint256)', [onBehalfOf, amt])); },
    async burn(from, onBehalfOf, amt) { return ch.call(from, lybra, enc('burn(address,uint256)', [onBehalfOf, amt])); },
    async withdraw(from, onBehalfOf, amt) { return ch.call(from, lybra, enc('withdraw(address,uint256)', [onBehalfOf, amt])); },
    async approveEUSD(from, sp, amt) { return ch.call(from, lybra, enc('approve(address,uint256)', [sp, amt])); },
    async liquidate(from, provider, onBehalfOf, etherAmount) {
      return ch.call(from, lybra, enc('liquidation(address,address,uint256)', [provider, onBehalfOf, etherAmount]));
    },
    async superLiquidate(from, provider, onBehalfOf, etherAmount) {
      return ch.call(from, lybra, enc('superLiquidation(address,address,uint256)', [provider, onBehalfOf, etherAmount]));
    },
    async becomeProvider(from, b) { return ch.call(from, lybra, enc('becomeRedemptionProvider(bool)', [b])); },
    async rigidRedeem(from, provider, amt) { return ch.call(from, lybra, enc('rigidRedemption(address,uint256)', [provider, amt])); },
    async excessIncome(from, payAmount) { return ch.call(from, lybra, enc('excessIncomeDistribution(uint256)', [payAmount])); },
    async transferEUSD(from, to, amt) { return ch.call(from, lybra, enc('transfer(address,uint256)', [to, amt])); },
    // views
    async eusdBal(a) { return ch.view(lybra, enc('balanceOf(address)', [a])); },
    async sharesOf(a) { return ch.view(lybra, enc('sharesOf(address)', [a])); },
    async borrowed(a) { return ch.view(lybra, enc('getBorrowedOf(address)', [a])); },
    async deposited(a) { return ch.view(lybra, enc('depositedEther(address)', [a])); },
    async totalShares() { return ch.view(lybra, enc('getTotalShares()')); },
    async totalSupply() { return ch.view(lybra, enc('totalSupply()')); },
    async totalDeposited() { return ch.view(lybra, enc('totalDepositedEther()')); },
    async feeStored() { return ch.view(lybra, enc('feeStored()')); },
  };
  return api;
}
module.exports = { setup, E, addr, LIDO, FEED };
