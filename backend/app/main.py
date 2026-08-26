from datetime import date
from decimal import Decimal, InvalidOperation
import os
import time

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Date, ForeignKey, Numeric, String, Text, UniqueConstraint, create_engine, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


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
    target_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class Animal(Base):
    __tablename__ = "animals"

    id: Mapped[int] = mapped_column(primary_key=True)
    ear_tag: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    breed: Mapped[str | None] = mapped_column(String(80), nullable=True)
    sex: Mapped[str] = mapped_column(String(20), default="Macho")
    status: Mapped[str] = mapped_column(String(30), default="Activo")
    entry_date: Mapped[date] = mapped_column(Date)
    initial_weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    purchase_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True)
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("lots.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    supplier: Mapped[Supplier | None] = relationship()
    lot: Mapped[Lot | None] = relationship()
    weighings: Mapped[list["Weighing"]] = relationship(back_populates="animal", cascade="all, delete-orphan")


class Weighing(Base):
    __tablename__ = "weighings"
    __table_args__ = (UniqueConstraint("animal_id", "weighing_date", name="uq_weighing_animal_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    animal_id: Mapped[int] = mapped_column(ForeignKey("animals.id"), index=True)
    weighing_date: Mapped[date] = mapped_column(Date, index=True)
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    animal: Mapped[Animal] = relationship(back_populates="weighings")


class Cost(Base):
    __tablename__ = "costs"

    id: Mapped[int] = mapped_column(primary_key=True)
    animal_id: Mapped[int | None] = mapped_column(ForeignKey("animals.id"), nullable=True)
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("lots.id"), nullable=True)
    cost_date: Mapped[date] = mapped_column(Date)
    category: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(String(250), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))


def init_db():
    for attempt in range(1, 11):
        try:
            Base.metadata.create_all(engine)
            return
        except OperationalError:
            if attempt == 10:
                raise
            time.sleep(2)


init_db()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


app = FastAPI(title="Sistema Ganadero API", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def parse_date(value: str, field_name: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{field_name} debe tener formato AAAA-MM-DD.")


def parse_decimal(value, field_name: str) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(400, f"{field_name} debe ser un número válido.")
    if number <= 0:
        raise HTTPException(400, f"{field_name} debe ser mayor que cero.")
    return number


def animal_weight_history(animal: Animal, db: Session) -> dict:
    rows = db.scalars(
        select(Weighing)
        .where(Weighing.animal_id == animal.id)
        .order_by(Weighing.weighing_date, Weighing.id)
    ).all()

    history = []
    previous_weight = animal.initial_weight_kg
    previous_date = animal.entry_date

    for weighing in rows:
        days = (weighing.weighing_date - previous_date).days
        gain = weighing.weight_kg - previous_weight
        gdp = gain / days if days > 0 else Decimal("0")
        total_days = (weighing.weighing_date - animal.entry_date).days
        accumulated_gain = weighing.weight_kg - animal.initial_weight_kg
        accumulated_gdp = accumulated_gain / total_days if total_days > 0 else Decimal("0")

        history.append({
            "id": weighing.id,
            "weighing_date": weighing.weighing_date,
            "weight_kg": float(weighing.weight_kg),
            "previous_weight_kg": float(previous_weight),
            "gain_kg": float(gain),
            "days": days,
            "gdp_kg_day": float(gdp),
            "accumulated_gain_kg": float(accumulated_gain),
            "days_since_entry": total_days,
            "gdp_since_entry_kg_day": float(accumulated_gdp),
            "notes": weighing.notes,
        })
        previous_weight = weighing.weight_kg
        previous_date = weighing.weighing_date

    days_since_entry = (previous_date - animal.entry_date).days
    total_gain = previous_weight - animal.initial_weight_kg
    gdp_since_entry = total_gain / days_since_entry if days_since_entry > 0 else Decimal("0")

    return {
        "animal": {
            "id": animal.id,
            "ear_tag": animal.ear_tag,
            "entry_date": animal.entry_date,
            "initial_weight_kg": float(animal.initial_weight_kg),
            "status": animal.status,
        },
        "current_weight_kg": float(previous_weight),
        "total_gain_kg": float(total_gain),
        "days_since_entry": days_since_entry,
        "gdp_kg_day": float(gdp_since_entry),
        "last_weighing_date": previous_date if rows else None,
        "history": history,
    }


def animal_summary(animal: Animal, db: Session) -> dict:
    metrics = animal_weight_history(animal, db)
    return {
        "id": animal.id,
        "ear_tag": animal.ear_tag,
        "breed": animal.breed,
        "sex": animal.sex,
        "status": animal.status,
        "entry_date": animal.entry_date,
        "initial_weight_kg": float(animal.initial_weight_kg),
        "current_weight_kg": metrics["current_weight_kg"],
        "total_gain_kg": metrics["total_gain_kg"],
        "days_since_entry": metrics["days_since_entry"],
        "gdp_kg_day": metrics["gdp_kg_day"],
        "last_weighing_date": metrics["last_weighing_date"],
        "purchase_price": float(animal.purchase_price),
        "lot": animal.lot.code if animal.lot else None,
        "supplier": animal.supplier.name if animal.supplier else None,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/suppliers")
def suppliers(db: Session = Depends(get_db)):
    return [{"id": s.id, "name": s.name, "phone": s.phone} for s in db.scalars(select(Supplier).order_by(Supplier.name)).all()]


@app.post("/api/suppliers")
def create_supplier(payload: dict, db: Session = Depends(get_db)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "El proveedor es obligatorio.")
    if db.scalar(select(Supplier).where(Supplier.name == name)):
        raise HTTPException(409, "El proveedor ya existe.")
    supplier = Supplier(name=name, phone=payload.get("phone"))
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return {"id": supplier.id, "name": supplier.name}


@app.get("/api/lots")
def lots(db: Session = Depends(get_db)):
    rows = db.execute(
        select(Lot, func.count(Animal.id))
        .outerjoin(Animal, Animal.lot_id == Lot.id)
        .group_by(Lot.id)
        .order_by(Lot.entry_date.desc())
    ).all()
    return [{
        "id": lot.id,
        "code": lot.code,
        "entry_date": lot.entry_date,
        "target_weight_kg": float(lot.target_weight_kg) if lot.target_weight_kg is not None else None,
        "animal_count": count,
    } for lot, count in rows]


@app.get("/api/animals")
def animals(db: Session = Depends(get_db)):
    rows = db.scalars(select(Animal).order_by(Animal.id.desc())).all()
    return [animal_summary(animal, db) for animal in rows]


@app.post("/api/purchases")
def create_purchase(payload: dict, db: Session = Depends(get_db)):
    entry_date = parse_date(payload.get("entry_date"), "La fecha de compra")
    code = (payload.get("lot_code") or "").strip()
    if not code:
        raise HTTPException(400, "El código del lote es obligatorio.")
    if db.scalar(select(Lot).where(Lot.code == code)):
        raise HTTPException(409, "El código del lote ya existe.")

    animals_payload = payload.get("animals", [])
    if not animals_payload:
        raise HTTPException(400, "Agrega al menos un animal.")

    seen_tags = set()
    lot = Lot(
        code=code,
        entry_date=entry_date,
        target_weight_kg=parse_decimal(payload["target_weight_kg"], "El peso objetivo") if payload.get("target_weight_kg") else None,
        notes=payload.get("notes"),
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
        if tag in seen_tags:
            raise HTTPException(409, f"El arete {tag} está repetido en esta compra.")
        if db.scalar(select(Animal).where(Animal.ear_tag == tag)):
            raise HTTPException(409, f"El arete {tag} ya existe.")
        seen_tags.add(tag)

        weight = parse_decimal(item.get("weight_kg"), f"El peso de {tag}")
        price = parse_decimal(item.get("purchase_price"), f"El precio de compra de {tag}")
        animal = Animal(
            ear_tag=tag,
            breed=item.get("breed"),
            sex=item.get("sex", "Macho"),
            status="Activo",
            entry_date=entry_date,
            initial_weight_kg=weight,
            purchase_price=price,
            supplier_id=supplier_id,
            lot_id=lot.id,
            notes=item.get("notes"),
        )
        db.add(animal)
        total += price
        total_weight += weight

    db.commit()
    return {
        "lot_id": lot.id,
        "lot_code": lot.code,
        "animals": len(animals_payload),
        "total_weight_kg": float(total_weight),
        "average_weight_kg": float(total_weight / len(animals_payload)),
        "investment": float(total),
    }


@app.get("/api/weighings")
def weighings(db: Session = Depends(get_db)):
    rows = db.execute(
        select(Weighing, Animal)
        .join(Animal, Animal.id == Weighing.animal_id)
        .order_by(Weighing.weighing_date.desc(), Weighing.id.desc())
    ).all()
    return [{
        "id": weighing.id,
        "animal_id": animal.id,
        "ear_tag": animal.ear_tag,
        "lot": animal.lot.code if animal.lot else None,
        "weighing_date": weighing.weighing_date,
        "weight_kg": float(weighing.weight_kg),
        "notes": weighing.notes,
    } for weighing, animal in rows]


@app.get("/api/weighings/animal/{animal_id}")
def animal_weighings(animal_id: int, db: Session = Depends(get_db)):
    animal = db.get(Animal, animal_id)
    if not animal:
        raise HTTPException(404, "Animal no encontrado.")
    return animal_weight_history(animal, db)


@app.post("/api/weighings/batch")
def create_batch_weighings(payload: dict, db: Session = Depends(get_db)):
    weighing_date = parse_date(payload.get("weighing_date"), "La fecha del pesaje")
    items = payload.get("items", [])
    if not items:
        raise HTTPException(400, "No hay animales para registrar.")

    seen_animals = set()
    created = []
    for item in items:
        try:
            animal_id = int(item.get("animal_id") or 0)
        except (TypeError, ValueError):
            raise HTTPException(400, "El identificador del animal es inválido.")
        if animal_id in seen_animals:
            raise HTTPException(409, "Un animal no puede aparecer dos veces en la misma jornada.")
        seen_animals.add(animal_id)

        animal = db.get(Animal, animal_id)
        if not animal:
            raise HTTPException(404, "Animal no encontrado.")
        if animal.status != "Activo":
            raise HTTPException(400, f"El animal {animal.ear_tag} no está activo.")

        weight = parse_decimal(item.get("weight_kg"), f"El peso de {animal.ear_tag}")
        if weighing_date < animal.entry_date:
            raise HTTPException(400, f"La fecha de {animal.ear_tag} no puede ser anterior a su compra.")
        if db.scalar(select(Weighing).where(Weighing.animal_id == animal.id, Weighing.weighing_date == weighing_date)):
            raise HTTPException(409, f"El animal {animal.ear_tag} ya tiene un pesaje registrado en esa fecha.")

        last_weighing = db.scalar(
            select(Weighing)
            .where(Weighing.animal_id == animal.id)
            .order_by(Weighing.weighing_date.desc(), Weighing.id.desc())
        )
        if last_weighing and weighing_date < last_weighing.weighing_date:
            raise HTTPException(400, f"La fecha de {animal.ear_tag} es anterior a su último pesaje.")

        weighing = Weighing(
            animal_id=animal.id,
            weighing_date=weighing_date,
            weight_kg=weight,
            notes=item.get("notes"),
        )
        db.add(weighing)
        created.append(animal.ear_tag)

    db.commit()
    return {
        "created": len(created),
        "animals": created,
        "message": f"{len(created)} pesajes registrados correctamente.",
    }


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)):
    active = db.scalars(select(Animal).where(Animal.status == "Activo")).all()
    investment = sum((animal.purchase_price for animal in active), Decimal("0"))
    initial_weight = sum((animal.initial_weight_kg for animal in active), Decimal("0"))
    summaries = [animal_weight_history(animal, db) for animal in active]
    current_weight = sum((Decimal(str(item["current_weight_kg"])) for item in summaries), Decimal("0"))
    animals_with_gain = [item for item in summaries if item["days_since_entry"] > 0]
    average_gdp = sum((Decimal(str(item["gdp_kg_day"])) for item in animals_with_gain), Decimal("0"))
    average_gdp = average_gdp / len(animals_with_gain) if animals_with_gain else Decimal("0")

    return {
        "active_animals": len(active),
        "total_invested": float(investment),
        "initial_weight_kg": float(initial_weight),
        "current_weight_kg": float(current_weight),
        "total_gain_kg": float(current_weight - initial_weight),
        "average_initial_weight_kg": float(initial_weight / len(active)) if active else 0,
        "average_current_weight_kg": float(current_weight / len(active)) if active else 0,
        "average_gdp_kg_day": float(average_gdp),
    }
