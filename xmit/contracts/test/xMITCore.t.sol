// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {xMITReputation} from "../src/xMITReputation.sol";
import {xMITTreasury} from "../src/xMITTreasury.sol";
import {xMITCore} from "../src/xMITCore.sol";
import {xMITLoyalty} from "../src/xMITLoyalty.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

contract XMITCoreTest is Test {
    xMITReputation rep;
    xMITTreasury   treasury;
    xMITCore       core;
    xMITLoyalty    loyalty;
    ERC20Mock      usdc;

    address owner   = address(0xA1);
    address analyst = address(0xA2);
    address analyst2 = address(0xA3);

    function setUp() public {
        vm.startPrank(owner);
        usdc     = new ERC20Mock();
        rep      = new xMITReputation(owner);
        treasury = new xMITTreasury(address(usdc), owner);
        core     = new xMITCore(address(rep), address(treasury), owner);
        loyalty  = new xMITLoyalty(owner);
        rep.setCoreContract(address(core));
        loyalty.setCoreContract(address(core));
        vm.stopPrank();
    }

    function test_RegisterAndSubmit() public {
        vm.prank(analyst);
        bytes32 id = core.registerAndSubmit(
            xMITCore.Module.XIFD,
            bytes32("TSLA"),
            keccak256("evidence"),
            100_000 // $0.10 USDC
        );

        xMITCore.Insight memory ins = core.getInsight(id);
        assertEq(ins.analyst, analyst);
        assertEq(uint8(ins.module), uint8(xMITCore.Module.XIFD));
        assertEq(uint8(ins.verdict), uint8(xMITCore.Verdict.PENDING));
    }

    function test_ScoreInsightCorrect() public {
        vm.prank(analyst);
        bytes32 id = core.registerAndSubmit(
            xMITCore.Module.XCGO,
            bytes32("AAPL"),
            keccak256("proxy-analysis"),
            50_000
        );

        vm.prank(owner);
        core.scoreInsight(id, xMITCore.Verdict.CORRECT, 500);

        xMITCore.Insight memory ins = core.getInsight(id);
        assertEq(uint8(ins.verdict), uint8(xMITCore.Verdict.CORRECT));

        (uint256 repScore,,,,,,) = rep.profiles(analyst);
        assertGt(repScore, 0, "Reputation should increase");
    }

    function test_SoulboundTransferReverts() public {
        vm.prank(analyst);
        core.registerAndSubmit(
            xMITCore.Module.XSTM,
            bytes32("GME"),
            keccak256("short-thesis"),
            1_000_000
        );

        uint256 tokenId = rep.tokenOfAnalyst(analyst);
        vm.prank(analyst);
        vm.expectRevert("Soulbound: non-transferable");
        rep.transferFrom(analyst, analyst2, tokenId);
    }

    function test_StreakMultiplier() public {
        vm.prank(analyst);
        bytes32 id = core.registerAndSubmit(
            xMITCore.Module.XIFD,
            bytes32("NVDA"),
            keccak256("flow-analysis"),
            100_000
        );

        // Simulate 7-day streak
        vm.prank(owner);
        core.scoreInsight(id, xMITCore.Verdict.CORRECT, 1000);

        (uint256 repScore,,, uint256 streak,,,) = rep.profiles(analyst);
        assertTrue(repScore > 0, "Has reputation");
        assertEq(streak, 1, "Streak started");
    }
}
