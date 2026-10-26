"""Allows testing with ONLY ticket_text directly from command-line or interactive prompt."""

import sys
from priority_severity_service import PrioritySeverityService


def test_ticket(text: str):
    service = PrioritySeverityService()
    print("\n" + "=" * 60)
    print(f'Ticket Input: "{text}"')
    print("=" * 60)

    # 1. Complete Evaluation (with intelligent text-based inference)
    eval_result = service.evaluate_ticket(ticket_text=text)
    prio_info = eval_result["priority"]
    sev_info = eval_result["severity"]

    print(f"Evaluated Priority : {prio_info['predicted_priority'].upper()}")
    print(
        f"Raw ML Prediction  : {prio_info['raw_model_prediction']} (Confidence: {prio_info['confidence'] * 100:.1f}%)"
    )
    if prio_info.get("class_probabilities"):
        print("ML Class Probabilities:")
        for cls_name, prob in prio_info["class_probabilities"].items():
            print(f"  - {cls_name:8s}: {prob * 100:.1f}%")

    print(
        f"\nSeverity Level     : {sev_info['level'].upper()} (Score: {sev_info['score']}/100)"
    )
    print(f"Inferred Settings  : Impact={sev_info['inputs']['business_impact']}")
    print(f"Severity Reason    : {sev_info['reasoning']}")
    print(f"\nSLA Response Target: < {eval_result['sla']['response_time']}")
    print(f"SLA Resolution     : < {eval_result['sla']['resolution_time']}")
    print(f"Escalation Channel : {eval_result['sla']['escalation']}")
    print("=" * 60)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Passed via command line: python interactive_test.py "my ticket message"
        ticket_message = " ".join(sys.argv[1:])
        test_ticket(ticket_message)
    else:
        # Interactive prompt
        print("SupportPilot - Ticket Tester (Enter 'exit' or 'quit' to stop)")
        while True:
            try:
                user_input = input("\nEnter ticket text: ").strip()
                if user_input.lower() in ["exit", "quit", "q"]:
                    break
                if not user_input:
                    continue
                test_ticket(user_input)
            except (KeyboardInterrupt, EOFError):
                break
