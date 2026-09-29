from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import UrbanEvent, Bus, ContractorNotice
from app.schemas import (
    UrbanEventCreate,
    UrbanEventResponse,
    EventStatusUpdate,
    ContractorNoticeCreate,
    ContractorNoticeResponse,
    ContractorNoticeResult,
)
from app.services.event_processor import event_processor
from app.config import settings

# Road-surface defects a repair contractor would be dispatched for. Other
# event types (e.g. GARBAGE) are handled by different municipal teams, so
# the "send to contractor" action is not offered for them.
CONTRACTOR_ELIGIBLE_TYPES = {"POTHOLE", "ROAD_DAMAGE"}

router = APIRouter(prefix="/api/events", tags=["Urban Events"])

@router.post("", response_model=UrbanEventResponse, status_code=status.HTTP_201_CREATED)
def create_urban_event(
    event_in: UrbanEventCreate,
    db: Session = Depends(get_db)
):
    """
    Store a real urban detection event through the EventProcessor layer:
    - Confidence thresholding
    - Duplicate detection & cooldown check (spatial & temporal)
    - Priority calculation
    """
    bus_code = event_in.bus_code or settings.ACTIVE_BUS_CODE
    bus = db.query(Bus).filter(Bus.bus_code == bus_code).first()
    if not bus:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bus '{bus_code}' not found."
        )

    result = event_processor.process_and_store_event(db=db, event_in=event_in, bus=bus)

    if not result.success:
        if result.status == "DROPPED_LOW_CONFIDENCE":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=result.message
            )
        elif result.status == "DUPLICATE_SUPPRESSED":
            # Return existing event with 200 OK or 409 Conflict info
            if result.event:
                return result.event
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=result.message
            )

    return result.event

@router.get("", response_model=List[UrbanEventResponse])
def list_urban_events(
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status: ACTIVE, RESOLVED, INVESTIGATING"),
    source_filter: Optional[str] = Query(None, alias="source", description="Filter by source: SEED, AI_DETECTION, MANUAL_TEST"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db)
):
    """
    Return stored urban events ordered by most recent first.
    Allows filtering by status and data provenance.
    """
    query = db.query(UrbanEvent)

    if status_filter and status_filter.upper() != "ALL":
        query = query.filter(UrbanEvent.status == status_filter.upper())

    if source_filter and source_filter.upper() != "ALL":
        query = query.filter(UrbanEvent.source == source_filter.upper())

    events = query.order_by(UrbanEvent.timestamp.desc()).limit(limit).all()
    return events

@router.get("/{event_id}", response_model=UrbanEventResponse)
def get_urban_event(event_id: int, db: Session = Depends(get_db)):
    """
    Return a specific urban event by ID.
    """
    event = db.query(UrbanEvent).filter(UrbanEvent.id == event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event #{event_id} not found."
        )
    return event

@router.patch("/{event_id}/resolve", response_model=UrbanEventResponse)
def resolve_urban_event(event_id: int, db: Session = Depends(get_db)):
    """
    Actually update the event status to RESOLVED in the database.
    """
    event = db.query(UrbanEvent).filter(UrbanEvent.id == event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event #{event_id} not found."
        )

    event.status = "RESOLVED"
    db.commit()
    db.refresh(event)
    return event


@router.patch("/{event_id}/status", response_model=UrbanEventResponse)
def update_event_status(event_id: int, payload: EventStatusUpdate, db: Session = Depends(get_db)):
    """
    Update an event's workflow status (ACTIVE / INVESTIGATING / ASSIGNED / RESOLVED).
    """
    event = db.query(UrbanEvent).filter(UrbanEvent.id == event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event #{event_id} not found."
        )

    event.status = payload.status
    db.commit()
    db.refresh(event)
    return event


@router.get("/{event_id}/contractor-notices", response_model=List[ContractorNoticeResponse])
def list_contractor_notices(event_id: int, db: Session = Depends(get_db)):
    """Return contractor notices previously dispatched for an event."""
    return (
        db.query(ContractorNotice)
        .filter(ContractorNotice.event_id == event_id)
        .order_by(ContractorNotice.sent_at.desc())
        .all()
    )


@router.post(
    "/{event_id}/contractor-notice",
    response_model=ContractorNoticeResult,
    status_code=status.HTTP_201_CREATED,
)
def send_contractor_notice(
    event_id: int,
    payload: ContractorNoticeCreate,
    db: Session = Depends(get_db),
):
    """
    Record a repair notice for a road-defect event and mark it ASSIGNED.

    This RECORDS the dispatch; it does not deliver email/SMS. Real delivery
    would need SMTP/provider credentials this deployment does not hold, so
    the response says plainly what happened rather than implying a send.
    """
    event = db.query(UrbanEvent).filter(UrbanEvent.id == event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event #{event_id} not found."
        )

    if (event.event_type or "").upper() not in CONTRACTOR_ELIGIBLE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Event type '{event.event_type}' is not a road-surface defect. "
                f"Contractor dispatch applies to: {', '.join(sorted(CONTRACTOR_ELIGIBLE_TYPES))}."
            ),
        )

    notice = ContractorNotice(
        event_id=event.id,
        contractor_name=payload.contractor_name.strip(),
        phone=payload.phone.strip(),
        email=payload.email.strip(),
        warranty_remaining=(payload.warranty_remaining or "").strip() or None,
        notes=(payload.notes or "").strip() or None,
        delivery_status="RECORDED",
    )
    db.add(notice)

    event.status = "ASSIGNED"
    db.commit()
    db.refresh(notice)
    db.refresh(event)

    return ContractorNoticeResult(
        notice=ContractorNoticeResponse.model_validate(notice),
        event=UrbanEventResponse.model_validate(event),
        message=(
            f"Notice recorded for {notice.contractor_name} and issue #{event.id} marked ASSIGNED. "
            f"Delivery is not configured on this server, so no email/SMS was actually sent."
        ),
    )
