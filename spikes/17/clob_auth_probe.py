"""Throwaway (#17): probe CLOB auth for POLY_1271 with a THROWAWAY EOA and an UNDEPLOYED/UNFUNDED deposit wallet.
No funds. Shows (a) whether L1 api-key creation works for sig type 3 and (b) the first validation error on order post.
Run: python -I spikes/17/clob_auth_probe.py  (needs py-clob-client-v2)"""
from eth_account import Account
from py_clob_client_v2 import ClobClient, OrderArgs, OrderType, PartialCreateOrderOptions, Side, SignatureTypeV2
import json, urllib.request

HOST = "https://clob.polymarket.com"
acct = Account.create()
fake_wallet = "0x" + "11" * 20  # not a real deposit wallet
c = ClobClient(host=HOST, chain_id=137, key=acct.key.hex(), signature_type=SignatureTypeV2.POLY_1271, funder=fake_wallet)
try:
    creds = c.create_or_derive_api_key()
    print("api key created OK (bound to EOA", acct.address, ")")
except Exception as e:
    print("api key creation FAILED:", e); raise SystemExit
c = ClobClient(host=HOST, chain_id=137, key=acct.key.hex(), creds=creds, signature_type=SignatureTypeV2.POLY_1271, funder=fake_wallet)
_req = urllib.request.Request(
    "https://gamma-api.polymarket.com/markets?limit=1&active=true&closed=false&order=volumeNum&ascending=false",
    headers={"User-Agent": "Mozilla/5.0"},
)
m = json.load(urllib.request.urlopen(_req))[0]
tok = json.loads(m["clobTokenIds"])[0]
print("market", m["question"])
try:
    print(c.create_and_post_order(order_args=OrderArgs(token_id=tok, price=0.01, size=5, side=Side.BUY),
        options=PartialCreateOrderOptions(tick_size="0.01"), order_type=OrderType.GTC))
except Exception as e:
    print("order post error:", e)
