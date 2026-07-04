# Fake Instagram Profile Detector

This project accepts a single Instagram profile URL, extracts profile signals automatically, and predicts whether the account is likely **Real** or **Fake**.

## Features

- One input: Instagram profile link
- Automatic extraction of:
  - followers/following
  - biography length
  - media count
  - profile picture status
  - private/public status
  - username-based and ratio-based features
- Fake/real prediction with confidence and reasons

## Project Structure

- `app.py` - Flask backend + feature extraction + prediction
- `templates/index.html` - frontend page
- `static/app.js` - frontend logic
- `static/styles.css` - UI styles

## Setup

1. Install dependencies:

   ```bash
   python -m pip install -r requirements.txt
   ```

2. Run app:

   ```bash
   python app.py
   ```

3. Open:

   - `http://127.0.0.1:5000`

## How Prediction Works

Current prediction is a heuristic scoring model in `predict_fake_or_real()` for demo purposes.
You can replace this with your trained ML model while keeping the same feature vector.

## Important Note About Instagram Access

Instagram may block anonymous requests (rate-limit or 403). If that happens:

- try again after some time, or
- use a logged-in scraping session, or
- use a third-party Instagram API provider for stable college demo behavior.

