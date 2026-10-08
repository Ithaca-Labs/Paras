#!/usr/bin/env bash
# Throwaway: probe Polymarket Polygon contracts. Needs foundry `cast`.
P=${POLYGON_RPC:-https://polygon-bor-rpc.publicnode.com}
for a in 0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB 0x93070a847efEf7F70739046A929D47a521F5B8ee 0x2957922Eb93258b93368531d39fAcCA3B4dC5854 0xebC2459Ec962869ca4c0bd1E06368272732BCb08 0x00000000000Fb5C9ADea0298D729A0CB3823Cc07 0x7A18EDfe055488A3128f01F563e5B479D92ffc3a 0xe3333700cA9d93003F00f0F71f8515005F6c00Aa 0xE111180000d2663C0091e4f400237545B87B996B 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045; do
  echo "$a codebytes=$(( ($(cast code $a --rpc-url $P | wc -c) - 3) / 2 ))"
done
PUSD=0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB
echo "pUSD: $(cast call $PUSD 'symbol()(string)' --rpc-url $P) dec=$(cast call $PUSD 'decimals()(uint8)' --rpc-url $P) supply=$(cast call $PUSD 'totalSupply()(uint256)' --rpc-url $P)"
ON=0x93070a847efEf7F70739046A929D47a521F5B8ee
for f in 'USDC()(address)' 'USDCE()(address)' 'asset()(address)' 'collateral()(address)' 'paused()(bool)' 'owner()(address)' 'pUSD()(address)' 'COLLATERAL_TOKEN()(address)'; do echo "onramp $f -> $(cast call $ON "$f" --rpc-url $P 2>&1 | head -1)"; done
for a in 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174; do
 echo "isPaused($a)? $(cast call $ON 'paused(address)(bool)' $a --rpc-url $P 2>&1 | head -1)"
 echo "onramp balance of $a: $(cast call $a 'balanceOf(address)(uint256)' $ON --rpc-url $P 2>&1|head -1)"
 echo "pUSD-held balance of $a: $(cast call $a 'balanceOf(address)(uint256)' $PUSD --rpc-url $P 2>&1|head -1)"
done
