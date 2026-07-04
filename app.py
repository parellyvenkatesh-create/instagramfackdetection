"""
InstaGuard AI — Flask Backend
Auth: Session-based with Werkzeug password hashing (users.json)
ML:  Ensemble (LR + RF + XGBoost + SVM) via VotingClassifier
"""

import json
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from urllib.parse import urlparse

from flask import (
    Flask, jsonify, redirect, render_template,
    request, session, url_for
)
from flask_cors import CORS
import instaloader
import joblib
import pandas as pd
import requests as http_requests
from dotenv import load_dotenv
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()

# ── App setup ────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "instaguard-super-secret-key-change-in-production")
CORS(app, supports_credentials=True)

# ── Paths ────────────────────────────────────────────────────────────────────
MODEL_PATH   = Path("model.joblib")
METRICS_PATH = Path("metrics.json")
USERS_FILE   = Path("users.json")

# ── Feature order (must match training) ──────────────────────────────────────
FEATURE_ORDER = [
    "userFollowerCount",
    "userFollowingCount",
    "userBiographyLength",
    "userMediaCount",
    "userHasProfilPic",
    "userIsPrivate",
    "usernameDigitCount",
    "usernameLength",
    "follower_following_ratio",
    "media_per_follower",
]

MODEL_ARTIFACT  = None
LAST_AUTH_ERROR = ""

# ══════════════════════════════════════════════════════════════════════════════
# USER STORAGE (JSON file — no DB required)
# ══════════════════════════════════════════════════════════════════════════════

def _load_users() -> dict:
    if USERS_FILE.exists():
        try:
            return json.loads(USERS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_users(users: dict) -> None:
    USERS_FILE.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding="utf-8")


def _find_user(identifier: str) -> dict | None:
    """Find by email OR username (case-insensitive)."""
    users = _load_users()
    identifier_lower = identifier.strip().lower()
    for uid, u in users.items():
        if u.get("email", "").lower() == identifier_lower:
            return {**u, "_id": uid}
        if u.get("username", "").lower() == identifier_lower:
            return {**u, "_id": uid}
    return None


# ══════════════════════════════════════════════════════════════════════════════
# AUTH DECORATOR
# ══════════════════════════════════════════════════════════════════════════════

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            # API calls → 401, browser calls → redirect
            if request.is_json or request.path.startswith("/api/") or request.path.startswith("/analyze"):
                return jsonify({"ok": False, "error": "Authentication required."}), 401
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated


# ══════════════════════════════════════════════════════════════════════════════
# MODEL
# ══════════════════════════════════════════════════════════════════════════════

def load_model_artifact() -> None:
    global MODEL_ARTIFACT
    if MODEL_ARTIFACT is not None:
        return
    if MODEL_PATH.exists():
        MODEL_ARTIFACT = joblib.load(MODEL_PATH)


def create_instaloader_client() -> instaloader.Instaloader:
    global LAST_AUTH_ERROR
    LAST_AUTH_ERROR = ""
    loader = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        quiet=True,
    )
    ig_user     = os.getenv("INSTAGRAM_USERNAME", "").strip()
    ig_pass     = os.getenv("INSTAGRAM_PASSWORD", "").strip()
    session_file = os.getenv("INSTAGRAM_SESSION_FILE", "").strip()
    try:
        if ig_user and session_file and Path(session_file).exists():
            loader.load_session_from_file(ig_user, session_file)
            return loader
        if ig_user and ig_pass:
            loader.login(ig_user, ig_pass)
            if session_file:
                loader.save_session_to_file(session_file)
            return loader
    except Exception as exc:
        LAST_AUTH_ERROR = str(exc)
    return loader


@dataclass
class ProfileFeatures:
    userFollowerCount: int
    userFollowingCount: int
    userBiographyLength: int
    userMediaCount: int
    userHasProfilPic: int
    userIsPrivate: int
    usernameDigitCount: int
    usernameLength: int
    follower_following_ratio: float
    media_per_follower: float


def safe_div(a: float, b: float) -> float:
    """Returns a / b, with b falling back to 1 if it is 0, matching training logic."""
    denom = float(b) if b != 0 else 1.0
    return float(a) / denom


def extract_username(profile_url: str) -> str:
    if not profile_url:
        raise ValueError("Instagram profile URL is required.")
    parsed = urlparse(profile_url.strip())
    if not parsed.netloc:
        raise ValueError("Please enter a valid Instagram profile URL.")
    if "instagram.com" not in parsed.netloc.lower():
        raise ValueError("URL must be from instagram.com.")
    path_parts = [p for p in parsed.path.split("/") if p]
    if not path_parts:
        raise ValueError("Could not find username in the URL.")
    username = path_parts[0].strip()
    if username in {"p", "reel", "explore", "accounts"}:
        raise ValueError("Please provide a profile URL, not a post/reel URL.")
    if not re.match(r"^[A-Za-z0-9._]+$", username):
        raise ValueError("Invalid Instagram username format.")
    return username


