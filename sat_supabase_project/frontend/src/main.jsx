import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BriefcaseBusiness, CheckCircle2, ClipboardList, LayoutDashboard, Plus, Search, Settings, Users, Wrench, History, Menu, X } from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import "./styles.css";

const API = (() => {
  const configured = import.meta.env.VITE_API_URL;
  if (!configured) {
    const host = window.location.hostname;
    return ["localhost", "127.0.0.1"].includes(host)
      ? `http://${host}:5000/api`
      : "/api";
  }
  const url = new URL(configured, window.location.origin);
  const localHosts = ["localhost", "127.0.0.1"];
  if (localHosts.includes(window.location.hostname) && localHosts.includes(url.hostname)) {
    url.hostname = window.location.hostname;
  }
  return url.toString().replace(/\/$/, "");
})();
const colors = ["#2563eb", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444"];
const statuses = ["Pendiente", "En progreso", "En espera", "Completada", "Cancelada"];
const dateText = value => value ? new Date(value).toLocaleDateString("es-PY") : "—";

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      ...options,
    });
  } catch {
    throw Error(`No se pudo conectar con la API (${API}). Comprueba que Flask siga ejecutándose y abre el frontend desde localhost:5173 o 127.0.0.1:5173.`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.error || "No se pudo completar la operación");
  return body;
}

