# -*- coding: utf-8 -*-
"""端到端冒烟：注册 -> 行情 -> 研究 -> 历史 -> 充值。"""
import os
import time

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

print("health:", client.get("/api/health").json())

# 每次跑用不同邮箱，否则第二次会因「邮箱已注册」失败；需要固定账号时用 SMOKE_EMAIL 覆盖。
email = os.getenv("SMOKE_EMAIL") or f"smoke-{int(time.time())}@example.com"
r = client.post("/api/auth/send-code", json={"email": email, "purpose": "register"})
print("send-code:", r.status_code, r.json())
code = r.json().get("dev_code")

r = client.post("/api/auth/register", json={"email": email, "password": "demo123456", "code": code})
print("register:", r.status_code)
if r.status_code != 200:
    print(r.text)
    raise SystemExit(1)
token = r.json()["access_token"]
h = {"Authorization": f"Bearer {token}"}
print("user:", r.json()["user"]["email"])

print("symbols:", len(client.get("/api/market/symbols?market=crypto").json()["items"]))
print("models:", client.get("/api/market/models").json())

r = client.get("/api/market/overview?symbol=BTCUSDT&market=crypto&interval=1h")
print("overview:", r.status_code, r.json().get("source"), r.json().get("price"))

r = client.post("/api/analysis/run", json={"symbol": "BTCUSDT", "market": "crypto", "interval": "1h", "model": "auto"}, headers=h)
print("run:", r.status_code)
if r.status_code != 200:
    print(r.text)
    raise SystemExit(1)
card = r.json()["payload"]
print("verdict:", card["verdict_label"], "| score:", card["score"])
print("headline:", card["headline"])
print("plan:", card["plan"]["entry"]["zone"], "SL", card["plan"]["stop_loss"]["price"], "TP", card["plan"]["take_profit"])
print("reasons:", len(card["reasons"]), "| dims:", len(card["confidence"]["breakdown"]))
print("event:", card["event_contract"]["recommendation_label"], card["event_contract"]["probability"])
print("risks:", len(card["risks"]), "| source:", card["source"])

print("history:", client.get("/api/analysis/history", headers=h).json()["total"])
print("summary:", client.get("/api/user/summary", headers=h).json()["quota"])

r = client.post("/api/user/recharge", json={"amount_usdt": 5}, headers=h)
oid = r.json()["order"]["id"]
print("recharge:", r.status_code, r.json()["order"]["amount_usdt"], "USDT /",
      r.json()["order"]["amount_cny"], "CNY /", r.json()["order"]["tokens"], "tokens")
print("pay:", client.post(f"/api/user/recharge/{oid}/pay", headers=h).json())
print("OK")