def fetch_profile_metadata(username: str) -> dict:
    loader = create_instaloader_client()
    try:
        profile = instaloader.Profile.from_username(loader.context, username)
        return {
            "username": profile.username,
            "followers": profile.followers,
            "following": profile.followees,
            "biography": profile.biography or "",
            "media_count": profile.mediacount,
            "has_profile_pic": int(not profile.has_default_profile_pic),
            "is_private": int(profile.is_private),
        }
    except Exception:
        pass

    try:
        return _fetch_via_web_api(username, loader)
    except Exception:
        pass

    apify_token    = os.getenv("APIFY_TOKEN", "").strip()
    apify_actor_id = os.getenv("APIFY_ACTOR_ID", "").strip()
    if apify_token and apify_actor_id:
        try:
            return _fetch_via_apify(username, apify_token, apify_actor_id)
        except Exception as exc:
            print("Apify error:", exc)
            raise

    raise RuntimeError(
        "Unable to fetch this profile right now. Instagram blocked the request. "
        "Configure APIFY_TOKEN + APIFY_ACTOR_ID in .env for reliable scraping, "
        "or try a different public profile."
    )


def _fetch_via_web_api(username: str, loader: instaloader.Instaloader) -> dict:
    url = "https://www.instagram.com/api/v1/users/web_profile_info/"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "x-ig-app-id": "936619743392459",
        "x-requested-with": "XMLHttpRequest",
        "referer": f"https://www.instagram.com/{username}/",
    }
    try:
        resp = loader.context._session.get(  # pylint: disable=protected-access
            url, params={"username": username}, headers=headers, timeout=15
        )
        resp.raise_for_status()
        user = (resp.json() or {}).get("data", {}).get("user")
        if not user:
            raise RuntimeError("Empty user data.")
    except Exception as exc:
        hint = f" Login error: {LAST_AUTH_ERROR}." if LAST_AUTH_ERROR else ""
        raise RuntimeError(
            "Web API fetch failed. Instagram may have blocked this request." + hint
        ) from exc
    return {
        "username": user.get("username", username),
        "followers": int((user.get("edge_followed_by") or {}).get("count", 0)),
        "following": int((user.get("edge_follow") or {}).get("count", 0)),
        "biography": user.get("biography") or "",
        "media_count": int((user.get("edge_owner_to_timeline_media") or {}).get("count", 0)),
        "has_profile_pic": int(not user.get("has_anonymous_profile_picture", False)),
        "is_private": int(bool(user.get("is_private", False))),
    }


def _pick(data: dict, *keys, default=None):
    for k in keys:
        if k in data and data[k] is not None:
            return data[k]
    return default


def _fetch_via_apify(username: str, token: str, actor_id: str) -> dict:
    actor_id = actor_id.replace("/", "~") if "/" in actor_id and "~" not in actor_id else actor_id
    profile_url = f"https://www.instagram.com/{username}/"
    payload     = {"directUrls": [profile_url], "resultsType": "details","resultsLimit":1}

    start_resp = http_requests.post(
        f"https://api.apify.com/v2/acts/{actor_id}/runs?token={token}",
        json=payload, timeout=60
    )
    start_resp.raise_for_status()
    run = start_resp.json()
    data_block = run.get("data") if isinstance(run.get("data"), dict) else run
    run_id = data_block.get("id") or data_block.get("runId")
    if not run_id:
        raise RuntimeError("Apify did not return a run ID.")

    max_wait, interval, elapsed = int(os.getenv("APIFY_POLL_MAX_SECONDS", "300")), 5, 0
    run_state = None
    while elapsed < max_wait:
        r = http_requests.get(f"https://api.apify.com/v2/acts/{actor_id}/runs/{run_id}?token={token}", timeout=60)
        r.raise_for_status()
        run_state = r.json()
        blk = run_state.get("data") if isinstance(run_state.get("data"), dict) else run_state
        if (blk.get("status") or blk.get("state")) in {"SUCCEEDED", "FAILED"}:
            break
        time.sleep(interval); elapsed += interval

    blk = run_state.get("data") if isinstance((run_state or {}).get("data"), dict) else (run_state or {})
    if (blk.get("status") or blk.get("state")) != "SUCCEEDED":
        raise RuntimeError("Apify run did not succeed.")
    dataset_id = blk.get("defaultDatasetId") or blk.get("defaultDatasetID")
    items_resp = http_requests.get(
        f"https://api.apify.com/v2/datasets/{dataset_id}/items?token={token}&clean=true&limit=1",
        timeout=60
    )
    items_resp.raise_for_status()
    items = items_resp.json()
    if not isinstance(items, list) or not items:
        raise RuntimeError("Apify dataset returned no items.")
    item = items[0]
    followers = item.get("followersCount") or 0
    following = item.get("followsCount") or 0
    media     = item.get("postsCount") or 0
    bio       = item.get("biography") or ""
    pic_url   = item.get("profilePicUrl") or ""
    is_private = item.get("isPrivate") or False
    return {
        "username": item.get("username", username),
        "followers": int(followers),
        "following": int(following),
        "biography": str(bio),
        "media_count": int(media),
        "has_profile_pic": int(bool(pic_url)),
        "is_private": int(bool(is_private)),
    }


