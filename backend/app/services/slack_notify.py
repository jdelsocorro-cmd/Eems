import logging

import httpx

from app.core.config import get_settings
from app.models.support import SupportTicket

logger = logging.getLogger(__name__)


async def notify_support_ticket_created(ticket: SupportTicket, frontend_url: str) -> None:
    """Posts a real-time heads-up to Slack when a new support ticket lands.

    Deliberately never raises -- a missing/unset webhook, or Slack being
    momentarily down, must never block ticket creation itself (the ticket is
    already committed to the DB by the time this runs; Slack is a courtesy
    notification layered on top, not the record of truth).
    """
    settings = get_settings()
    if not settings.slack_support_webhook_url:
        logger.warning("SLACK_SUPPORT_WEBHOOK_URL not configured -- skipping Slack notification for ticket %s", ticket.id)
        return

    ticket_url = f"{frontend_url}/admin/support/{ticket.id}"
    text = (
        f":rotating_light: New support ticket ({ticket.severity}/{ticket.category}): *{ticket.title}*\n"
        f"<{ticket_url}|View in Support Center>"
    )
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(settings.slack_support_webhook_url, json={"text": text})
            if resp.status_code >= 400:
                logger.warning("Slack webhook returned %s for ticket %s: %s", resp.status_code, ticket.id, resp.text)
    except httpx.HTTPError as exc:
        logger.warning("Slack webhook call failed for ticket %s: %s", ticket.id, exc)
