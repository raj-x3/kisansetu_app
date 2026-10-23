# Trains the ETA prediction model.
#
# Real government procurement data isn't available for this prototype,
# so we generate a synthetic dataset that follows a realistic
# relationship: more people waiting relative to how many
# machines/operators are actively processing them means a longer wait,
# plus some random real-world noise. A genuine RandomForestRegressor
# then learns that relationship from the data — this is NOT a formula
# hard-coded at prediction time; the model itself is doing the work.
#
# Run this once with: python app/train.py
# It saves the trained model to app/model/eta_model.joblib.

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import joblib
import os

np.random.seed(42)

N_SAMPLES = 5000

def generate_synthetic_dataset(n=N_SAMPLES) -> pd.DataFrame:
    queue_length = np.random.randint(0, 80, n)
    active_machines = np.random.randint(1, 6, n)
    active_operators = np.random.randint(1, 8, n)
    hour = np.random.randint(8, 18, n)
    farmers_arrived = np.random.randint(0, 200, n)
    average_processing_time = np.random.uniform(6, 18, n)  # minutes per farmer

    # Core realistic relationship: waiting time scales with how many
    # people are ahead of you, divided by how much processing capacity
    # is actually active right now — plus real-world noise, and a small
    # bump during the historically busier midday hours.
    capacity = active_machines * active_operators
    base_wait = (queue_length / np.maximum(capacity, 1)) * average_processing_time
    midday_bump = np.where((hour >= 11) & (hour <= 14), 1.15, 1.0)
    noise = np.random.normal(0, 4, n)

    waiting_time_minutes = np.clip(base_wait * midday_bump + noise, 2, 180)

    return pd.DataFrame({
        "queue_length": queue_length,
        "active_machines": active_machines,
        "active_operators": active_operators,
        "hour": hour,
        "farmers_arrived": farmers_arrived,
        "average_processing_time": average_processing_time,
        "historical_waiting_time": waiting_time_minutes,
    })


def train_and_save():
    df = generate_synthetic_dataset()

    feature_columns = [
        "queue_length",
        "active_machines",
        "active_operators",
        "hour",
        "farmers_arrived",
        "average_processing_time",
    ]
    X = df[feature_columns]
    y = df["historical_waiting_time"]

    model = RandomForestRegressor(n_estimators=150, max_depth=10, random_state=42)
    model.fit(X, y)

    model_dir = os.path.join(os.path.dirname(__file__), "model")
    os.makedirs(model_dir, exist_ok=True)
    model_path = os.path.join(model_dir, "eta_model.joblib")
    joblib.dump({"model": model, "feature_columns": feature_columns}, model_path)

    print(f"Model trained on {len(df)} synthetic samples and saved to {model_path}")


if __name__ == "__main__":
    train_and_save()