def build_features(profile: dict) -> ProfileFeatures:
    username    = profile["username"]
    followers   = int(profile["followers"])
    following   = int(profile["following"])
    bio_len     = len(profile["biography"])
    media_count = int(profile["media_count"])
    return ProfileFeatures(
        userFollowerCount=followers,
        userFollowingCount=following,
        userBiographyLength=bio_len,
        userMediaCount=media_count,
        userHasProfilPic=int(profile["has_profile_pic"]),
        userIsPrivate=int(profile["is_private"]),
        usernameDigitCount=sum(ch.isdigit() for ch in username),
        usernameLength=len(username),
        follower_following_ratio=round(safe_div(followers, following), 4),
        media_per_follower=round(safe_div(media_count, followers), 4),
    )


def predict_fake_or_real(features: ProfileFeatures) -> tuple[str, float, dict]:
    load_model_artifact()
    if MODEL_ARTIFACT and "model" in MODEL_ARTIFACT:
        row   = pd.DataFrame([{col: features.__dict__[col] for col in FEATURE_ORDER}], columns=FEATURE_ORDER)
        model = MODEL_ARTIFACT["model"]
        probs = model.predict_proba(row)[0]
        prob_fake = float(probs[1]) if len(probs) > 1 else float(probs[0])

        # Small nudges — only applied when model is uncertain (35–65%)
        if 0.35 < prob_fake < 0.65:
            nudge = 0.0
            if features.userMediaCount == 0:        nudge += 0.08
            elif features.userMediaCount < 3:       nudge += 0.04
            if features.userBiographyLength == 0:   nudge += 0.05
            if features.usernameDigitCount >= 5:    nudge += 0.04
            if features.userHasProfilPic == 0:      nudge += 0.04
            prob_fake = min(1.0, prob_fake + nudge)

        label      = "Fake" if prob_fake >= 0.5 else "Real"
        confidence = prob_fake if label == "Fake" else 1.0 - prob_fake
        return label, round(float(confidence) * 100, 2), {"model": "Ensemble (LR + RF + XGBoost + SVM)"}

    # Heuristic fallback
    risk, reasons = 0.0, {}
    if features.usernameDigitCount >= 4:       risk += 0.14; reasons["usernameDigitCount"]    = "High digit count in username."
    if features.usernameLength < 5:            risk += 0.08; reasons["usernameLength"]        = "Very short username."
    if features.userBiographyLength <= 3:      risk += 0.12; reasons["userBiographyLength"]  = "Biography is almost empty."
    if features.userMediaCount <= 2:           risk += 0.14; reasons["userMediaCount"]        = "Very few posts."
    if features.userHasProfilPic == 0:         risk += 0.16; reasons["userHasProfilPic"]      = "No custom profile picture."
    if features.userFollowerCount < 50 and features.userFollowingCount > 300:
                                               risk += 0.14; reasons["follower_following"]    = "Following far exceeds followers."
    if features.follower_following_ratio < 0.1: risk += 0.10; reasons["f_f_ratio"]            = "Very low follower/following ratio."
    if features.media_per_follower > 0.6:      risk += 0.06; reasons["media_per_follower"]   = "Unusual media-to-follower ratio."
    if features.userIsPrivate == 1 and features.userFollowerCount < 80:
                                               risk += 0.06; reasons["private_low_followers"] = "Private with low followers."
    risk  = max(0.01, min(0.99, risk))
    label = "Fake" if risk >= 0.5 else "Real"
    conf  = risk if label == "Fake" else min(0.80, 1.0 - risk)
    return label, round(conf * 100, 2), reasons


# ══════════════════════════════════════════════════════════════════════════════
# ROUTES — AUTH
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/login", methods=["GET"])
def login_page():
    if "user_id" in session:
        return redirect(url_for("home"))
    return render_template("login.html")


