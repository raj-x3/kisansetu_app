# The AI ETA Prediction service.
#
# This is a genuinely separate program from the Node backend — it's
# written in Python because that's where scikit-learn (the machine
# learning library) lives. The Node backend calls this service over
# HTTP, the same way your frontend calls the Node backend.
#
# Run with: uvicorn app.main:app --reload --port 8000

import os
import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "eta_model.joblib")
DEMAND_MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "demand_model.joblib")

app = FastAPI(title="Agricultural Procurement — AI ETA Prediction Service")

# Allow the Node backend to call this service. In this setup the
# frontend never talks to this service directly — Node is the only
# caller — but CORS is enabled loosely here since this is a prototype.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_model_bundle = None
_demand_model_bundle = None


def get_model():
    global _model_bundle
    if _model_bundle is None:
        if not os.path.exists(MODEL_PATH):
            raise HTTPException(
                status_code=503,
                detail="The ETA model hasn't been trained yet. Run: python app/train.py",
            )
        _model_bundle = joblib.load(MODEL_PATH)
    return _model_bundle


def get_demand_model():
    global _demand_model_bundle
    if _demand_model_bundle is None:
        if not os.path.exists(DEMAND_MODEL_PATH):
            raise HTTPException(
                status_code=503,
                detail="The demand model hasn't been trained yet. Run: python app/demand_train.py",
            )
        _demand_model_bundle = joblib.load(DEMAND_MODEL_PATH)
    return _demand_model_bundle


class EtaRequest(BaseModel):
    queue_length: int = Field(..., ge=0)
    active_machines: int = Field(..., ge=1)
    active_operators: int = Field(..., ge=1)
    hour: int = Field(..., ge=0, le=23)
    farmers_arrived: int = Field(..., ge=0)
    average_processing_time: float = Field(..., gt=0)


class EtaResponse(BaseModel):
    predicted_waiting_time: float


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict-eta", response_model=EtaResponse)
def predict_eta(payload: EtaRequest):
    bundle = get_model()
    model = bundle["model"]
    feature_columns = bundle["feature_columns"]

    input_df = pd.DataFrame([payload.model_dump()])[feature_columns]
    prediction = model.predict(input_df)[0]

    return EtaResponse(predicted_waiting_time=round(float(prediction), 1))


class DemandRequest(BaseModel):
    centre_capacity: int = Field(..., gt=0)
    day_of_week: int = Field(..., ge=0, le=6)  # 0 = Monday .. 6 = Sunday
    recent_avg_bookings: float = Field(..., ge=0)


class DemandResponse(BaseModel):
    expected_farmers: float


@app.post("/forecast-demand", response_model=DemandResponse)
def forecast_demand(payload: DemandRequest):
    bundle = get_demand_model()
    model = bundle["model"]
    feature_columns = bundle["feature_columns"]

    input_df = pd.DataFrame([payload.model_dump()])[feature_columns]
    prediction = model.predict(input_df)[0]

    return DemandResponse(expected_farmers=round(float(prediction), 1))
