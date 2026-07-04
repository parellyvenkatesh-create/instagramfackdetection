from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, StackingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.svm import SVC
from xgboost import XGBClassifier
import json


FEATURE_COLUMNS = [
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

TARGET_CANDIDATES = ["isFake", "label", "target", "fake", "class"]


def find_target_column(df: pd.DataFrame) -> str:
    for col in TARGET_CANDIDATES:
        if col in df.columns:
            return col
    raise ValueError(
        "Target column not found. Add one of: "
        + ", ".join(TARGET_CANDIDATES)
        + " or edit TARGET_CANDIDATES in train_model.py."
    )


def safe_div(a: pd.Series, b: pd.Series) -> pd.Series:
    denominator = b.replace(0, 1)
    return a / denominator


def main() -> None:
    dataset_path = Path("instagram_merged_dataset (1).csv")
    if not dataset_path.exists():
        raise FileNotFoundError(
            "Dataset file not found in project root: 'instagram_merged_dataset (1).csv'"
        )

    df = pd.read_csv(dataset_path)
    target_col = find_target_column(df)

    # Some datasets don't include derived ratio features; compute them if needed.
    if "follower_following_ratio" not in df.columns:
        df["follower_following_ratio"] = safe_div(df["userFollowerCount"], df["userFollowingCount"])
    if "media_per_follower" not in df.columns:
        df["media_per_follower"] = safe_div(df["userMediaCount"], df["userFollowerCount"])

    missing = [c for c in FEATURE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset missing required features: {missing}")

    clean_df = df[FEATURE_COLUMNS + [target_col]].dropna().copy()
    # Normalize target values to 0/1 for consistent model behavior.
    clean_df[target_col] = clean_df[target_col].replace({"Fake": 1, "Real": 0, "fake": 1, "real": 0})
    clean_df[target_col] = clean_df[target_col].astype(int)

    X = clean_df[FEATURE_COLUMNS]
    y = clean_df[target_col]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    lr = LogisticRegression(max_iter=2000)
    rf = RandomForestClassifier(n_estimators=300, random_state=42)
    xgb = XGBClassifier(
        n_estimators=300,
        learning_rate=0.05,
        max_depth=6,
        subsample=0.9,
        colsample_bytree=0.9,
        eval_metric="logloss",
        random_state=42,
    )
    svm_model = SVC(probability=True, random_state=42)

    # Train base models individually to gather accuracy statistics
    metrics = {"algorithms": {}, "ensemble": 0.0}
    base_models = {"Logistic Regression": lr, "Random Forest": rf, "XGBoost": xgb, "SVM": svm_model}

    for name, model in base_models.items():
        print(f"Training {name}...")
        model.fit(X_train, y_train)
        preds = model.predict(X_test)
        acc = accuracy_score(y_test, preds) * 100
        metrics["algorithms"][name] = round(acc, 2)
        print(f"{name} Accuracy: {round(acc, 2)}%")

    # Stacking Ensemble: level-0 base learners feed predicted probabilities
    # into a level-1 meta-learner (Logistic Regression) via 5-fold CV.
    print("Training Ensemble (Stacking Classifier)...")
    stacking = StackingClassifier(
        estimators=[("rf", rf), ("xgb", xgb), ("svm", svm_model)],
        final_estimator=lr,
        cv=5,
        stack_method="predict_proba",
    )

    stacking.fit(X_train, y_train)
    y_pred = stacking.predict(X_test)

    ensemble_acc = accuracy_score(y_test, y_pred) * 100
    metrics["ensemble"] = round(ensemble_acc, 2)
    print("Stacking Ensemble Accuracy:", round(ensemble_acc, 2), "%")
    print(classification_report(y_test, y_pred))

    # Save metrics for frontend visualization
    with open("metrics.json", "w") as f:
        json.dump(metrics, f, indent=4)
    print("Saved model accuracy metrics to metrics.json")

    artifact = {
        "model": stacking,
        "features": FEATURE_COLUMNS,
        "target": target_col,
    }
    joblib.dump(artifact, "model.joblib")
    print("Saved model artifact to model.joblib")


if __name__ == "__main__":
    main()
