// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IOnramp {
    function wrap(address asset, address to, uint256 amount) external;
    function paused(address asset) external view returns (bool);
}

interface IUniV3Factory {
    function getPool(address, address, uint24) external view returns (address);
}

interface IPool {
    function liquidity() external view returns (uint128);
}

interface IRouter02 {
    struct P {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(P calldata) external payable returns (uint256);
}

/// Polygon fork: can CCTP-minted native USDC become pUSD? Run with --fork-url <polygon rpc>.
contract PolygonForkTest is Test {
    address constant USDC = 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359; // native (CCTP mints this)
    address constant USDCE = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address constant PUSD = 0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB;
    address constant ONRAMP = 0x93070a847efEf7F70739046A929D47a521F5B8ee;
    address constant UNI_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address constant ROUTER02 = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;

    function test_nativeUsdcWrapIsPaused() public {
        assertTrue(IOnramp(ONRAMP).paused(USDC), "native USDC wrap paused");
        assertFalse(IOnramp(ONRAMP).paused(USDCE), "USDC.e wrap open");
        deal(USDC, address(this), 100e6);
        IERC20(USDC).approve(ONRAMP, 100e6);
        vm.expectRevert(); // OnlyUnpaused
        IOnramp(ONRAMP).wrap(USDC, address(this), 100e6);
    }

    function test_swapNativeToUsdceThenWrap() public {
        uint24[3] memory fees = [uint24(100), 500, 3000];
        for (uint256 i = 0; i < 3; i++) {
            address pool = IUniV3Factory(UNI_FACTORY).getPool(USDC, USDCE, fees[i]);
            console.log("pool fee", fees[i], pool);
            if (pool != address(0)) {
                console.log("  liquidity", IPool(pool).liquidity());
                console.log("  USDC bal", IERC20(USDC).balanceOf(pool));
                console.log("  USDC.e bal", IERC20(USDCE).balanceOf(pool));
            }
        }
        uint256 amt = 10_000e6;
        deal(USDC, address(this), amt);
        IERC20(USDC).approve(ROUTER02, amt);
        uint256 out = IRouter02(ROUTER02).exactInputSingle(IRouter02.P(USDC, USDCE, 100, address(this), amt, 0, 0));
        console.log("swapped 10,000 USDC -> USDC.e out", out);
        IERC20(USDCE).approve(ONRAMP, out);
        IOnramp(ONRAMP).wrap(USDCE, address(this), out);
        console.log("pUSD received", IERC20(PUSD).balanceOf(address(this)));
        assertEq(IERC20(PUSD).balanceOf(address(this)), out);
    }
}
