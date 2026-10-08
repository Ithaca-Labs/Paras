#!/usr/bin/env bash
# Throwaway: verify CCTP v2 + Polymarket contracts on-chain. Needs foundry `cast`.
M=${MONAD_RPC:-https://rpc.monad.xyz}
P=${POLYGON_RPC:-https://polygon-bor-rpc.publicnode.com}
TM=0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d
MT=0x81D40F21F12A8F0E3252Bccb954D722d4c464B64
MIN=0xfd78EE919681417d192449715b2594ab58f5D002
echo "chain ids: $(cast chain-id --rpc-url $M) $(cast chain-id --rpc-url $P)"
for r in $M $P; do
  echo "== $r"
  for a in $TM $MT $MIN; do echo "$a codebytes=$(( ($(cast code $a --rpc-url $r | wc -c) - 3) / 2 ))"; done
  echo "localDomain=$(cast call $MT 'localDomain()(uint32)' --rpc-url $r) version=$(cast call $MT 'version()(uint32)' --rpc-url $r)"
  echo "msgBodyVersion=$(cast call $TM 'messageBodyVersion()(uint32)' --rpc-url $r) minFee=$(cast call $TM 'minFee()(uint256)' --rpc-url $r) localMinter=$(cast call $TM 'localMinter()(address)' --rpc-url $r)"
  echo "maxMsgBodySize=$(cast call $MT 'maxMessageBodySize()(uint256)' --rpc-url $r) attesterThreshold=$(cast call $MT 'signatureThreshold()(uint256)' --rpc-url $r)"
done
echo "Monad->remote TM(domain7)=$(cast call $TM 'remoteTokenMessengers(uint32)(bytes32)' 7 --rpc-url $M)"
echo "Polygon->remote TM(domain15)=$(cast call $TM 'remoteTokenMessengers(uint32)(bytes32)' 15 --rpc-url $P)"
echo "Polygon USDC burn token mapped from Monad: $(cast call $MIN 'getLocalToken(uint32,bytes32)(address)' 15 0x000000000000000000000000754704Bc059F8C67012fEd69BC8A327a5aafb603 --rpc-url $P)"
echo "Monad USDC burn token mapped from Polygon: $(cast call $MIN 'getLocalToken(uint32,bytes32)(address)' 7 0x0000000000000000000000003c499c542cEF5E3811e1192ce70d8cC03d5c3359 --rpc-url $M)"
echo "Monad USDC: $(cast call 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 'symbol()(string)' --rpc-url $M) dec=$(cast call 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 'decimals()(uint8)' --rpc-url $M)"
echo "Polygon USDC: $(cast call 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 'symbol()(string)' --rpc-url $P)"
