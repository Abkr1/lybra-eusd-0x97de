# PoC harness

Runs the repository's **actual** `contracts/*.sol` (compiled with solc `0.8.17`, optimizer 200
runs, EVM london — matching the verified deployment) inside a local `@ethereumjs/vm`. Mocks for
stETH and the Liquity price feed are grafted onto the hardcoded mainnet addresses the contract
calls, so no network and no fork are required.

```shell
npm install
node poc_forced_debt.js     # Finding 1: forced debt on a third party's collateral
node test_liq.js            # Finding 2: liquidation() with no rate floor -> bad debt
node test_mintcap.js        # Finding 4: the 10% per-account mint cap is bypassable
node fuzz.js [seed]         # 400-step random-action invariant fuzz
node test_sharemath.js      # share/rebase ratio edge cases (sound)
node test_excess.js         # excessIncomeDistribution is not extractable (sound)
```

`src/Mocks.sol` holds only the test doubles. Nothing under `contracts/` is modified.
