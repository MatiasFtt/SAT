# SAT — Sistema de Asistencia Técnica

Base funcional con React + Vite, Flask y Supabase PostgreSQL. No incluye módulo de tickets.

## Requisitos
- Node.js 20+
- Python 3.11+
- Proyecto Supabase

## Configurar Supabase
1. Crea un proyecto en Supabase.
2. En **Project Settings → Database → Connection string → URI**, copia la URI.
3. Crea `backend/.env` a partir de `.env.example` y configura `DATABASE_URL`.
4. No compartas ni publiques la contraseña de la base de datos.

Ejemplo:
```env
DATABASE_URL=postgresql://postgres:TU_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
FRONTEND_ORIGIN=http://localhost:5173
```

## Backend (PowerShell)
```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Edita .env con tus credenciales de Supabase
flask --app app init-db
flask --app app seed-demo
flask --app app run --debug
```
API: `http://127.0.0.1:5000`

## Frontend (otra terminal)
```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```
App: `http://localhost:5173`

## Funcionalidades
- Panel principal con indicadores y ordenes recientes
- Gestion de clientes
- Ordenes de servicio con estados e historial de auditoria
- Lista de tecnicos con disponibilidad y seleccion al crear ordenes
- Health check

## Produccion
La conexión a Supabase se realiza desde Flask. Nunca coloques `DATABASE_URL` ni la contraseña de PostgreSQL en React. Antes de producción, incorpora autenticación/autorización, validaciones robustas, HTTPS, rate limiting y migraciones (Alembic). `seed-demo` inserta datos de prueba.

## Usuarios y acceso

- Después de incorporar esta función, ejecuta una vez `flask --app app init-db` desde `backend` para crear la tabla `app_users`.
- Al abrir la aplicación sin cuentas, crea el primer usuario con una contraseña de al menos 8 caracteres.
- Usa el engranaje del perfil para agregar otra cuenta o cambiar de usuario.
- Por ahora las cuentas comparten los mismos clientes y órdenes; el inicio de sesión identifica al usuario, pero los datos aún no son privados por usuario.
- También puedes crear una cuenta desde el panel derecho de la pantalla de inicio de sesión; al registrarte, quedas conectado con esa cuenta.

## Tecnicos y asignaciones

Si Supabase ya estaba inicializado, detén Flask con Ctrl+C. Desde la carpeta backend, con el entorno virtual activo, ejecuta:

    flask --app app init-db

El comando crea la tabla technicians necesaria para la lista. Luego vuelve a iniciar Flask. Agrega los tecnicos desde la sección Tecnicos; solo los disponibles aparecerán al crear una orden.
## Publicar en Vercel

El proyecto se configura como una sola aplicacion Flask + React/Vite en el mismo dominio. Conecta el repositorio Git a Vercel y deja **Root Directory** en la carpeta raiz `sat_supabase_project`. El `vercel.json` define la compilacion y Flask sirve la API bajo `/api`.

Antes de desplegar, agrega estas variables en Vercel > Project Settings > Environment Variables (Production y Preview):

- `DATABASE_URL`: usa la URI **Transaction pooler** de Supabase (puerto 6543), no la conexion directa. Copia la URI desde Supabase > Connect y codifica los caracteres reservados de la contrasena.
- `SECRET_KEY`: una clave aleatoria larga para firmar las sesiones.
- `BOOTSTRAP_TOKEN`: otra clave aleatoria que usaras una sola vez al registrar la primera cuenta desde el login publicado.

No subas archivos `.env` al repositorio. Despues del primer registro, las cuentas adicionales solo se pueden crear desde Configuracion con una sesion iniciada. La variable de entorno `VERCEL` activa cookies seguras y el modo serverless.

La base Supabase debe tener sus tablas creadas; si aun no ejecutaste la inicializacion, usa `flask --app app init-db` localmente apuntando al mismo `DATABASE_URL` antes de publicar.

El plan Hobby de Vercel es gratuito para uso personal y no comercial. Si este sistema se usara en la operacion comercial de un negocio, revisa las condiciones del plan antes de publicarlo.