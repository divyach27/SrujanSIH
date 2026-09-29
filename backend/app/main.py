import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import settings
from app.database import engine, Base, get_db
from app.models import Bus
from app.services.seed import seed_database
from app.schemas import HealthResponse

from app.routers import bus, events, analytics, monitoring, video, hazard

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create tables and seed BUS_01 + initial baseline data
    Base.metadata.create_all(bind=engine)
    with Session(engine) as db:
        seed_database(db)
    yield
    # Shutdown logic if any

app = FastAPI(
    title="BUS-CV Urban Intelligence API",
    description="Backend event system and intelligence pipeline for BUS_01 mobile urban sensing prototype.",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(bus.router)
app.include_router(events.router)
app.include_router(analytics.router)
app.include_router(monitoring.router)
app.include_router(video.router)
app.include_router(hazard.router)

@app.get("/health", response_model=HealthResponse, tags=["Health"])
def health_check(db: Session = Depends(get_db)):
    """
    Return actual backend health and database connectivity information.
    """
    db_status = "CONNECTED"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"ERROR: {str(e)}"

    bus_exists = db.query(Bus).filter(Bus.bus_code == settings.ACTIVE_BUS_CODE).first()
    bus_status = "ONLINE" if bus_exists else "NOT_SEEDED"

    return HealthResponse(
        status="HEALTHY" if db_status == "CONNECTED" and bus_status == "ONLINE" else "DEGRADED",
        timestamp=datetime.datetime.now(datetime.timezone.utc),
        database=db_status,
        bus_system=bus_status,
        active_bus=settings.ACTIVE_BUS_CODE
    )


@app.get("/", tags=["Root"])
def root():
    return {
        "project": "BUS-CV Mobile Urban Intelligence",
        "prototype": "BUS_01",
        "status": "ONLINE",
        "docs_url": "/docs",
        "health_url": "/health"
    }
