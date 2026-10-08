#!/usr/bin/env bash
# Throwaway: Circle Iris fee/testnet checks.
for u in https://iris-api.circle.com/v2/burn/USDC/fees/15/7 https://iris-api.circle.com/v2/burn/USDC/fees/7/15 https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/15/7; do echo "$u"; curl -s -m 20 "$u"; echo; done
T=0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
MT=0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
for r in https://testnet-rpc.monad.xyz https://rpc-amoy.polygon.technology; do
  echo "== $r chain=$(cast chain-id --rpc-url $r) TMcode=$(cast code $T --rpc-url $r | wc -c) domain=$(cast call $MT 'localDomain()(uint32)' --rpc-url $r)"
done
