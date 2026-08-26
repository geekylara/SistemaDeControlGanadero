import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const today = new Date().toISOString().slice(0, 10);
const blankAnimal = () => ({ ear_tag: "", weight_kg: "", purchase_price: "", breed: "", sex: "Macho" });

function money(value) {
  return new Intl.NumberFormat("es-NI", {
    style: "currency",
    currency: "NIO",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function kg(value, digits = 1) {
  return `${Number(value || 0).toFixed(digits)} kg`;
}

function gdp(value) {
  return `${Number(value || 0).toFixed(2)} kg/día`;
}

async function readJson(response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || "Ocurrió un error.");
  }
  return data;
}

function App() {
  const [page, setPage] = useState("dashboard");
  const [dash, setDash] = useState(null);
  const [animals, setAnimals] = useState([]);
  const [lots, setLots] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [weighings, setWeighings] = useState([]);
  const [message, setMessage] = useState("");

  async function load() {
    const [dashboard, animalRows, lotRows, supplierRows, weighingRows] = await Promise.all(
      ["dashboard", "animals", "lots", "suppliers", "weighings"].map((path) =>
        fetch(`${API}/api/${path}`).then(readJson)
      )
    );
    setDash(dashboard);
    setAnimals(animalRows);
    setLots(lotRows);
    setSuppliers(supplierRows);
    setWeighings(weighingRows);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  const nav = [
    ["dashboard", "Dashboard"],
    ["purchases", "Compras"],
    ["animals", "Animales"],
    ["lots", "Lotes"],
    ["weighings", "Pesajes"],
  ];

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="logo">GC</div>
          <div>
            <b>Gestión Ganadera</b>
            <small>Engorde</small>
          </div>
        </div>
        <nav>
          {nav.map(([id, label]) => (
            <button className={page === id ? "active" : ""} onClick={() => setPage(id)} key={id}>
              {label}
            </button>
          ))}
        </nav>
        <div className="side-note">MVP 0.3<br />Compra → Pesaje → GDP</div>
      </aside>

      <main>
        <header>
          <div>
            <span className="eyebrow">SISTEMA GANADERO</span>
            <h1>{nav.find((item) => item[0] === page)?.[1]}</h1>
          </div>
          <button className="refresh" onClick={() => load().catch((error) => setMessage(error.message))}>
            Actualizar
          </button>
        </header>

        {message && <div className="toast">{message}</div>}
        {page === "dashboard" && <Dashboard data={dash} />}
        {page === "purchases" && <Purchase suppliers={suppliers} onDone={(text) => { setMessage(text); load(); }} />}
        {page === "animals" && <Animals data={animals} />}
        {page === "lots" && <Lots data={lots} />}
        {page === "weighings" && (
          <Weighings
            animals={animals}
            weighings={weighings}
            onDone={(text) => {
              setMessage(text);
              load();
            }}
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({ data }) {
  if (!data) return <p>Cargando...</p>;

  return (
    <>
      <div className="cards">
        <Card title="Animales activos" value={data.active_animals} />
        <Card title="Capital invertido" value={money(data.total_invested)} />
        <Card title="Kg actuales en finca" value={kg(data.current_weight_kg)} />
        <Card title="GDP promedio" value={gdp(data.average_gdp_kg_day)} />
      </div>
      <div className="panel">
        <h2>Centro de control</h2>
        <p className="muted">
          El sistema ya conserva historial de peso por animal y calcula ganancia acumulada, días en finca y GDP.
        </p>
        <div className="roadmap">
          <span>✓ Compra</span>
          <span>✓ Lotes</span>
          <span>✓ Animales</span>
          <span>✓ Pesajes</span>
          <span>→ Costos</span>
          <span>→ Venta</span>
        </div>
      </div>
      <div className="cards secondary-cards">
        <Card title="Peso inicial total" value={kg(data.initial_weight_kg)} />
        <Card title="Ganancia acumulada" value={kg(data.total_gain_kg)} />
        <Card title="Peso promedio compra" value={kg(data.average_initial_weight_kg)} />
        <Card title="Peso promedio actual" value={kg(data.average_current_weight_kg)} />
      </div>
    </>
  );
}

function Card({ title, value }) {
  return (
    <div className="card">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Purchase({ suppliers, onDone }) {
  const [form, setForm] = useState({ entry_date: today, lot_code: "", supplier_id: "", target_weight_kg: "", notes: "" });
  const [rows, setRows] = useState([blankAnimal()]);
  const update = (key, value) => setForm({ ...form, [key]: value });
  const updateRow = (index, key, value) => setRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  const add = () => setRows([...rows, blankAnimal()]);
  const remove = (index) => setRows(rows.filter((_, rowIndex) => rowIndex !== index));
  const total = rows.reduce((sum, row) => sum + (Number(row.purchase_price) || 0), 0);
  const weight = rows.reduce((sum, row) => sum + (Number(row.weight_kg) || 0), 0);

  async function save() {
    if (!form.lot_code || rows.some((row) => !row.ear_tag || !row.weight_kg || !row.purchase_price)) {
      alert("Completa lote, aretes, pesos y precios.");
      return;
    }

    try {
      const response = await fetch(`${API}/api/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
          animals: rows.map((row) => ({
            ...row,
            weight_kg: Number(row.weight_kg),
            purchase_price: Number(row.purchase_price),
          })),
        }),
      });
      const result = await readJson(response);
      onDone(`Compra ${result.lot_code} registrada: ${result.animals} animales, ${kg(result.total_weight_kg)}, ${money(result.investment)} invertidos.`);
      setForm({ entry_date: today, lot_code: "", supplier_id: "", target_weight_kg: "", notes: "" });
      setRows([blankAnimal()]);
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div className="panel">
      <div className="form-head">
        <div>
          <h2>Nueva compra</h2>
          <p className="muted">Registra la operación completa y crea el lote automáticamente.</p>
        </div>
        <button className="primary" onClick={save}>Guardar compra</button>
      </div>
      <div className="grid">
        <label>Fecha<input type="date" value={form.entry_date} onChange={(event) => update("entry_date", event.target.value)} /></label>
        <label>Código de lote<input placeholder="ENG-2026-001" value={form.lot_code} onChange={(event) => update("lot_code", event.target.value)} /></label>
        <label>Proveedor<select value={form.supplier_id} onChange={(event) => update("supplier_id", event.target.value)}><option value="">Seleccionar</option>{suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>
        <label>Peso objetivo (kg)<input type="number" value={form.target_weight_kg} onChange={(event) => update("target_weight_kg", event.target.value)} placeholder="Ej. 400" /></label>
      </div>
      <h3>Animales de la compra</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Arete</th><th>Peso kg</th><th>Precio compra</th><th>Raza</th><th></th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td><input value={row.ear_tag} onChange={(event) => updateRow(index, "ear_tag", event.target.value)} /></td>
                <td><input type="number" step="0.1" value={row.weight_kg} onChange={(event) => updateRow(index, "weight_kg", event.target.value)} /></td>
                <td><input type="number" value={row.purchase_price} onChange={(event) => updateRow(index, "purchase_price", event.target.value)} /></td>
                <td><input value={row.breed} onChange={(event) => updateRow(index, "breed", event.target.value)} placeholder="Opcional" /></td>
                <td><button className="danger" onClick={() => remove(index)} disabled={rows.length === 1}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="secondary" onClick={add}>+ Agregar animal</button>
      <div className="summary"><b>{rows.length} animales</b><span>{kg(weight)}</span><strong>{money(total)}</strong></div>
    </div>
  );
}

function animalSearchText(animal) {
  return [
    animal.ear_tag,
    animal.lot,
    animal.breed,
    animal.supplier,
  ].filter(Boolean).join(" ");
}

function AnimalSearchSelect({ label, animals, excludeIds = [], placeholder, emptyText, actionLabel, onSelect }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const filteredAnimals = useMemo(() => {
    const text = search.trim().toLowerCase();
    const excluded = new Set(excludeIds);
    return animals
      .filter((animal) => !excluded.has(animal.id))
      .filter((animal) => !text || animalSearchText(animal).toLowerCase().includes(text))
      .slice(0, 12);
  }, [animals, excludeIds, search]);

  function pickAnimal() {
    const exactMatch = filteredAnimals.find((animal) => animal.ear_tag.toLowerCase() === search.trim().toLowerCase());
    const animal = filteredAnimals.find((item) => String(item.id) === selectedId) || exactMatch || (filteredAnimals.length === 1 ? filteredAnimals[0] : null);
    if (!animal) {
      alert("Digita y selecciona una coincidencia de la lista.");
      return;
    }
    onSelect(animal);
    setSearch("");
    setSelectedId("");
  }

  return (
    <div className="searchable-picker">
      <label>
        {label}
        <input
          placeholder={placeholder}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setSelectedId("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              pickAnimal();
            }
          }}
        />
      </label>
      <select
        size={Math.min(Math.max(filteredAnimals.length, 2), 6)}
        value={selectedId}
        onChange={(event) => setSelectedId(event.target.value)}
        onDoubleClick={pickAnimal}
      >
        {filteredAnimals.length ? filteredAnimals.map((animal) => (
          <option value={animal.id} key={animal.id}>
            {animal.ear_tag} | {animal.lot || "Sin lote"} | actual {kg(animal.current_weight_kg)}
          </option>
        )) : <option value="">{emptyText}</option>}
      </select>
      <button className="secondary" type="button" onClick={pickAnimal}>{actionLabel}</button>
    </div>
  );
}

function Weighings({ animals, weighings, onDone }) {
  const activeAnimals = animals.filter((animal) => animal.status === "Activo");
  const [dateValue, setDateValue] = useState(today);
  const [rows, setRows] = useState([]);
  const [history, setHistory] = useState(null);

  const pendingSummary = useMemo(() => {
    const validRows = rows.filter((row) => row.weight_kg !== "");
    const total = validRows.reduce((sum, row) => sum + (Number(row.weight_kg) || 0), 0);
    return { count: validRows.length, total };
  }, [rows]);

  function addAnimal(animal) {
    if (rows.some((row) => row.animal_id === animal.id)) {
      alert("Ese animal ya está en la jornada.");
      return;
    }
    setRows([
      ...rows,
      {
        animal_id: animal.id,
        ear_tag: animal.ear_tag,
        initial_weight_kg: animal.initial_weight_kg,
        current_weight_kg: animal.current_weight_kg,
        weight_kg: "",
        notes: "",
      },
    ]);
  }

  const addAllActive = () => {
    const existing = new Set(rows.map((row) => row.animal_id));
    const newRows = activeAnimals
      .filter((animal) => !existing.has(animal.id))
      .map((animal) => ({
        animal_id: animal.id,
        ear_tag: animal.ear_tag,
        initial_weight_kg: animal.initial_weight_kg,
        current_weight_kg: animal.current_weight_kg,
        weight_kg: "",
        notes: "",
      }));
    setRows([...rows, ...newRows]);
  };

  const update = (index, key, value) => setRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  const remove = (index) => setRows(rows.filter((_, rowIndex) => rowIndex !== index));

  async function save() {
    const validRows = rows.filter((row) => row.weight_kg !== "");
    if (!validRows.length) {
      alert("Agrega al menos un peso.");
      return;
    }

    try {
      const response = await fetch(`${API}/api/weighings/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weighing_date: dateValue,
          items: validRows.map((row) => ({
            animal_id: row.animal_id,
            weight_kg: Number(row.weight_kg),
            notes: row.notes,
          })),
        }),
      });
      const result = await readJson(response);
      onDone(result.message);
      setRows([]);
      setHistory(null);
    } catch (error) {
      alert(error.message);
    }
  }

  async function view(id) {
    try {
      const response = await fetch(`${API}/api/weighings/animal/${id}`);
      setHistory(await readJson(response));
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div className="weighings-layout">
      <div className="panel">
        <div className="form-head">
          <div>
            <h2>Jornada de pesaje</h2>
            <p className="muted">Registra manualmente varios animales en una misma fecha.</p>
          </div>
          <button className="primary" onClick={save}>Guardar pesajes</button>
        </div>
        <div className="grid two">
          <label>Fecha<input type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} /></label>
          <AnimalSearchSelect
            label="Buscar animal"
            animals={activeAnimals}
            excludeIds={rows.map((row) => row.animal_id)}
            placeholder="Digita arete, lote, raza..."
            emptyText="No hay animales activos que coincidan."
            actionLabel="+ Agregar coincidencia"
            onSelect={addAnimal}
          />
        </div>
        <div className="button-row">
          <button className="secondary" onClick={addAllActive}>+ Agregar activos</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Arete</th><th>Peso anterior</th><th>Peso nuevo kg</th><th>Ganancia</th><th>Observación</th><th></th></tr></thead>
            <tbody>
              {rows.length ? rows.map((row, index) => {
                const gain = row.weight_kg === "" ? null : Number(row.weight_kg) - Number(row.current_weight_kg);
                return (
                  <tr key={row.animal_id}>
                    <td><b>{row.ear_tag}</b></td>
                    <td>{kg(row.current_weight_kg)}</td>
                    <td><input type="number" step="0.1" value={row.weight_kg} onChange={(event) => update(index, "weight_kg", event.target.value)} /></td>
                    <td>{gain === null ? "—" : kg(gain)}</td>
                    <td><input value={row.notes} onChange={(event) => update(index, "notes", event.target.value)} /></td>
                    <td><button className="danger" onClick={() => remove(index)}>×</button></td>
                  </tr>
                );
              }) : <tr><td colSpan="6" className="empty">Selecciona animales para comenzar.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="summary"><b>{pendingSummary.count} con peso</b><span>Total jornada: {kg(pendingSummary.total)}</span></div>
      </div>

      <div className="panel">
        <h2>Historial individual</h2>
        <p className="muted">Consulta la evolución de un animal.</p>
        <AnimalSearchSelect
          label="Buscar animal"
          animals={animals}
          placeholder="Digita arete, lote, raza..."
          emptyText="No hay animales que coincidan."
          actionLabel="Ver historial"
          onSelect={(animal) => view(animal.id)}
        />
        {history && (
          <>
            <div className="mini-cards">
              <Card title="Peso inicial" value={kg(history.animal.initial_weight_kg)} />
              <Card title="Peso actual" value={kg(history.current_weight_kg)} />
              <Card title="Ganancia" value={kg(history.total_gain_kg)} />
              <Card title="GDP compra" value={gdp(history.gdp_kg_day)} />
            </div>
            <WeightChart history={history.history} initialWeight={history.animal.initial_weight_kg} />
            <Table
              headers={["Fecha", "Peso", "Ganancia", "Días", "GDP tramo", "GDP compra"]}
              rows={history.history.map((item) => [
                item.weighing_date,
                kg(item.weight_kg),
                kg(item.gain_kg),
                item.days,
                gdp(item.gdp_kg_day),
                gdp(item.gdp_since_entry_kg_day),
              ])}
            />
          </>
        )}
      </div>

      <div className="panel wide-panel">
        <h2>Pesajes recientes</h2>
        <Table
          headers={["Fecha", "Arete", "Lote", "Peso", "Observación"]}
          rows={weighings.slice(0, 12).map((item) => [
            item.weighing_date,
            item.ear_tag,
            item.lot || "—",
            kg(item.weight_kg),
            item.notes || "—",
          ])}
        />
      </div>
    </div>
  );
}

function WeightChart({ history, initialWeight }) {
  const points = [{ weighing_date: "Compra", weight_kg: initialWeight }, ...history];
  const max = Math.max(...points.map((point) => Number(point.weight_kg)), 1);

  return (
    <div className="weight-chart">
      {points.map((point, index) => (
        <div className="bar-row" key={`${point.weighing_date}-${index}`}>
          <span>{point.weighing_date}</span>
          <div><i style={{ width: `${Math.max((Number(point.weight_kg) / max) * 100, 4)}%` }} /></div>
          <strong>{kg(point.weight_kg)}</strong>
        </div>
      ))}
    </div>
  );
}

function Animals({ data }) {
  return (
    <div className="panel">
      <div className="form-head">
        <div>
          <h2>Inventario de animales</h2>
          <p className="muted">Cada novillo conserva su identificación, lote, peso inicial, peso actual y GDP.</p>
        </div>
      </div>
      <Table
        headers={["Arete", "Lote", "Proveedor", "Peso inicial", "Peso actual", "Ganancia", "GDP", "Estado"]}
        rows={data.map((animal) => [
          animal.ear_tag,
          animal.lot || "—",
          animal.supplier || "—",
          kg(animal.initial_weight_kg),
          kg(animal.current_weight_kg),
          kg(animal.total_gain_kg),
          gdp(animal.gdp_kg_day),
          animal.status,
        ])}
      />
    </div>
  );
}

function Lots({ data }) {
  return (
    <div className="panel">
      <h2>Lotes de engorde</h2>
      <Table
        headers={["Lote", "Entrada", "Animales", "Peso objetivo"]}
        rows={data.map((lot) => [
          lot.code,
          lot.entry_date,
          lot.animal_count,
          lot.target_weight_kg ? kg(lot.target_weight_kg) : "—",
        ])}
      />
    </div>
  );
}

function Table({ headers, rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          )) : <tr><td className="empty" colSpan={headers.length}>No hay registros todavía.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
