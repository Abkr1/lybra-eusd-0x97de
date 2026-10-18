// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// Minimal stETH stand-in. Share-based like real stETH so `rebase` lifts every balance.
contract MockLido {
    uint256 public totalPooled;
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function balanceOf(address a) public view returns (uint256) {
        if (totalShares == 0) return 0;
        return (sharesOf[a] * totalPooled) / totalShares;
    }

    function _sharesFor(uint256 amt) internal view returns (uint256) {
        if (totalPooled == 0) return amt;
        return (amt * totalShares) / totalPooled;
    }

    function submit(address) external payable returns (uint256) {
        uint256 s = _sharesFor(msg.value);
        if (totalShares == 0) s = msg.value;
        totalShares += s;
        totalPooled += msg.value;
        sharesOf[msg.sender] += s;
        return s;
    }

    /// free mint for test setup
    function mintTo(address to, uint256 amt) external {
        uint256 s = _sharesFor(amt);
        if (totalShares == 0) s = amt;
        totalShares += s;
        totalPooled += amt;
        sharesOf[to] += s;
    }

    /// simulate staking yield: every holder's balance grows pro-rata
    function rebase(uint256 addPooled) external { totalPooled += addPooled; }

    function transfer(address to, uint256 amt) public returns (bool) {
        uint256 s = _sharesFor(amt);
        require(sharesOf[msg.sender] >= s, "stETH: balance");
        sharesOf[msg.sender] -= s;
        sharesOf[to] += s;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amt, "stETH: allowance");
        allowance[from][msg.sender] = a - amt;
        uint256 s = _sharesFor(amt);
        require(sharesOf[from] >= s, "stETH: balance");
        sharesOf[from] -= s;
        sharesOf[to] += s;
        return true;
    }

    function approve(address sp, uint256 amt) external returns (bool) {
        allowance[msg.sender][sp] = amt;
        return true;
    }
}

contract MockPriceFeed {
    uint256 public price = 2000e18;
    function setPrice(uint256 p) external { price = p; }
    function fetchPrice() external view returns (uint256) { return price; }
}

contract MockMinter {
    function refreshReward(address) external {}
}

contract MockFeePool {
    uint256 public notified;
    function notifyRewardAmount(uint256 amount) external { notified += amount; }
}
