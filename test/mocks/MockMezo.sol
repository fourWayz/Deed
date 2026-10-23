// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockMUSD is ERC20 {
    address public minter;

    constructor() ERC20("Mock MUSD", "MUSD") {
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "not minter");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == minter, "not minter");
        _burn(from, amount);
    }
}

/// Stands in for BorrowerOperations, TroveManager and PriceFeed at once.
/// Debt, gas compensation, simple interest and the 110% floor follow mezo-org/musd.
contract MockMezo {
    uint256 public constant MCR = 1.1e18;
    uint256 public constant GAS_COMP = 200e18;
    uint256 public constant YEAR = 365 days;

    struct Trove {
        uint8 status; // 1 active, 2 closed, 3 liquidated
        uint256 coll;
        uint256 principal;
        uint256 interestOwed;
        uint256 lastUpdate;
        uint16 rate;
    }

    MockMUSD public immutable musd;
    uint256 public minNetDebt = 1800e18;
    uint256 public price = 80_000e18;
    uint16 public rate = 100;
    bool public recoveryMode;
    bool public stale;
    mapping(address => Trove) public troves;
    mapping(address => uint256) public surplus;

    constructor() {
        musd = new MockMUSD();
    }

    // --- test knobs ---

    function setPrice(uint256 p) external {
        price = p;
    }

    function setRate(uint16 r) external {
        rate = r;
    }

    function setStale(bool s) external {
        stale = s;
    }

    function setRecoveryMode(bool r) external {
        recoveryMode = r;
    }

    function liquidate(address who, uint256 surplusColl) external {
        Trove storage t = troves[who];
        require(t.status == 1, "not active");
        t.status = 3;
        surplus[who] = surplusColl;
        t.coll = 0;
        t.principal = 0;
        t.interestOwed = 0;
    }

    /// partial redemption: takes collateral and principal off a trove without the owner doing anything
    function redeem(address who, uint256 collOut, uint256 principalOut) external {
        Trove storage t = troves[who];
        require(t.status == 1, "not active");
        _accrue(t);
        t.coll -= collOut;
        t.principal -= principalOut;
    }

    // --- price feed ---

    function fetchPrice() external view returns (uint256) {
        require(!stale, "PriceFeed: Oracle is stale.");
        return price;
    }

    // --- borrower operations ---

    function openTrove(uint256 debtAmount, address, address) external payable {
        Trove storage t = troves[msg.sender];
        require(t.status != 1, "BorrowerOps: Trove is active");
        uint256 fee = recoveryMode ? 0 : debtAmount / 1000;
        uint256 net = debtAmount + fee;
        require(net >= minNetDebt, "BorrowerOps: Trove's net debt must be greater than minimum");
        uint256 composite = net + GAS_COMP;
        require(msg.value * price / composite >= MCR, "BorrowerOps: ICR < MCR");
        troves[msg.sender] = Trove(1, msg.value, composite, 0, block.timestamp, rate);
        musd.mint(msg.sender, debtAmount);
    }

    function addColl(address, address) external payable {
        Trove storage t = _active(msg.sender);
        _accrue(t);
        t.coll += msg.value;
    }

    function withdrawColl(uint256 amount, address, address) external {
        Trove storage t = _active(msg.sender);
        require(!recoveryMode, "BorrowerOps: Collateral withdrawal not permitted Recovery Mode");
        _accrue(t);
        t.coll -= amount;
        require(t.coll * price / (t.principal + t.interestOwed) >= MCR, "BorrowerOps: ICR < MCR");
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "send failed");
    }

    function repayMUSD(uint256 amount, address, address) external {
        Trove storage t = _active(msg.sender);
        _accrue(t);
        uint256 debt = t.principal + t.interestOwed;
        require(amount <= debt - GAS_COMP, "BorrowerOps: repay > debt");
        require(debt - GAS_COMP - amount >= minNetDebt, "BorrowerOps: Trove's net debt must be greater than minimum");
        uint256 toInterest = amount < t.interestOwed ? amount : t.interestOwed;
        t.interestOwed -= toInterest;
        t.principal -= amount - toInterest;
        musd.burn(msg.sender, amount);
    }

    function closeTrove() external {
        Trove storage t = _active(msg.sender);
        require(!recoveryMode, "BorrowerOps: Operation not permitted during Recovery Mode");
        _accrue(t);
        uint256 debt = t.principal + t.interestOwed;
        musd.burn(msg.sender, debt - GAS_COMP);
        uint256 coll = t.coll;
        t.status = 2;
        t.coll = 0;
        t.principal = 0;
        t.interestOwed = 0;
        (bool ok,) = msg.sender.call{value: coll}("");
        require(ok, "send failed");
    }

    function claimCollateral() external {
        uint256 amount = surplus[msg.sender];
        require(amount > 0, "no surplus");
        surplus[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "send failed");
    }

    // --- trove manager views ---

    function getTroveStatus(address who) external view returns (uint8) {
        return troves[who].status;
    }

    function getTroveColl(address who) external view returns (uint256) {
        return troves[who].coll;
    }

    function getTrovePrincipal(address who) external view returns (uint256) {
        return troves[who].principal;
    }

    function getTroveInterestRate(address who) external view returns (uint16) {
        return troves[who].rate;
    }

    function getTroveDebt(address who) public view returns (uint256) {
        Trove storage t = troves[who];
        return t.principal + t.interestOwed + _pending(t);
    }

    function getCurrentICR(address who, uint256 p) external view returns (uint256) {
        uint256 debt = getTroveDebt(who);
        if (debt == 0) return type(uint256).max;
        return troves[who].coll * p / debt;
    }

    function checkRecoveryMode(uint256) external view returns (bool) {
        return recoveryMode;
    }

    function getEntireDebtAndColl(address who) external view returns (uint256, uint256, uint256, uint256, uint256, uint256) {
        Trove storage t = troves[who];
        return (t.coll, t.principal, t.interestOwed + _pending(t), 0, 0, 0);
    }

    // --- internals ---

    function _active(address who) internal view returns (Trove storage t) {
        t = troves[who];
        require(t.status == 1, "BorrowerOps: Trove does not exist or is closed");
    }

    function _pending(Trove storage t) internal view returns (uint256) {
        if (t.status != 1) return 0;
        return t.principal * t.rate * (block.timestamp - t.lastUpdate) / (10_000 * YEAR);
    }

    function _accrue(Trove storage t) internal {
        t.interestOwed += _pending(t);
        t.lastUpdate = block.timestamp;
    }
}