function App() {
  const [page, setPage] = useState("Dashboard");
  const [mobile, setMobile] = useState(false);
  const [dash, setDash] = useState(null);
  const [clients, setClients] = useState([]);
  const [orders, setOrders] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [audit, setAudit] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState("");
  const [busy, setBusy] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [hasUsers, setHasUsers] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userModal, setUserModal] = useState(false);
  const [userNotice, setUserNotice] = useState("");
  const [clientToDelete, setClientToDelete] = useState(null);
  const [deletingClient, setDeletingClient] = useState(false);

  async function load() {
    try {
      const [dashboard, clientRows, orderRows, technicianRows, auditRows] = await Promise.all([
        api("/dashboard"), api("/clients"), api("/work-orders"), api("/technicians"), api("/audit"),
      ]);
      setDash(dashboard); setClients(clientRows); setOrders(orderRows);
      setTechnicians(technicianRows); setAudit(auditRows); setError("");
    } catch (cause) { setError(cause.message); }
  }
  useEffect(() => {
    api("/auth/me").then(data => {
      setAuthUser(data.user);
      setHasUsers(data.has_users);
    }).catch(cause => setAuthError(cause.message)).finally(() => setAuthLoading(false));
  }, []);
  useEffect(() => { if (authUser) load(); }, [authUser]);

  const filteredClients = useMemo(() => clients.filter(client =>
    `${client.name} ${client.company || ""} ${client.email || ""}`.toLowerCase().includes(query.toLowerCase())), [clients, query]);
  const filteredOrders = useMemo(() => orders.filter(order =>
    `${order.code} ${order.title} ${order.client_name}`.toLowerCase().includes(query.toLowerCase())), [orders, query]);
  const activeOrders = filteredOrders.filter(order => order.status !== "Completada");
  const nav = [["Dashboard", LayoutDashboard], ["Órdenes de servicio", ClipboardList], ["Clientes", Users], ["Técnicos", Wrench], ["Auditoría", History]];

  async function submit(event) {
    event.preventDefault(); setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (modal === "client") await api("/clients", { method: "POST", body: JSON.stringify(data) });
      else if (modal === "technician") await api("/technicians", { method: "POST", body: JSON.stringify(data) });
      else {
        if (!data.client_id) data.client_id = null;
        await api("/work-orders", { method: "POST", body: JSON.stringify(data) });
      }
      setModal(""); await load();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function changeStatus(id, status) {
    try { await api(`/work-orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await load(); }
    catch (cause) { setError(cause.message); }
  }
  function deleteClient(id) {
    setError("");
    setClientToDelete(id);
  }
  async function confirmDeleteClient() {
    if (clientToDelete === null) return;
    setDeletingClient(true);
    try {
      await api(`/clients/${clientToDelete}`, { method: "DELETE" });
      setClientToDelete(null);
      await load();
    } catch (cause) { setError(cause.message); }
    finally { setDeletingClient(false); }
  }
  async function toggleTechnician(technician) {
    try {
      await api(`/technicians/${technician.id}`, { method: "PATCH", body: JSON.stringify({ available: !technician.available }) });
      await load();
    } catch (cause) { setError(cause.message); }
  }
  async function switchUser() {
    try { await api("/auth/logout", { method: "POST" }); }
    catch (cause) { setError(cause.message); }
    setAuthUser(null); setSettingsOpen(false); setError("");
  }
  async function createUser(event) {
    event.preventDefault(); setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api("/auth/register", { method: "POST", body: JSON.stringify(data) });
      setUserModal(false); setUserNotice(`Usuario ${result.user.username} creado correctamente.`);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  if (authLoading) return <div className="auth-loading">Cargando sesión…</div>;
  if (!authUser) return <AuthScreen hasUsers={hasUsers} initialError={authError} onAuthenticated={user => { setAuthUser(user); setHasUsers(true); setAuthError(""); }} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="brand"><img className="brand-logo" src="/sat-mark.svg" alt=""/><div><strong>Servicio Técnico</strong><small>Sistema de asistencia</small></div><button className="mobile-close" onClick={() => setMobile(false)}><X/></button></div>
        <div className="nav-label">GENERAL</div>
        {nav.map(([name, Icon]) => <button key={name} className={`nav-item ${page === name ? "active" : ""}`} onClick={() => { setPage(name); setMobile(false); setQuery(""); }}><Icon size={18}/><span>{name}</span></button>)}
        <div className="sidebar-bottom"><div className="profile"><div className="avatar">{authUser.username.slice(0, 2).toUpperCase()}</div><div><b>{authUser.username}</b><small>Usuario activo</small></div><button className="profile-settings" aria-label="Configuración de usuario" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(open => !open)}><Settings size={17}/></button></div>{settingsOpen && <div className="settings-menu"><div className="settings-menu-label">Sesión: {authUser.username}</div><button onClick={() => { setUserModal(true); setSettingsOpen(false); setUserNotice(""); }}>Agregar usuario</button><button onClick={switchUser}>Cambiar de usuario</button></div>}<small className="version">SAT v1.0 · Supabase</small></div>
      </aside>
      {mobile && <div className="scrim" onClick={() => setMobile(false)}/>}
      <main className="main">
        <header className="topbar"><button className="mobile-menu" onClick={() => setMobile(true)}><Menu/></button><div className="breadcrumb">Sistema <span>/</span> <b>{page}</b></div><div className="top-actions"><div className="top-user"><div className="avatar">{authUser.username.slice(0, 2).toUpperCase()}</div><span>{authUser.username}</span></div></div></header>
        <section className="content">
          <div className="page-heading"><div><h1>{page}</h1><p>Gestiona y supervisa las operaciones de asistencia técnica.</p></div>{page === "Clientes" && <button className="primary" onClick={() => setModal("client")}><Plus size={17}/> Nuevo cliente</button>}{page === "Técnicos" && <button className="primary" onClick={() => setModal("technician")}><Plus size={17}/> Agregar técnico</button>}{page === "Órdenes de servicio" && <button className="primary" onClick={() => setModal("order")}><Plus size={17}/> Nueva orden</button>}</div>
          {error && <div className="alert">{error}<button onClick={() => setError("")}>×</button></div>}
          {userNotice && <div className="success-message">{userNotice}<button onClick={() => setUserNotice("")}>×</button></div>}
          {page === "Dashboard" && <Dashboard dash={dash} orders={orders} clients={clients} setPage={setPage}/>}
          {page === "Clientes" && <ClientsPanel clients={filteredClients} query={query} setQuery={setQuery} onDelete={deleteClient}/>}
          {page === "Órdenes de servicio" && <OrdersPanel orders={activeOrders} query={query} setQuery={setQuery} onStatusChange={changeStatus}/>}
          {page === "Técnicos" && <TechniciansPanel technicians={technicians.filter(technician => `${technician.name} ${technician.specialty || ""} ${technician.phone || ""}`.toLowerCase().includes(query.toLowerCase()))} query={query} setQuery={setQuery} onToggle={toggleTechnician}/>}
          {page === "Auditoría" && <AuditPanel entries={audit}/>}
        </section>
      </main>
      {modal && <div className="modal-backdrop" onClick={() => setModal("")}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-head"><h2>{modal === "client" ? "Nuevo cliente" : modal === "technician" ? "Agregar técnico" : "Nueva orden de servicio"}</h2><button className="icon-button" onClick={() => setModal("")}><X size={18}/></button></div><form onSubmit={submit} className="form">{modal === "client" ? <><Field label="Nombre completo *" name="name" required/><Field label="Empresa" name="company"/><Field label="Correo electrónico" name="email" type="email"/><Field label="Teléfono" name="phone"/></> : modal === "technician" ? <><Field label="Nombre del técnico *" name="name" required/><Field label="Especialidad" name="specialty"/><Field label="Teléfono" name="phone" type="tel"/></> : <><Field label="Título *" name="title" required/><Field label="Descripción" name="description" textarea/><label>Cliente<select name="client_id"><option value="">Sin cliente asociado</option>{clients.map(client => <option value={client.id} key={client.id}>{client.name}</option>)}</select></label><div className="form-row"><label>Prioridad<select name="priority"><option>Baja</option><option>Media</option><option>Alta</option><option>Urgente</option></select></label><label>Técnico disponible<select name="assigned_to"><option value="">Sin asignar</option>{technicians.filter(technician => technician.available).map(technician => <option value={technician.name} key={technician.id}>{technician.name}{technician.specialty ? ` · ${technician.specialty}` : ""}</option>)}</select></label></div>{!technicians.some(technician => technician.available) && <p className="form-hint">Todavía no hay técnicos disponibles. Puedes crear la orden sin asignar y agregarlos desde la sección Técnicos.</p>}</>}<div className="form-actions"><button type="button" className="secondary" onClick={() => setModal("")}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></div></form></div></div>}
      {clientToDelete !== null && <div className="modal-backdrop confirm-backdrop" onClick={() => !deletingClient && setClientToDelete(null)}><div className="confirm-modal" role="dialog" aria-modal="true" aria-label="Confirmar eliminación de cliente" onClick={event => event.stopPropagation()}><p>¿Seguro de eliminar a este cliente?</p><div className="confirm-actions"><button type="button" className="secondary" disabled={deletingClient} onClick={() => setClientToDelete(null)}>Cancelar</button><button type="button" className="danger-confirm" disabled={deletingClient} onClick={confirmDeleteClient}>{deletingClient ? "Eliminando…" : "Aceptar"}</button></div></div></div>}
      {userModal && <div className="modal-backdrop" onClick={() => setUserModal(false)}><div className="modal user-modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title" onClick={event => event.stopPropagation()}><div className="modal-head"><h2 id="add-user-title">Agregar usuario</h2><button className="icon-button" onClick={() => setUserModal(false)}><X size={18}/></button></div><form className="form" onSubmit={createUser}><Field label="Nombre de usuario *" name="username" required/><Field label="Contraseña (mínimo 8 caracteres) *" name="password" type="password" required/><div className="form-actions"><button type="button" className="secondary" onClick={() => setUserModal(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Creando…" : "Crear usuario"}</button></div></form></div></div>}
    </div>
  );
}

function AuthScreen({ hasUsers, initialError, onAuthenticated }) {
  const [registering, setRegistering] = useState(!hasUsers);
  const [error, setError] = useState(initialError || "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setRegistering(!hasUsers), [hasUsers]);
  async function submit(event, mode) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api(mode === "register" ? "/auth/register" : "/auth/login", {
        method: "POST", body: JSON.stringify(data),
      });
      onAuthenticated(result.user);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  return <main className="auth-screen">
    <div className={`auth-container ${registering ? "right-panel-active" : ""}`}>
      <section className="auth-form-container auth-sign-up">
        <form className="auth-form" onSubmit={event => submit(event, "register")}>
          <SATBrand/><div className="auth-kicker">{hasUsers ? "NUEVA CUENTA" : "CONFIGURACIÓN INICIAL"}</div><h1>{hasUsers ? "Crear usuario" : "Crear primera cuenta"}</h1><span className="auth-subtitle">Usa una contraseña de al menos 8 caracteres.</span>
          {error && <div className="auth-error">{error}</div>}
          {!hasUsers && import.meta.env.PROD && <Field label="Código inicial del administrador" name="bootstrap_token" required/>}
          <Field label="Nombre de usuario" name="username" required/>
          <Field label="Contraseña" name="password" type="password" required/>
          <button className="auth-submit" disabled={busy}>{busy ? "Creando cuenta…" : "Crear cuenta"}</button>
          <button className="auth-switch" type="button" onClick={() => setRegistering(false)}>Ya tengo una cuenta</button>
        </form>
      </section>
      <section className="auth-form-container auth-sign-in">
        {hasUsers ? <form className="auth-form" onSubmit={event => submit(event, "login")}>
          <SATBrand/><div className="auth-kicker">SISTEMA DE ASISTENCIA TÉCNICA</div><h1>Iniciar sesión</h1><span className="auth-subtitle">Ingresa con tu cuenta para continuar.</span>
          {error && <div className="auth-error">{error}</div>}
          <Field label="Nombre de usuario" name="username" required/>
          <Field label="Contraseña" name="password" type="password" required/>
          <button className="auth-submit" disabled={busy}>{busy ? "Ingresando…" : "Entrar"}</button>
        </form> : <div className="auth-info-panel"><div className="auth-mark"><Wrench size={22}/></div><h1>Bienvenido a SAT</h1><p>Primero crea una cuenta para proteger el acceso al sistema.</p><button className="auth-switch" type="button" onClick={() => setRegistering(true)}>Crear primera cuenta</button></div>}
      </section>
      <div className="auth-overlay-container"><div className="auth-overlay">
        <section className="auth-overlay-panel auth-overlay-left"><div className="auth-emblem"><Wrench size={23}/></div><h1>¡Qué bueno verte!</h1><p>Inicia sesión para continuar gestionando tus servicios.</p><button className="auth-ghost" type="button" onClick={() => setRegistering(false)}>Iniciar sesión</button></section>
        <section className="auth-overlay-panel auth-overlay-right"><img className="auth-tool-logo" src="/sat-mark.svg" alt="Logo de Servicio Técnico"/><h1>Asistencia técnica, en un solo lugar</h1><p>Registra clientes, organiza órdenes de servicio y da seguimiento a cada trabajo hasta su resolución.</p><small className="auth-system-note">CLIENTES · ÓRDENES · SEGUIMIENTO</small></section>
      </div></div>
    </div>
  </main>;
}

function SATBrand() {
  return <div className="sat-branding"><img src="/sat-mark.svg" alt=""/><div><div className="sat-brand-title"><span>Servicio</span> <strong>Técnico</strong></div><div className="sat-brand-caption">SISTEMA DE ASISTENCIA TÉCNICA</div></div></div>;
}

function Dashboard({ dash, orders, clients, setPage }) {
  const data = dash?.orders_by_status || [];
  return <><div className="stats-grid"><Stat icon={Users} label="Total de clientes" value={dash?.total_clients ?? "—"} trend="Clientes registrados" tint="blue"/><Stat icon={ClipboardList} label="Órdenes totales" value={dash?.total_orders ?? "—"} trend="Órdenes registradas" tint="purple"/><Stat icon={Activity} label="Órdenes abiertas" value={dash?.open_orders ?? "—"} trend="Pendientes de resolución" tint="orange"/><Stat icon={Wrench} label="Técnicos disponibles" value={dash?.available_technicians ?? 0} trend="Listos para nuevas órdenes" tint="green"/></div><div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><h2>Órdenes por estado</h2><p>Distribución actual del trabajo</p></div></div>{data.length ? <div className="chart-area"><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={data} dataKey="count" nameKey="status" innerRadius={65} outerRadius={95} paddingAngle={3}>{data.map((item, index) => <Cell key={item.status} fill={colors[index % colors.length]}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer><div className="legend">{data.map((item, index) => <div key={item.status}><i style={{ background: colors[index % colors.length] }}/><span>{item.status}</span><b>{item.count}</b></div>)}</div></div> : <Empty text="Aún no hay órdenes registradas."/>}</section><section className="panel"><div className="panel-heading"><div><h2>Órdenes recientes</h2><p>Últimas solicitudes de servicio</p></div><button className="text-button" onClick={() => setPage("Órdenes de servicio")}>Ver todas</button></div><div className="recent-list">{orders.slice(0, 5).map(order => <div className="recent-item" key={order.id}><div className="recent-icon"><BriefcaseBusiness size={17}/></div><div className="recent-main"><b>{order.title}</b><small>{order.code} · {order.client_name}</small></div><Status value={order.status}/></div>)}{!orders.length && <Empty text="No hay órdenes recientes."/>}</div></section></div><section className="panel"><div className="panel-heading"><div><h2>Clientes recientes</h2><p>Últimos clientes incorporados</p></div><button className="text-button" onClick={() => setPage("Clientes")}>Ver clientes</button></div><div className="client-cards">{clients.slice(0, 4).map(client => <div className="client-card" key={client.id}><div className="mini-avatar">{client.name[0].toUpperCase()}</div><div><b>{client.name}</b><small>{client.company || client.email || "Cliente"}</small></div></div>)}</div></section></>;
}
function ClientsPanel({ clients, query, setQuery, onDelete }) { return <section className="panel"><PanelHeader title="Clientes registrados" count={clients.length} query={query} setQuery={setQuery}/><div className="table-wrap"><table><thead><tr><th>CLIENTE</th><th>EMPRESA</th><th>EMAIL</th><th>TELÉFONO</th><th>ALTA</th><th/></tr></thead><tbody>{clients.map(client => <tr key={client.id}><td><div className="person"><div className="mini-avatar">{client.name[0].toUpperCase()}</div><b>{client.name}</b></div></td><td>{client.company || "—"}</td><td>{client.email || "—"}</td><td>{client.phone || "—"}</td><td>{dateText(client.created_at)}</td><td><button type="button" className="client-delete" title="Eliminar cliente" aria-label={`Eliminar cliente ${client.name}`} onClick={() => onDelete(client.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-3 6h14l-1.05 12.1A2 2 0 0 1 15.96 23H8.04a2 2 0 0 1-1.99-1.9L5 9Z"/><path className="client-delete__slots" d="M9.5 11v8m5-8v8"/></svg></button></td></tr>)}</tbody></table>{!clients.length && <Empty text="No hay clientes para mostrar."/>}</div></section>; }
function OrdersPanel({ orders, query, setQuery, onStatusChange }) { return <section className="panel"><PanelHeader title="Órdenes de servicio" count={orders.length} query={query} setQuery={setQuery}/><div className="table-wrap"><table><thead><tr><th>ORDEN</th><th>DESCRIPCIÓN</th><th>CLIENTE</th><th>PRIORIDAD</th><th>RESPONSABLE</th><th>ESTADO</th><th>FECHA</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><b className="code">{order.code}</b></td><td><b>{order.title}</b><small className="subcell">{order.description || ""}</small></td><td>{order.client_name}</td><td><Priority value={order.priority}/></td><td>{order.assigned_to || "Sin asignar"}</td><td><StatusControl value={order.status} onChange={status => onStatusChange(order.id, status)}/></td><td>{dateText(order.created_at)}</td></tr>)}</tbody></table>{!orders.length && <Empty text="No hay órdenes para mostrar."/>}</div></section>; }
function TechniciansPanel({ technicians, query, setQuery, onToggle }) {
  const available = technicians.filter(technician => technician.available).length;
  return <section className="panel"><PanelHeader title="Lista de técnicos" count={technicians.length} query={query} setQuery={setQuery}/><p className="technician-summary">{available} de {technicians.length} técnicos disponibles para asignar a nuevas órdenes.</p><div className="table-wrap"><table className="technicians-table"><thead><tr><th>TÉCNICO</th><th>ESPECIALIDAD</th><th>TELÉFONO</th><th>DISPONIBILIDAD</th><th/></tr></thead><tbody>{technicians.map(technician => <tr key={technician.id}><td><div className="person"><div className="mini-avatar"><Wrench size={15}/></div><b>{technician.name}</b></div></td><td>{technician.specialty || "General"}</td><td>{technician.phone || "—"}</td><td><span className={`technician-state ${technician.available ? "available" : "unavailable"}`}><i/>{technician.available ? "Disponible" : "No disponible"}</span></td><td><button type="button" className="secondary small" onClick={() => onToggle(technician)}>{technician.available ? "Marcar ocupado" : "Marcar disponible"}</button></td></tr>)}</tbody></table>{!technicians.length && <Empty text="Aún no hay técnicos. Agrégalos para asignarlos a las órdenes de servicio."/>}</div></section>;
}
function AuditPanel({ entries }) { return <section className="panel"><PanelHeader title="Registro de auditoría" count={entries.length}/><div className="table-wrap"><table><thead><tr><th>FECHA</th><th>ACCIÓN</th><th>ENTIDAD</th><th>ID</th><th>DETALLE</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td>{new Date(entry.created_at).toLocaleString("es-PY")}</td><td><span className="audit-action">{entry.action}</span></td><td>{entry.entity}</td><td>{entry.entity_id ?? "—"}</td><td>{entry.details}</td></tr>)}</tbody></table>{!entries.length && <Empty text="Todavía no hay eventos auditados."/>}</div></section>; }
function Stat({ icon: Icon, label, value, trend, tint }) { return <div className="stat-card"><div className={`stat-icon ${tint}`}><Icon size={20}/></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-trend">{trend}</div></div>; }
function PanelHeader({ title, count, query, setQuery }) { return <div className="panel-heading"><div><h2>{title}</h2><p>{count} registros</p></div>{setQuery && <div className="searchbox"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar…"/></div>}</div>; }
function Field({ label, name, type = "text", required, textarea }) { return <label>{label}{textarea ? <textarea name={name} rows="3"/> : <input name={name} type={type} required={required}/>}</label>; }
function StatusControl({ value, onChange }) {
  const progressStages = statuses.slice(0, 4);
  const activeIndex = progressStages.indexOf(value);
  return <div className="status-control">
    <select className={`status-select ${statusClass(value)}`} value={value} onChange={event => onChange(event.target.value)} aria-label={`Estado: ${value}`}>
      {statuses.map(status => <option className={`status-option ${statusClass(status)}`} key={status} value={status}>{status}</option>)}
    </select>
    <div className={`order-progress ${statusClass(value)}`} aria-hidden="true">
      {progressStages.map((stage, index) => <span key={stage} className={`progress-segment ${index <= activeIndex ? "is-active" : ""} ${index === activeIndex ? "is-current" : ""} ${statusClass(stage)}`}/>) }
    </div>
  </div>;
}
function Status({ value }) { return <span className={`status ${statusClass(value)}`}>{value}</span>; }
function Priority({ value }) { return <span className={`priority ${(value || "").toLowerCase()}`}>{value}</span>; }
function Empty({ text }) { return <div className="empty"><CheckCircle2 size={24}/><p>{text}</p></div>; }
function statusClass(value) { return (value || "").toLowerCase().replaceAll(" ", "-"); }

createRoot(document.getElementById("root")).render(<App/>);





