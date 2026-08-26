from datetime import date
from decimal import Decimal
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, String, Date, Numeric, ForeignKey, Text, select, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, Session, sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://ganadero:ganadero_dev@localhost:5432/ganaderia")
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

class Lot(Base):
    __tablename__ = "lots"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    entry_date: Mapped[date] = mapped_column(Date)
    target_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(10,2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

class Animal(Base):
    __tablename__ = "animals"
    id: Mapped[int] = mapped_column(primary_key=True)
    ear_tag: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    breed: Mapped[str | None] = mapped_column(String(80), nullable=True)
    sex: Mapped[str] = mapped_column(String(20), default="Macho")
    status: Mapped[str] = mapped_column(String(30), default="Activo")
    entry_date: Mapped[date] = mapped_column(Date)
    initial_weight_kg: Mapped[Decimal] = mapped_column(Numeric(10,2))
    purchase_price: Mapped[Decimal] = mapped_column(Numeric(12,2))
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True)
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("lots.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    supplier: Mapped[Supplier | None] = relationship()
    lot: Mapped[Lot | None] = relationship()

class Weighing(Base):
    __tablename__ = "weighings"
    id: Mapped[int] = mapped_column(primary_key=True)
    animal_id: Mapped[int] = mapped_column(ForeignKey("animals.id"), index=True)
    weighing_date: Mapped[date] = mapped_column(Date)
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(10,2))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

class Cost(Base):
    __tablename__ = "costs"
    id: Mapped[int] = mapped_column(primary_key=True)
    animal_id: Mapped[int | None] = mapped_column(ForeignKey("animals.id"), nullable=True)
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("lots.id"), nullable=True)
    cost_date: Mapped[date] = mapped_column(Date)
    category: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(String(250), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12,2))

Base.metadata.create_all(engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

app = FastAPI(title="Sistema Ganadero API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status":"ok"}

@app.get("/api/suppliers")
def suppliers(db: Session = Depends(get_db)):
    return [{"id":s.id,"name":s.name,"phone":s.phone} for s in db.scalars(select(Supplier).order_by(Supplier.name)).all()]

@app.post("/api/suppliers")
def create_supplier(payload: dict, db: Session = Depends(get_db)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "El proveedor es obligatorio.")
    if db.scalar(select(Supplier).where(Supplier.name == name)):
        raise HTTPException(409, "El proveedor ya existe.")
    s = Supplier(name=name, phone=payload.get("phone"))
    db.add(s); db.commit(); db.refresh(s)
    return {"id":s.id,"name":s.name}

@app.get("/api/lots")
def lots(db: Session = Depends(get_db)):
    rows = db.execute(
        select(Lot, func.count(Animal.id))
        .outerjoin(Animal, Animal.lot_id == Lot.id)
        .group_by(Lot.id)
        .order_by(Lot.entry_date.desc())
    ).all()
    return [{
        "id":lot.id,
        "code":lot.code,
        "entry_date":lot.entry_date,
        "target_weight_kg":float(lot.target_weight_kg) if lot.target_weight_kg is not None else None,
        "animal_count":count
    } for lot,count in rows]

@app.get("/api/animals")
def animals(db: Session = Depends(get_db)):
    rows = db.scalars(select(Animal).order_by(Animal.id.desc())).all()
    return [{
        "id":a.id,"ear_tag":a.ear_tag,"breed":a.breed,"sex":a.sex,"status":a.status,
        "entry_date":a.entry_date,"initial_weight_kg":float(a.initial_weight_kg),
        "purchase_price":float(a.purchase_price),
        "lot":a.lot.code if a.lot else None,
        "supplier":a.supplier.name if a.supplier else None
    } for a in rows]

@app.post("/api/purchases")
def create_purchase(payload: dict, db: Session = Depends(get_db)):
    entry_date = date.fromisoformat(payload["entry_date"])
    code = (payload.get("lot_code") or "").strip()
    if not code:
        raise HTTPException(400, "El código del lote es obligatorio.")
    if db.scalar(select(Lot).where(Lot.code == code)):
        raise HTTPException(409, "El código del lote ya existe.")
    animals_payload = payload.get("animals", [])
    if not animals_payload:
        raise HTTPException(400, "Agrega al menos un animal.")

    lot = Lot(
        code=code,
        entry_date=entry_date,
        target_weight_kg=Decimal(str(payload["target_weight_kg"])) if payload.get("target_weight_kg") else None,
        notes=payload.get("notes")
    )
    db.add(lot)
    db.flush()

    supplier_id = payload.get("supplier_id")
    total = Decimal("0")
    total_weight = Decimal("0")

    for item in animals_payload:
        tag = (item.get("ear_tag") or "").strip()
        if not tag:
            raise HTTPException(400, "Todos los animales deben tener arete.")
        if db.scalar(select(Animal).where(Animal.ear_tag == tag)):
            raise HTTPException(409, f"El arete {tag} ya existe.")
        weight = Decimal(str(item["weight_kg"]))
        price = Decimal(str(item["purchase_price"]))
        animal = Animal(
            ear_tag=tag,
            breed=item.get("breed"),
            sex=item.get("sex","Macho"),
            status="Activo",
            entry_date=entry_date,
            initial_weight_kg=weight,
            purchase_price=price,
            supplier_id=supplier_id,
            lot_id=lot.id,
            notes=item.get("notes")
        )
        db.add(animal)
        total += price
        total_weight += weight

    db.commit()
    return {
        "lot_id":lot.id,
        "lot_code":lot.code,
        "animals":len(animals_payload),
        "total_weight_kg":float(total_weight),
        "average_weight_kg":float(total_weight/len(animals_payload)),
        "investment":float(total)
    }

@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)):
    active = db.scalars(select(Animal).where(Animal.status=="Activo")).all()
    investment = sum((a.purchase_price for a in active), Decimal("0"))
    weight = sum((a.initial_weight_kg for a in active), Decimal("0"))
    return {
        "active_animals":len(active),
        "total_invested":float(investment),
        "initial_weight_kg":float(weight),
        "average_initial_weight_kg":float(weight/len(active)) if active else 0,
    }
