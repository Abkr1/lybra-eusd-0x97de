const fs = require('fs'), path = require('path');
const solc = require('solc');
const { VM } = require('@ethereumjs/vm');
const { Common, Chain, Hardfork } = require('@ethereumjs/common');
const { Block } = require('@ethereumjs/block');
const { Address, Account, hexToBytes, bytesToHex } = require('@ethereumjs/util');
const { keccak256 } = require('ethereum-cryptography/keccak');
const { utf8ToBytes } = require('ethereum-cryptography/utils');

// Compile the repository's real contracts (../../contracts) plus the local mocks.
const CONTRACTS = path.join(__dirname, '..', '..', 'contracts');
const MOCKS = path.join(__dirname, 'src');

function compile() {
  const sources = {};
  for (const dir of [CONTRACTS, MOCKS])
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sol')))
      sources[f] = { content: fs.readFileSync(path.join(dir, f), 'utf8') };
  const input = {
    language: 'Solidity', sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'london',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter(e => e.severity === 'error');
  if (errs.length) { console.error(errs.map(e => e.formattedMessage).join('\n')); throw new Error('compile failed'); }
  const byName = {};
  for (const file of Object.keys(out.contracts || {}))
    for (const name of Object.keys(out.contracts[file]))
      byName[name] = out.contracts[file][name];
  return byName;
}

const sel = sig => bytesToHex(keccak256(utf8ToBytes(sig))).slice(2, 10);
const pad = v => BigInt(v).toString(16).padStart(64, '0');
const padAddr = a => (typeof a === 'string' ? a : a.toString()).toLowerCase().replace(/^0x/, '').padStart(64, '0');
function enc(sig, args = []) {
  const types = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')).split(',').filter(Boolean);
  let d = sel(sig);
  args.forEach((a, i) => { d += types[i] === 'address' ? padAddr(a) : pad(typeof a === 'boolean' ? (a ? 1 : 0) : a); });
  return '0x' + d;
}
const GAS = 30000000n;

class Chainlet {
  constructor(vm) { this.vm = vm; this.nonce = 0; this.ts = 1700000000n; }
  _blk() { return Block.fromBlockData({ header: { timestamp: this.ts, number: 1n } }, { common: this.vm.common, skipConsensusFormatValidation: true }); }
  warp(sec) { this.ts += BigInt(sec); }
  static async create() {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai });
    const vm = await VM.create({ common });
    return new Chainlet(vm);
  }
  async fund(addr, wei) {
    const a = Address.fromString(addr);
    const acc = (await this.vm.stateManager.getAccount(a)) || new Account();
    acc.balance += BigInt(wei);
    await this.vm.stateManager.putAccount(a, acc);
  }
  async deploy(artifact, caller, value = 0n, argsHex = '') {
    const res = await this.vm.evm.runCall({
      caller: Address.fromString(caller), to: undefined, gasLimit: GAS, value: BigInt(value),
      data: hexToBytes('0x' + artifact.evm.bytecode.object + argsHex), isStatic: false, block: this._blk(),
    });
    if (res.execResult.exceptionError) throw new Error('deploy: ' + res.execResult.exceptionError.error);
    return res.createdAddress.toString();
  }
  /** place a deployed contract's runtime code at a hardcoded address */
  async graft(fromAddr, toAddr) {
    const code = await this.vm.stateManager.getContractCode(Address.fromString(fromAddr));
    await this.vm.stateManager.putAccount(Address.fromString(toAddr), new Account());
    await this.vm.stateManager.putContractCode(Address.fromString(toAddr), code);
  }
  async call(caller, to, dataHex, value = 0n) {
    const res = await this.vm.evm.runCall({
      caller: Address.fromString(caller), to: Address.fromString(to), gasLimit: GAS,
      value: BigInt(value), data: hexToBytes(dataHex), isStatic: false, block: this._blk(),
    });
    const rd = bytesToHex(res.execResult.returnValue);
    if (res.execResult.exceptionError) {
      let reason = res.execResult.exceptionError.error;
      if (rd.startsWith('0x08c379a0')) {
        const len = parseInt(rd.slice(10 + 64, 10 + 128), 16);
        reason = Buffer.from(rd.slice(10 + 128, 10 + 128 + len * 2), 'hex').toString();
      }
      const e = new Error(reason); e.reverted = true; throw e;
    }
    return rd;
  }
  async view(to, dataHex) { return BigInt(await this.call('0x' + '11'.repeat(20), to, dataHex) || '0x0'); }
  async setTime(ts) { this.time = ts; }
}
module.exports = { compile, enc, sel, Chainlet, GAS };
