// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Base} from "./Base.t.sol";
import {DeedMarket} from "../src/DeedMarket.sol";
import {DeedFactory} from "../src/DeedFactory.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {ITroveManager, IPriceFeed, IMUSD} from "../src/interfaces/IMezo.sol";

/// ERC20 that calls out during a transfer, the way a hook token would.
contract EvilToken is ERC20 {
    address public hookTarget;
    bytes public hookData;
    bool public armed;
    bool public hookRan;
    bool public hookOk;
    bytes4 public hookSelector;

    constructor() ERC20("Evil", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target, bytes calldata data) external {
        hookTarget = target;
        hookData = data;
        armed = true;
        hookRan = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from != address(0) && to != address(0)) {
            armed = false;
            hookRan = true;
            (bool ok, bytes memory ret) = hookTarget.call(hookData);
            hookOk = ok;
            if (!ok && ret.length >= 4) hookSelector = bytes4(ret);
        }
    }
}

/// Seller that tries to claim twice from inside the payout.
contract EvilSeller {
    DeedMarket public market;
    bool public reenterOk;
    bytes4 public reenterSelector;

    constructor(DeedMarket m) {
        market = m;
    }

    function openAndList(DeedFactory f, uint256 debt, uint256 price, uint256 minICR) external payable returns (uint256 id) {
        (id,) = f.createPosition{value: msg.value}(debt, address(0), address(0));
        market.list(id, price, uint64(block.timestamp + 1 days), minICR);
    }

    function claim() external {
        market.claim();
    }

    function reenter() external {
        try market.claim() {
            reenterOk = true;
        } catch (bytes memory ret) {
            if (ret.length >= 4) reenterSelector = bytes4(ret);
        }
    }

    receive() external payable {}
}

/// Controller that tries to call back into its vault when it gets BTC.
contract EvilController {
    PositionVault public vault;
    bool public reentered;
    bytes4 public selector;
    uint8 public mode;

    function setVault(PositionVault v) external {
        vault = v;
    }

    function open(DeedFactory f, uint256 debt) external payable returns (uint256 id, PositionVault v) {
        address vaultAddr;
        (id, vaultAddr) = f.createPosition{value: msg.value}(debt, address(0), address(0));
        v = PositionVault(payable(vaultAddr));
        vault = v;
    }

    function withdraw(uint256 amount, uint8 mode_) external {
        mode = mode_;
        vault.withdraw(amount, address(0), address(0));
    }

    receive() external payable {
        if (address(vault) == address(0) || msg.sender != address(vault)) return;
        bytes memory call_;
        if (mode == 1) call_ = abi.encodeCall(PositionVault.withdraw, (1, address(0), address(0)));
        else if (mode == 2) call_ = abi.encodeCall(PositionVault.close, ());
        else if (mode == 3) call_ = abi.encodeCall(PositionVault.claimSurplus, ());
        else return;
        (bool ok, bytes memory ret) = address(vault).call(call_);
        reentered = ok;
        if (!ok && ret.length >= 4) selector = bytes4(ret);
    }
}

contract MarketReentrancyTest is Base {
    DeedMarket market;
    EvilToken evil;
    uint256 id;
    PositionVault vault;

    uint256 constant PRICE = 5_000e18;
    uint256 constant MIN_ICR = 2e18;

    function _init() internal override {
        evil = new EvilToken();
        market = new DeedMarket(
            deed, factory, ITroveManager(address(mezo)), IPriceFeed(address(mezo)), IMUSD(address(evil))
        );
        deed.init(address(factory), address(market), address(0xA11C));
    }

    function setUp() public override {
        super.setUp();
        (id, vault) = _open(alice, COLL, DEBT);
        evil.mint(bob, 50_000e18);
        vm.prank(bob);
        evil.approve(address(market), type(uint256).max);
        vm.prank(alice);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
    }

    function _buyWithHook(bytes memory data) internal {
        evil.arm(address(market), data);
        bytes32 snap = market.snapshot(vault, MIN_ICR);
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        assertTrue(evil.hookRan(), "hook did not fire");
        assertFalse(evil.hookOk(), "reentrant call went through");
        assertEq(evil.hookSelector(), DeedMarket.Reentrancy.selector);
        // the sale itself finished normally, exactly once
        assertEq(deed.ownerOf(id), bob);
        assertEq(market.claimable(alice), PRICE);
        assertEq(evil.balanceOf(address(market)), PRICE);
    }

    function test_tokenReentersBuy() public {
        _buyWithHook(abi.encodeCall(DeedMarket.buy, (id, bytes32(0), PRICE)));
    }

    function test_tokenReentersCancel() public {
        _buyWithHook(abi.encodeCall(DeedMarket.cancel, (id)));
    }

    function test_tokenReentersClaim() public {
        _buyWithHook(abi.encodeCall(DeedMarket.claim, ()));
    }

    function test_tokenReentersList() public {
        _buyWithHook(abi.encodeCall(DeedMarket.list, (id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR)));
    }

    function test_maliciousSeller_cannotClaimTwice() public {
        EvilSeller seller = new EvilSeller(market);
        vm.deal(address(seller), 1 ether);
        uint256 id2 = seller.openAndList{value: 0.1 ether}(factory, 2_000e18, PRICE, MIN_ICR);
        PositionVault v2 = PositionVault(payable(factory.vaultOf(id2)));

        bytes32 snap2 = market.snapshot(v2, MIN_ICR);
        vm.prank(bob);
        market.buy(id2, snap2, PRICE);
        assertEq(market.claimable(address(seller)), PRICE);

        // another seller's money sits in the market too, a double claim would eat into it
        uint256 marketBefore = evil.balanceOf(address(market));
        evil.arm(address(seller), abi.encodeCall(EvilSeller.reenter, ()));
        seller.claim();

        assertTrue(evil.hookRan());
        assertFalse(seller.reenterOk());
        assertEq(seller.reenterSelector(), DeedMarket.Reentrancy.selector);
        assertEq(evil.balanceOf(address(seller)), PRICE);
        assertEq(marketBefore - evil.balanceOf(address(market)), PRICE);
        assertEq(market.claimable(address(seller)), 0);
    }

    function test_noClaimOnSomeoneElsesProceeds() public {
        bytes32 snap = market.snapshot(vault, MIN_ICR);
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        vm.prank(mallory);
        vm.expectRevert(DeedMarket.NothingToClaim.selector);
        market.claim();
        assertEq(market.claimable(alice), PRICE);
    }

    // --- receiver side: the vault pays out BTC to a contract ---

    function test_vault_blocksReenterOnWithdraw() public {
        EvilController c = new EvilController();
        vm.deal(address(c), 1 ether);
        (, PositionVault v2) = c.open{value: 0.5 ether}(factory, 3_000e18);

        uint256 before = address(c).balance;
        c.withdraw(0.01 ether, 1);
        assertFalse(c.reentered());
        assertEq(c.selector(), PositionVault.Reentrancy.selector);
        assertEq(address(c).balance, before + 0.01 ether);
        assertEq(address(v2).balance, 0);
    }

    function test_vault_blocksReenterOnClaimSurplus() public {
        EvilController c = new EvilController();
        vm.deal(address(c), 1 ether);
        (, PositionVault v2) = c.open{value: 0.5 ether}(factory, 3_000e18);
        c.withdraw(0.01 ether, 3);
        assertFalse(c.reentered());
        assertEq(c.selector(), PositionVault.Reentrancy.selector);
        assertEq(address(v2).balance, 0);
    }
}
