# -*- coding: utf-8 -*-
"""密码哈希、JWT、数字验证码。

密码用标准库的 PBKDF2-HMAC-SHA256，不引第三方库：
- 每个密码独立随机盐，迭代 20 万次，暴力破解成本足够；
- 存储格式自带算法与迭代次数，将来调参不影响老密码校验。
生产环境更推荐 argon2，但这里少一个依赖就少一处装不上的风险。
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from .config import ALGORITHM, SECRET_KEY, TOKEN_EXPIRE_MINUTES

_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, expected = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations))
        # 定长比较，避免时序侧信道
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, AttributeError):
        return False


def create_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def generate_numeric_code(length: int = 6) -> str:
    return "".join(secrets.choice("0123456789") for _ in range(length))
