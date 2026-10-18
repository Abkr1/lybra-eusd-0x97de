# Lybra Finance V1 — eUSD security review

**Target:** `Lybra` at [`0x97de57ec338ab5d51557da3434828c5dbfada371`](https://etherscan.io/address/0x97de57ec338ab5d51557da3434828c5dbfada371) (Ethereum mainnet)
**Scope:** `contracts/Lybra.sol`, `contracts/EUSD.sol`, `contracts/Governable.sol`, `contracts/SafeMath.sol`, `contracts/IERC20.sol`
**Compiler:** solc `0.8.17+commit.8df45f5f`, optimizer 200 runs, EVM london (matches the verified deployment)
**Objective:** a critical-severity issue reachable by an *unprivileged* caller.

**Method.** Full manual read, then a local EVM harness (solc 0.8.17 + `@ethereumjs/vm`, with `MockLido`/`MockPriceFeed` grafted onto the hardcoded mainnet addresses) used for a 400-step invariant fuzz and five targeted PoCs. Two parallel surface reviews were run alongside; every finding from them was re-verified first-hand before inclusion, and one of their soundness claims corrected an error in my own initial reading (see `excessIncomeDistribution` below). No mainnet or testnet interaction.

## Bottom line

**There is an unprivileged critical, but only as a chain.** No single function on this contract yields one — the share/rebase ledger, payer binding and collateral conservation are individually sound, and the invariant runs back that. The critical comes from composing finding **#1** (anyone can open debt against a third party's collateral) with finding **#2** (`liquidation()` enforces no borrower rate floor), scaled by **#4** (the per-account mint cap is bypassable).

Composed, they give a repeatable, positive-EV theft from accounts that never opted into anything: for a **1 ETH** outlay an attacker forces an idle depositor to the 160% liquidation floor, waits for an ordinary 6.25% ETH move, and liquidates them. Measured end to end against a no-attack control on the same price path: **victim loses $44,973, attacker gains $46,843 — a 23.4x return on the outlay**, against a victim who had *zero* liquidation exposure before the attack manufactured it. See *Chained severity* below.

## Trust model used

- **Trusted (out of scope):** `gov` and every `onlyGov` setter; the `eslbrMinter` and `serviceFeePool` contracts gov installs; Lido stETH; the Liquity PriceFeed at `0x4c517D...01De`.
- **Attacker (in scope):** any unprivileged address, with flash liquidity available.
- **Payable impact:** theft of collateral or of other holders' eUSD, eUSD minted without backing, permanent freeze, insolvency.

---

## Findings

### 1. Anyone can force debt onto a third party's collateral — High standalone, **Critical chained**

`depositEtherToMint` (`Lybra.sol:190`) and `depositStETHToMint` (`Lybra.sol:221`) take a caller-chosen `onBehalfOf` and call `_mintEUSD(onBehalfOf, onBehalfOf, mintAmount)` (`Lybra.sol:205`, `Lybra.sol:233`). The debt lands on `onBehalfOf`, and the only guard is `_checkHealth(onBehalfOf)` (`Lybra.sol:532`), which merely requires the resulting rate to clear `safeCollateralRate` (160%). It never asks whether `onBehalfOf` consented.

So any account holding collateral can be pushed from an arbitrarily safe position down to the 160% floor by a stranger, for the price of the 1 ETH minimum deposit — which the attacker *gifts* into the victim's own collateral. This matters most for a pure depositor with zero debt: such an account has no liquidation exposure whatsoever (`liquidation` divides by `borrowed[onBehalfOf]` at `Lybra.sol:308` and reverts), and the attack manufactures that exposure from nothing.

Measured (`audit/poc/poc_forced_debt.js`, ETH $2000):

```
victim: 100 ETH collateral, 0 debt     -> liquidation() reverts, no exposure
attacker calls depositEtherToMint(victim, 126250e18) with 1 ETH
victim: 101 ETH collateral, 126,250 eUSD debt, rate = 160.00%
ETH -6.5% -> $1870: victim rate 149.60%, now below badCollateralRate
liquidation of 50% of collateral: victim loses 5.05 ETH to the 10% penalty
```

**Amplification — this is what makes the attack positive-EV.** In isolation the attacker is simply out 1 ETH. But forced debt inflates `totalEUSDCirculation`, and `_newFee()` (`Lybra.sol:587`) charges `mintFeeApy` against *circulation* while being settled out of the protocol's stETH yield, not out of any borrower's balance. That fee is paid to `serviceFeePool` inside `excessIncomeDistribution` (`Lybra.sol:438`, `Lybra.sol:455`) — i.e. it comes out of the rebase that would otherwise go to eUSD holders. Force-minting against strangers' idle collateral therefore redirects yield from all eUSD holders to LBR stakers, and an attacker who stakes LBR captures their share of it. The forced $59,583 above redirects $59,583 x 1.5% / 365 = **$2.45/day** for a one-time $2,000 outlay. That is a thin return on permanently-gifted capital, so I would present this as the mechanism rather than as a large claim — but it is what takes the finding from "attacker-negative griefing" to a real, if marginal, incentive.

**Limits, stated honestly.** The victim is handed the minted eUSD, so their net worth does not drop at the moment of the attack, and an EOA can undo the whole thing with `burn(self, debt)` — verified in the PoC. The loss only crystallises if the price falls before they notice. The attacker also forfeits the 1 ETH on every attempt, which makes repeated pinning expensive. That is why this is High and not Critical. It is materially worse for a *contract* depositor with no code path to repay: for those the forced position cannot be unwound at all.

**Fix.** Credit the debt to `msg.sender`, or require that `onBehalfOf == msg.sender` whenever `mintAmount > 0`. Deposits on behalf of others are safe; *minting* on behalf of others is not.

### 2. `liquidation()` enforces no rate floor and no overall-rate guard — Medium/High standalone, **critical path for the chain**

`liquidation()` (`Lybra.sol:302`) requires only that the borrower is under 150% (`Lybra.sol:311`) and that at most 50% of collateral is taken (`Lybra.sol:316`). Its own NatSpec at `Lybra.sol:294` states the precondition *"When overallCollateralRate is above 150%"* — **that is never checked**. `superLiquidation` does guard its regime (`Lybra.sol:365`); `liquidation` guards nothing.

Because `eusdAmount = etherAmount * etherPrice / 1e18` (`Lybra.sol:320`) while `reducedEther = etherAmount * 11 / 10` (`Lybra.sol:327`), the liquidator always pays exactly 90.909% of the USD value of the stETH that leaves. While the borrower has equity, that 10% is theirs to lose. Once they are underwater it comes straight out of the protocol's backing — and since the post-call rate falls further whenever the starting rate is under ~110%, the position can be iterated down to zero collateral in a single transaction.

Measured (`audit/poc/test_liq.js`, 55% crash to $900, overall rate kept healthy so `superLiquidation` stays locked out):

```
victim rate 72%, equity already negative
25 iterations of liquidation(), each seizing 55% of the remainder
-> victim collateral 0 ETH, debt $43,181 left standing with zero collateral behind it
-> net to attacker (provider+keeper): $8,181
```

Requires a deep crash that an attacker cannot manufacture, and a fixed-bonus liquidation without a bad-debt backstop behaves this way by construction — hence Medium/High rather than higher. The specific defect is the missing guard that the function's own documentation claims.

### 3. Liquidation allowances are checked but never consumed — Low/Medium

`Lybra.sol:321` and `Lybra.sol:385` require `allowance(provider, address(this)) >= eusdAmount`, but `_repay` burns the provider's shares directly (`Lybra.sol:552`) and the allowance is never decremented. A one-time approval is therefore an unbounded, permanent, reusable authorization that any keeper may draw on at any time, for any amount up to the provider's balance.

I checked whether this is drainable and it is not: the provider receives 1.1× what they pay in `liquidation`, and in `superLiquidation` the discount at `Lybra.sol:382` keeps them at break-even or better in every branch. The exposure is loss of control over *when* and *how much* of their position is deployed, not loss of value — so this is a Low/Medium design flaw, not the "unbound payer" drain it superficially resembles.

### 4. The 10% per-account mint cap is bypassable — Low

The cap at `Lybra.sol:274` lives only in `mint()`. The deposit paths reach `_mintEUSD` directly and skip it. Verified (`audit/poc/test_mintcap.js`): `mint(5,000,000)` reverts with *"Mint Amount cannot be more than 10% of total circulation"*, while `depositEtherToMint(self, 5,000,000)` succeeds on the same account and leaves it holding 31% of circulation. The check is also mis-specified — it tests total `borrowed[msg.sender]`, not the amount being minted.

### 5. stETH dust can temporarily brick `excessIncomeDistribution` — Low

`Lybra.sol:430` computes `lido.balanceOf(address(this)) - totalDepositedEther`. stETH transfers can deliver 1–2 wei less than requested while `depositedEther` is credited the full amount (`Lybra.sol:230`), so the balance can sit marginally below the ledger and this subtraction underflows, reverting the whole function. The fuzzer hit this at a 1-wei deficit. Self-heals as staking yield accrues.

---

## Chained severity

I tested four chains (`audit/poc/test_chains.js`, `audit/poc/test_chain_pnl.js`). One lands, one is a minor amplifier, two do not compose.

### Chain A — #1 + #2 (+ #4): **Critical**

Standalone, #1 looks survivable: the victim receives the eUSD and the attacker is out 1 ETH. That reading is wrong once #2 is in the picture. #1 does not merely create leverage — it **manufactures liquidatable volume out of collateral the attacker does not own**, and #2 is the mechanism that monetises it at a fixed 10% bonus with no rate floor.

The attacker pre-positions and waits. Forced debt persists until the victim notices and calls `burn`, and an account that only ever deposited collateral has no reason to be watching and receives no notification. Any 6.25% dip then springs the trap.

Measured, against a control run on the identical price path:

```
victim: 500 ETH collateral, zero debt, no approvals, no liquidation exposure
attacker: depositEtherToMint(victim, 625000e18) with 1 ETH   -> victim pinned at 160.00%
ETH -6.5% (routine)                                          -> victim at 149.60%, liquidatable
liquidation of 50% of collateral
  control net worth @ $1870 : $935,000
  attacked net worth @ $1870: $890,026
  VICTIM LOSS               : $44,973
  ATTACKER GAIN             : $46,843   on a $2,000 outlay = 23.4x
```

Scaling is limited only by how much idle collateral is deposited; #4 removes the per-account cap that would otherwise throttle it. Across six idle depositors the attacker turned $12,000 into $281,061, and compressed the protocol-wide collateral rate from 2800% to 207.70% in the process.

**This is the unprivileged critical.** Direct theft of user funds, repeatable, positive-EV, against non-consenting third parties. The only precondition the attacker does not control is a 6.25% move — which is routine, not exotic.

### Chain B — #3 removes the capital requirement: minor amplifier

Chain A as written needs the attacker to hold enough eUSD to fund the liquidation. #3 removes that: because `allowance(provider, address(this))` is checked but never decremented, an attacker with **zero capital** can name any address that has ever approved Lybra as the funder. Verified: an attacker holding 0 eUSD and 0 stETH extracted 0.5 stETH ($935) by drafting a third party's standing allowance, which was unchanged afterwards and remains reusable forever. This only yields the keeper cut (~0.9%) rather than the 10% bonus, so it lowers the barrier to entry rather than raising the take.

### Chain C — cascading liquidation to unlock `superLiquidation`: **does not compose**

I expected mass liquidation to drag the overall rate under the 150% `superLiquidation` gate, since each call removes 1.1x collateral per 1x debt. It does not. That ratio only *lowers* the system-wide rate when the overall rate is already below 110%; above it, liquidation **raises** it. Measured: after liquidating all six victims the overall rate went *up*, 194.20% -> 994.80%, and the `superLiquidation` gate stayed shut. `superLiquidation` remains reachable only in a genuine systemic crisis, and it is backing-neutral in every branch anyway.

### Chain D — fee redirection at scale: real but hard-capped at ~27%

Forced debt inflates `totalEUSDCirculation` without adding collateral, so it inflates `_newFee()` and redirects yield from eUSD holders to LBR stakers. The terminal "eUSD holders get zero rebase forever" state is **not reachable**: minting requires 160% backing, so the aggregate satisfies `V/T >= 1.6`, and the diverted fraction is bounded by `1.5% / (1.6 x stETH yield)` ~ 27% at a 3.5% staking yield. An attacker running Chain A at scale moves that fraction from ~2% toward its ~27% ceiling — a real degradation of eUSD's core value proposition, but not a shutoff.

### Chain E — sustained DoS via #5: **does not compose**

The stETH dust deficit cannot be maintained. Inducing it costs roughly a full ether of locked capital per 2 wei of shortfall, against a daily Lido rebase measured in whole ETH. It heals faster than any attacker can widen it.

---

## Verified sound

| Area | What makes it safe |
|---|---|
| Share/rebase ledger | 400-step random-action fuzz holds `sum(shares) == totalShares`, `sum(borrowed) == totalEUSDCirculation`, `sum(depositedEther) == totalDepositedEther` with zero drift |
| `_mintEUSD` zero-fallback (`Lybra.sol:521`) | Conflates "supply is zero" with "rounded to zero", but R = T/S only moves via `excessIncomeDistribution` and stays within ~1.0007 of 1; the fallback is reachable only for sub-wei mints |
| `_repay` missing fallback (`Lybra.sol:551`) | Clears at most R−1 wei of debt per call; not amplifiable |
| Stale-share resurrection | `totalShares` and `totalEUSDCirculation` reach zero together; no state with shares outstanding against zero supply |
| Payer binding | Every path binds the payer to `msg.sender`; the only caller-supplied payer is the liquidation `provider`, gated by allowance (see #3) |
| `excessIncomeDistribution` | No extraction: calling is *strictly dominated* by waiting. Measured on a 50% holder — calling nets +$44,444, staying passive nets +$55,556, so the caller is $11,111 worse off for calling. A caller spending their whole balance breaks even to the wei. The real consequence is a design nit, not a vulnerability: nobody has an incentive to call it, so yield distribution relies on an altruistic or protocol-run keeper |
| `rigidRedemption` | Provider's rate strictly improves; the 100% gate at `Lybra.sol:493` makes the collateral debit underflow-free |
| Fee accrual | `_saveReport()` banks fees at the pre-change supply on both mint and repay; no inflation vector found |
| `SafeMath` / `Governable` | Stock OZ 0.8 checked math and a standard single-role owner; no planted modification, no `unchecked` blocks in either contract |
| Collateral ledger pairing | `totalDepositedEther` and `depositedEther[...]` are written together at all six sites (`Lybra.sol:201/202, 230/231, 252/253, 328/329, 392/393, 500/501`); no desync |
| Reentrancy | The only external calls are to stETH, the Liquity feed, `eslbrMinter` and `serviceFeePool` — all trusted. No attacker-controlled callback exists on any path |

## Residual leads

- **Deployed-vs-source drift** was not ruled out: Sourcify and Etherscan are blocked from this environment, so I could not diff this mirror against the on-chain bytecode. Worth closing with `getsourcecode` from a networked host.
- **The eslbrMinter/serviceFeePool contracts are out of scope here** but are called on every mint and repay (`Lybra.sol:525`, `Lybra.sol:554`). Read-only reentrancy against third-party integrators reading `balanceOf` mid-`_repay` — between `_burnShares` and the `totalEUSDCirculation` decrement — is worth a look if those contracts come into scope.
- `setRedemptionFee(uint8)` (`Lybra.sol:153`) bounds a `uint8` by `<= 500`, which is vacuous. Gov-only, so not payable, but the cap is not the 5% the string claims.
- **`burn(onBehalfOf, amount)`** (`Lybra.sol:288`) lets anyone retire a third party's debt at their own expense. It improves the victim's ratio and the attacker pays full price, so there is no solvency impact — noted only to complete the `onBehalfOf` enumeration.

## Conclusion

The core ledger is sound and I could not find an unprivileged path to theft, unbacked minting, or freeze. The real defect is authorization, not arithmetic: `depositEtherToMint`/`depositStETHToMint` mint debt for an address that never agreed to it. I would submit #1 as High with the PoC above, and #2 as the supporting Medium/High. I would not submit #3–#5 as standalone paid findings.

**Reproduce:** `node audit/poc/<script>.js` after `npm install` in `audit/poc/` — see `audit/poc/README.md`.
