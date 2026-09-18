from app.ai.providers.base import AIProvider
from app.ai.providers.mock import MockAIProvider
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("sentinel.ai.factory")

def get_ai_provider() -> AIProvider:
    if settings.AI_PROVIDER == "openrouter" and settings.OPENROUTER_API_KEY:
        try:
            from app.ai.providers.openrouter import OpenRouterProvider
            return OpenRouterProvider()
        except Exception as exc:
            logger.warning(f"OpenRouter init failed ({exc}); falling back to mock")
    return MockAIProvider()
