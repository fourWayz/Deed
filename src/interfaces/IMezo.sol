// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Only the pieces of the MUSD system that Deed calls. Signatures match mezo-org/musd.

interface IBorrowerOperations {
    function openTrove(uint256 debtAmount, address upperHint, address lowerHint) external payable;
    function addColl(address upperHint, address lowerHint) external payable;
    function withdrawColl(uint256 amount, address upperHint, address lowerHint) external;
    function repayMUSD(uint256 amount, address upperHint, address lowerHint) external;
    function closeTrove() external;
    function claimCollateral() external;
    function minNetDebt() external view returns (uint256);
}

interface ITroveManager {
    function getTroveStatus(address borrower) external view returns (uint8);
    function getTroveColl(address borrower) external view returns (uint256);
    function getTrovePrincipal(address borrower) external view returns (uint256);
    function getTroveInterestRate(address borrower) external view returns (uint16);
    function getTroveDebt(address borrower) external view returns (uint256);
    function getCurrentICR(address borrower, uint256 price) external view returns (uint256);
    function checkRecoveryMode(uint256 price) external view returns (bool);
    function getEntireDebtAndColl(address borrower)
        external
        view
        returns (
            uint256 coll,
            uint256 principal,
            uint256 interest,
            uint256 pendingCollateral,
            uint256 pendingPrincipal,
            uint256 pendingInterest
        );
}

interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}

interface IMUSD {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
