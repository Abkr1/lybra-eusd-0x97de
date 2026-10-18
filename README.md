# Lybra eUSD — 0x97de57ec338ab5d51557da3434828c5dbfada371

Extracted verified source for the **Lybra Finance eUSD token** on **Ethereum mainnet**.

- **Address:** [`0x97de57ec338ab5d51557da3434828c5dbfada371`](https://etherscan.io/address/0x97de57ec338ab5d51557da3434828c5dbfada371)
- **Chain ID:** 1 (Ethereum mainnet)
- **Contract name:** `Lybra` (`contracts/Lybra.sol`, inherits `EUSD` + `Governable`)
- **Token:** eUSD (interest-bearing, rebasing ERC20-like)
- **Compiler:** Solidity `0.8.17+commit.8df45f5f`, optimizer enabled (200 runs), EVM `london` (default)
- **Verification:** exact match on Etherscan / Sourcify
- **Deployer:** [Lybra Finance: Deployer `0x4c27e9d22ad33a53c700ebef04521e1696899cca`](https://etherscan.io/address/0x4c27e9d22ad33a53c700ebef04521e1696899cca)
- **Source of this repo:** Sourcify v2 API (`stdJsonInput` + `abi`), paths preserved under `contracts/`

This repo is a mirror for reading / auditing / reuse. It is **not** the upstream Lybra repo.

## Layout

```
lybra-eusd-0x97de/
  contracts/
    Lybra.sol      # main deployed contract (is EUSD, Governable)
    EUSD.sol       # rebasing token logic (abstract, _getTotalMintedEUSD overridden in Lybra)
    Governable.sol
    IERC20.sol
    SafeMath.sol
  abi.json
  foundry.toml     # solc 0.8.17, optimizer 200 runs, evm london, src = contracts/
```

## Notes

- One-byte encoding fix in `contracts/Lybra.sol` vs the Sourcify bundle: a Windows-1252 right-single-quote (`0x92`) in a comment ("user's collateral rate") was normalized to ASCII `'` so the file is valid UTF-8 and compiles with solc. No logic changed.

## Build

Requires [Foundry](https://book.getfoundry.sh/).

```shell
forge build
```

## Test

No tests are vendored (the verified bundle contains only deployment sources). Add your own under `test/`:

```shell
forge test
```

## License

- `contracts/Lybra.sol`, `EUSD.sol`, `IERC20.sol`, `SafeMath.sol`: `SPDX-License-Identifier: BUSL-1.1` (preserved per file).
- `contracts/Governable.sol`: `SPDX-License-Identifier: GPL-3.0` (preserved).
- No new license grant is made by this mirror; check the upstream Lybra project for terms.
