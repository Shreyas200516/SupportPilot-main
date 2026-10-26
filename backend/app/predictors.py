import sys
from pathlib import Path
from typing import Any

import joblib

TEAM_PRIORITY_DIR = Path(__file__).resolve().parents[2] / "severityANDpriority"
if str(TEAM_PRIORITY_DIR) not in sys.path:
    sys.path.insert(0, str(TEAM_PRIORITY_DIR))

from priority_severity_service import PrioritySeverityService  # noqa: E402


class PredictorService:
    """Load the team's ticket-type classifier and priority/severity service."""

    def __init__(self, category_path: Path, priority_path: Path) -> None:
        self.category_model = None
        self.category_error: str | None = None
        try:
            self.category_model = joblib.load(category_path)
            self._apply_sklearn_compatibility(self.category_model)
        except Exception as exc:
            self.category_error = str(exc)
        self.priority_severity = PrioritySeverityService(model_path=str(priority_path))
        self._apply_sklearn_compatibility(self.priority_severity.model)
        self.priority_compatibility_note = (
            "Applied LogisticRegression compatibility for the saved estimator."
            if self.priority_severity.model is not None
            else None
        )
        self.priority_model_ready = self._check_priority_model()

    @staticmethod
    def _apply_sklearn_compatibility(model: Any) -> None:
        """Patch older saved LogisticRegression objects in memory for newer sklearn releases."""
        for estimator in getattr(model, "named_steps", {}).values():
            if estimator.__class__.__name__ == "LogisticRegression" and not hasattr(
                estimator, "multi_class"
            ):
                estimator.multi_class = "auto"

    def _check_priority_model(self) -> bool:
        if self.priority_severity.model is None:
            return False
        return self.priority_severity.predict_priority("VPN connection issue")["source"] == "ml_model"

    def classify_type(self, text: str) -> tuple[str, float, dict[str, float]]:
        if self.category_model is None:
            raise RuntimeError(self.category_error or "Ticket type model is unavailable.")
        prediction = str(self.category_model.predict([text])[0]).strip().title()
        probabilities: dict[str, float] = {}
        confidence = 0.0
        if hasattr(self.category_model, "predict_proba"):
            values = self.category_model.predict_proba([text])[0]
            classes = getattr(self.category_model, "classes_", [])
            probabilities = {
                str(label).title(): round(float(probability), 4)
                for label, probability in zip(classes, values)
            }
            confidence = round(float(max(values)), 4)
        return prediction, confidence, probabilities

    def evaluate_priority_severity(
        self,
        text: str,
        business_impact: str | None,
        affected_users: int | None,
        service_criticality: str | None,
    ) -> dict[str, Any]:
        return self.priority_severity.evaluate_ticket(
            ticket_text=text,
            business_impact=business_impact,
            affected_users=affected_users,
            service_criticality=service_criticality,
        )

    @property
    def status(self) -> dict[str, Any]:
        return {
            "ticket_type_model_loaded": self.category_model is not None,
            "ticket_type_model_error": self.category_error,
            "priority_model_loaded": self.priority_model_ready,
            "priority_model_compatibility": self.priority_compatibility_note,
        }
