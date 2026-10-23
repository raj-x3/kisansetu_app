# Trains the next-day demand forecasting model.
#
# Same honesty rule as eta_train.py: we don't have months of real
# booking history for this prototype, so we generate a synthetic
# dataset that follows a realistic pattern — a centre's daily bookings
# cluster around a fraction of its configured capacity, higher midweek
# than on the weekend, with real-world noise — and train a genuine
# RandomForestRegressor on it. The model learns the relationship; it is
# not a hard-coded formula at prediction time.
#
# Run with: python app/demand_train.py
# Saves to app/model/demand_model.joblib

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import joblib
import os

np.random.seed(7)

N_SAMPLES = 4000

def generate_synthetic_dataset(n=N_SAMPLES) -> pd.DataFrame:
    centre_capacity = np.random.randint(80, 400, n)
    day_of_week = np.random.randint(0, 7, n)  # 0=Monday .. 6=Sunday
    # A centre's own recent daily average is the strongest real signal
    # of what tomorrow looks like — it already encodes local demand.
    recent_avg_bookings = np.random.uniform(0.3, 1.1, n) * centre_capacity

    weekend_dip = np.where(day_of_week >= 5, 0.6, 1.0)
    midweek_bump = np.where((day_of_week == 2) | (day_of_week == 3), 1.1, 1.0)
    noise = np.random.normal(0, 15, n)

    expected_farmers = np.clip(
        recent_avg_bookings * weekend_dip * midweek_bump + noise, 0, centre_capacity * 1.8
    )

    return pd.DataFrame({
        "centre_capacity": centre_capacity,
        "day_of_week": day_of_week,
        "recent_avg_bookings": recent_avg_bookings,
        "expected_farmers": expected_farmers,
    })


def train_and_save():
    df = generate_synthetic_dataset()
    feature_columns = ["centre_capacity", "day_of_week", "recent_avg_bookings"]
    X = df[feature_columns]
    y = df["expected_farmers"]

    model = RandomForestRegressor(n_estimators=150, max_depth=10, random_state=7)
    model.fit(X, y)

    model_dir = os.path.join(os.path.dirname(__file__), "model")
    os.makedirs(model_dir, exist_ok=True)
    path = os.path.join(model_dir, "demand_model.joblib")
    joblib.dump({"model": model, "feature_columns": feature_columns}, path)
    print(f"Demand model trained on {len(df)} synthetic samples and saved to {path}")


if __name__ == "__main__":
    train_and_save()
