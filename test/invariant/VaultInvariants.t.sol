// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "../Base.t.sol";
import {PositionVault} from "../../src/PositionVault.sol";

/// Drives random actions from random actors against a few vaults.
contract Handler is Base {
    PositionVault[] public vaults;
    uint256[] public ids;
    address[] public actors;

    // actions that succeeded for someone who was not the controller (must stay zero)
    uint256 public foreignSuccesses;
    uint256 public closes;
    // owner recorded when a Deed gets locked
    mapping(uint256 => address) public ownerAtLock;

    constructor() {
        super.setUp();
        actors.push(alice);
        actors.push(bob);
        actors.push(mallory);
        for (uint256 i; i < 3; ++i) {
            (uint256 id, PositionVault v) = _open(actors[i], 1 ether, 3_000e18);
            ids.push(id);
            vaults.push(v);
            _approveMUSD(actors[i], address(v));
            vm.prank(address(mezo));
            musd.mint(actors[i], 500e18);
        }
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    function _pick(uint256 seed) internal view returns (uint256 i, PositionVault v, address actor) {
        i = seed % vaults.length;
        v = vaults[i];
        actor = actors[(seed / 7) % actors.length];
    }

    function _check(PositionVault v, uint256 i, address actor, bool ok) internal {
        if (ok && deed.ownerOf(ids[i]) != actor) foreignSuccesses++;
    }

    function add(uint256 seed, uint256 amount) external {
        (uint256 i, PositionVault v, address actor) = _pick(seed);
        amount = bound(amount, 1, 1 ether);
        vm.prank(actor);
        try v.addCollateral{value: amount}(address(0), address(0)) {
            _check(v, i, actor, true);
        } catch {}
    }

    function withdraw(uint256 seed, uint256 amount) external {
        (uint256 i, PositionVault v, address actor) = _pick(seed);
        amount = bound(amount, 1, 1 ether);
        vm.prank(actor);
        try v.withdraw(amount, address(0), address(0)) {
            _check(v, i, actor, true);
        } catch {}
    }

    function repay(uint256 seed, uint256 amount) external {
        (uint256 i, PositionVault v, address actor) = _pick(seed);
        amount = bound(amount, 1, 1_000e18);
        vm.prank(actor);
        try v.repay(amount, address(0), address(0)) {
            _check(v, i, actor, true);
        } catch {}
    }

    function close(uint256 seed) external {
        (uint256 i, PositionVault v, address actor) = _pick(seed);
        vm.prank(actor);
        try v.close() {
            _check(v, i, actor, true);
            closes++;
        } catch {}
    }

    function transfer(uint256 seed, uint256 toSeed) external {
        (uint256 i,, address actor) = _pick(seed);
        address to = actors[toSeed % actors.length];
        vm.prank(actor);
        try deed.transferFrom(actor, to, ids[i]) {} catch {}
    }

    function lockToggle(uint256 seed) external {
        (uint256 i,,) = _pick(seed);
        if (deed.lockedBy(ids[i]) == address(0)) {
            vm.prank(venue);
            try deed.lock(ids[i]) {
                ownerAtLock[ids[i]] = deed.ownerOf(ids[i]);
            } catch {}
        } else {
            vm.prank(venue);
            deed.unlock(ids[i]);
        }
    }

    function time(uint256 dt) external {
        skip(bound(dt, 0, 30 days));
    }

    function price(uint256 p) external {
        mezo.setPrice(bound(p, 30_000e18, 150_000e18));
    }
}

contract VaultInvariantTest is Base {
    Handler h;

    function setUp() public override {
        h = new Handler();
        targetContract(address(h));
    }

    // the vault never keeps MUSD or BTC between calls
    function invariant_vaultHoldsNoAssets() public view {
        for (uint256 i; i < h.vaultCount(); ++i) {
            PositionVault v = h.vaults(i);
            assertEq(address(v).balance, 0, "btc");
            assertEq(h.musd().balanceOf(address(v)), 0, "musd");
        }
    }

    // only the Deed owner ever gets an action through
    function invariant_onlyDeedOwnerActs() public view {
        assertEq(h.foreignSuccesses(), 0);
    }

    // a closed vault has a closed trove and no collateral left in it
    function invariant_closedMeansEmpty() public view {
        for (uint256 i; i < h.vaultCount(); ++i) {
            PositionVault v = h.vaults(i);
            if (v.closed()) {
                (uint8 status, uint256 coll, uint256 principal,) = v.troveState();
                assertEq(status, 2);
                assertEq(coll, 0);
                assertEq(principal, 0);
            }
        }
    }

    // a locked Deed never changes hands except through its venue
    function invariant_lockedDeedStaysPut() public view {
        for (uint256 i; i < h.vaultCount(); ++i) {
            uint256 id = h.ids(i);
            if (h.deed().lockedBy(id) != address(0)) {
                assertEq(h.deed().ownerOf(id), h.ownerAtLock(id));
            }
        }
    }
}