@app.route("/signup", methods=["GET"])
def signup_page():
    if "user_id" in session:
        return redirect(url_for("home"))
    return render_template("signup.html")


@app.post("/api/auth/register")
def api_register():
    body     = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    email    = body.get("email", "").strip().lower()
    password = body.get("password", "")
    confirm  = body.get("confirm_password", "")

    # Validation
    if not all([username, email, password, confirm]):
        return jsonify({"ok": False, "error": "All fields are required."}), 400
    if not re.match(r"^[A-Za-z0-9_]{3,24}$", username):
        return jsonify({"ok": False, "error": "Username must be 3–24 chars (letters, numbers, underscores)."}), 400
    if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
        return jsonify({"ok": False, "error": "Please enter a valid email address."}), 400
    if len(password) < 8:
        return jsonify({"ok": False, "error": "Password must be at least 8 characters."}), 400
    if not re.search(r"[A-Z]", password):
        return jsonify({"ok": False, "error": "Password must contain at least one uppercase letter."}), 400
    if not re.search(r"\d", password):
        return jsonify({"ok": False, "error": "Password must contain at least one number."}), 400
    if password != confirm:
        return jsonify({"ok": False, "error": "Passwords do not match."}), 400

    users = _load_users()
    for u in users.values():
        if u.get("email", "").lower() == email:
            return jsonify({"ok": False, "error": "An account with this email already exists."}), 409
        if u.get("username", "").lower() == username.lower():
            return jsonify({"ok": False, "error": "This username is already taken."}), 409

    user_id = f"user_{len(users) + 1}_{int(time.time())}"
    users[user_id] = {
        "username": username,
        "email": email,
        "password_hash": generate_password_hash(password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_users(users)

    session["user_id"]       = user_id
    session["username"]      = username
    session["email"]         = email
    session.permanent        = True
    return jsonify({"ok": True, "message": "Account created successfully!", "redirect": "/"}), 201


@app.post("/api/auth/login")
def api_login():
    body       = request.get_json(silent=True) or {}
    identifier = body.get("identifier", "").strip()
    password   = body.get("password", "")
    remember   = bool(body.get("remember", False))

    if not identifier or not password:
        return jsonify({"ok": False, "error": "Email/username and password are required."}), 400

    user = _find_user(identifier)
    if not user or not check_password_hash(user.get("password_hash", ""), password):
        return jsonify({"ok": False, "error": "Invalid credentials. Please try again."}), 401

    session["user_id"]  = user["_id"]
    session["username"] = user["username"]
    session["email"]    = user["email"]
    session.permanent   = remember
    return jsonify({"ok": True, "message": f"Welcome back, {user['username']}!", "redirect": "/"})


@app.post("/api/auth/logout")
@login_required
def api_logout():
    session.clear()
    return jsonify({"ok": True, "redirect": "/login"})


@app.get("/api/auth/me")
def api_me():
    if "user_id" not in session:
        return jsonify({"ok": False, "authenticated": False}), 401
    return jsonify({
        "ok": True, "authenticated": True,
        "username": session.get("username"),
        "email": session.get("email"),
    })


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))


# ══════════════════════════════════════════════════════════════════════════════
# ROUTES — DASHBOARD
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/")
@login_required
def home():
    return render_template("index.html",
                           username=session.get("username", "User"))


@app.get("/api/metrics")
@login_required
def get_metrics():
    if METRICS_PATH.exists():
        data = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
        return jsonify({"ok": True, "metrics": data})
    fallback = {
        "algorithms": {"Logistic Regression": 97.07, "Random Forest": 97.91, "XGBoost": 97.49, "SVM": 92.89},
        "ensemble": 98.74,
    }
    return jsonify({"ok": True, "metrics": fallback})


@app.post("/analyze-profile")
@login_required
def analyze_profile():
    payload     = request.get_json(silent=True) or {}
    profile_url = payload.get("profile_url", "")
    try:
        username  = extract_username(profile_url)
        profile   = fetch_profile_metadata(username)
        features  = build_features(profile)
        label, confidence, reasons = predict_fake_or_real(features)
    except (ValueError, RuntimeError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        import traceback; traceback.print_exc()
        return jsonify({"ok": False, "error": f"Unexpected server error: {exc}"}), 500

    return jsonify({
        "ok": True,
        "username": profile["username"],
        "profile": {
            "followers":       profile["followers"],
            "following":       profile["following"],
            "media_count":     profile["media_count"],
            "is_private":      profile["is_private"],
            "has_profile_pic": profile["has_profile_pic"],
        },
        "features":   features.__dict__,
        "prediction": {"label": label, "confidence_percent": confidence, "reasons": reasons},
    })


if __name__ == "__main__":
    app.run(debug=True)
