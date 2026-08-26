import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import "./styles.css";

const API=import.meta.env.VITE_API_URL||"http://localhost:8000";
const today=new Date().toISOString().slice(0,10);
const blankAnimal=()=>({ear_tag:"",weight_kg:"",purchase_price:"",breed:"",sex:"Macho"});

function money(v){return new Intl.NumberFormat("es-NI",{style:"currency",currency:"NIO",maximumFractionDigits:0}).format(v||0)}

function App(){
 const [page,setPage]=useState("dashboard"),[dash,setDash]=useState(null),[animals,setAnimals]=useState([]),[lots,setLots]=useState([]),[suppliers,setSuppliers]=useState([]),[message,setMessage]=useState("");
 async function load(){
  const [d,a,l,s]=await Promise.all(["dashboard","animals","lots","suppliers"].map(x=>fetch(`${API}/api/${x}`).then(r=>r.json())));
  setDash(d);setAnimals(a);setLots(l);setSuppliers(s);
 }
 useEffect(()=>{load()},[]);
 const nav=[["dashboard","Dashboard"],["purchases","Compras"],["animals","Animales"],["lots","Lotes"]];
 return <div className="app">
  <aside><div className="brand"><div className="logo">GC</div><div><b>Gestión Ganadera</b><small>Engorde</small></div></div>
   <nav>{nav.map(([id,label])=><button className={page===id?"active":""} onClick={()=>setPage(id)} key={id}>{label}</button>)}</nav>
   <div className="side-note">MVP 0.2<br/>Compra → Engorde → Venta</div>
  </aside>
  <main><header><div><span className="eyebrow">SISTEMA GANADERO</span><h1>{nav.find(x=>x[0]===page)?.[1]}</h1></div><button className="refresh" onClick={load}>Actualizar</button></header>
   {message&&<div className="toast">{message}</div>}
   {page==="dashboard"&&<Dashboard data={dash}/>}
   {page==="purchases"&&<Purchase suppliers={suppliers} onDone={(m)=>{setMessage(m);load()}}/>}
   {page==="animals"&&<Animals data={animals}/>}
   {page==="lots"&&<Lots data={lots}/>}
  </main>
 </div>
}

function Dashboard({data}){if(!data)return <p>Cargando...</p>;return <><div className="cards"><Card t="Animales activos" v={data.active_animals}/><Card t="Capital invertido" v={money(data.total_invested)}/><Card t="Peso inicial total" v={`${data.initial_weight_kg.toFixed(1)} kg`}/><Card t="Peso promedio compra" v={`${data.average_initial_weight_kg.toFixed(1)} kg`}/></div><div className="panel"><h2>Centro de control</h2><p className="muted">La base del sistema ya está conectada a PostgreSQL. El siguiente bloque será pesajes + costos para transformar estos datos en rentabilidad real.</p><div className="roadmap"><span>✓ Compra</span><span>✓ Lotes</span><span>✓ Animales</span><span>→ Pesajes</span><span>→ Costos</span><span>→ Venta</span></div></div></>}

function Card({t,v}){return <div className="card"><span>{t}</span><strong>{v}</strong></div>}

function Purchase({suppliers,onDone}){
 const [form,setForm]=useState({entry_date:today,lot_code:"",supplier_id:"",target_weight_kg:"",notes:""});
 const [rows,setRows]=useState([blankAnimal()]);
 const update=(k,v)=>setForm({...form,[k]:v});
 const updateRow=(i,k,v)=>setRows(rows.map((r,j)=>j===i?{...r,[k]:v}:r));
 const add=()=>setRows([...rows,blankAnimal()]);
 const remove=(i)=>setRows(rows.filter((_,j)=>j!==i));
 const total=rows.reduce((s,r)=>s+(Number(r.purchase_price)||0),0),kg=rows.reduce((s,r)=>s+(Number(r.weight_kg)||0),0);
 async function save(){
  if(!form.lot_code||rows.some(r=>!r.ear_tag||!r.weight_kg||!r.purchase_price)){alert("Completa lote, aretes, pesos y precios.");return}
  const r=await fetch(`${API}/api/purchases`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,supplier_id:form.supplier_id?Number(form.supplier_id):null,animals:rows.map(r=>({...r,weight_kg:Number(r.weight_kg),purchase_price:Number(r.purchase_price)}))})});
  const j=await r.json(); if(!r.ok){alert(j.detail||"Error");return}
  onDone(`Compra ${j.lot_code} registrada: ${j.animals} animales, ${j.total_weight_kg.toFixed(1)} kg, ${money(j.investment)} invertidos.`);
  setForm({entry_date:today,lot_code:"",supplier_id:"",target_weight_kg:"",notes:""});setRows([blankAnimal()]);
 }
 return <div className="panel"><div className="form-head"><div><h2>Nueva compra</h2><p className="muted">Registra la operación completa y crea el lote automáticamente.</p></div><button className="primary" onClick={save}>Guardar compra</button></div>
 <div className="grid"><label>Fecha<input type="date" value={form.entry_date} onChange={e=>update("entry_date",e.target.value)}/></label><label>Código de lote<input placeholder="ENG-2026-001" value={form.lot_code} onChange={e=>update("lot_code",e.target.value)}/></label><label>Proveedor<select value={form.supplier_id} onChange={e=>update("supplier_id",e.target.value)}><option value="">Seleccionar</option>{suppliers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label>Peso objetivo (kg)<input type="number" value={form.target_weight_kg} onChange={e=>update("target_weight_kg",e.target.value)} placeholder="Ej. 400"/></label></div>
 <h3>Animales de la compra</h3><div className="table-wrap"><table><thead><tr><th>Arete</th><th>Peso kg</th><th>Precio compra</th><th>Raza</th><th></th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td><input value={r.ear_tag} onChange={e=>updateRow(i,"ear_tag",e.target.value)}/></td><td><input type="number" step="0.1" value={r.weight_kg} onChange={e=>updateRow(i,"weight_kg",e.target.value)}/></td><td><input type="number" value={r.purchase_price} onChange={e=>updateRow(i,"purchase_price",e.target.value)}/></td><td><input value={r.breed} onChange={e=>updateRow(i,"breed",e.target.value)} placeholder="Opcional"/></td><td><button className="danger" onClick={()=>remove(i)} disabled={rows.length===1}>×</button></td></tr>)}</tbody></table></div>
 <button className="secondary" onClick={add}>+ Agregar animal</button><div className="summary"><b>{rows.length} animales</b><span>{kg.toFixed(1)} kg</span><strong>{money(total)}</strong></div></div>
}

function Animals({data}){return <div className="panel"><div className="form-head"><div><h2>Inventario de animales</h2><p className="muted">Cada novillo conserva su identificación, lote, peso inicial e inversión.</p></div></div><Table headers={["Arete","Lote","Proveedor","Peso inicial","Compra","Estado"]} rows={data.map(a=>[a.ear_tag,a.lot||"—",a.supplier||"—",`${a.initial_weight_kg} kg`,money(a.purchase_price),a.status])}/></div>}
function Lots({data}){return <div className="panel"><h2>Lotes de engorde</h2><Table headers={["Lote","Entrada","Animales","Peso objetivo"]} rows={data.map(l=>[l.code,l.entry_date,l.animal_count,l.target_weight_kg?`${l.target_weight_kg} kg`:"—"])}/></div>}
function Table({headers,rows}){return <div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i}>{r.map((x,j)=><td key={j}>{x}</td>)}</tr>):<tr><td className="empty" colSpan={headers.length}>No hay registros todavía.</td></tr>}</tbody></table></div>}

createRoot(document.getElementById("root")).render(<App/>);
