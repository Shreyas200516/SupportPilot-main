"""Optional translation adapter for LibreTranslate-compatible services."""

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def translate_text(text: str, target_language: str, source_language: str = "en") -> str:
    """Translate English text using a configured LibreTranslate endpoint.

    The application never sends ticket text to a third-party service unless the
    operator explicitly configures TRANSLATION_URL.
    """
    endpoint = os.getenv("TRANSLATION_URL", "").strip()
    if not endpoint:
        raise RuntimeError("Set TRANSLATION_URL to a trusted LibreTranslate /translate endpoint.")
    if len(text) > 20_000:
        raise RuntimeError("This knowledge article is too long to translate in one request.")
    payload = {
        "q": text,
        "source": source_language,
        "target": target_language,
        "format": "text",
    }
    api_key = os.getenv("TRANSLATION_API_KEY", "").strip()
    if api_key:
        payload["api_key"] = api_key
    request = Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=12) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError("The configured translation service could not complete the request.") from exc
    translated = result.get("translatedText") if isinstance(result, dict) else None
    if not isinstance(translated, str) or not translated.strip():
        raise RuntimeError("The translation service returned an empty response.")
    return translated
