# FogonClick

FogonClick es un sistema web para la operación de un restaurante. Incluye inicio de sesión por roles, administración de productos e insumos, caja, pedidos de cocina, pagos QR con Factus Pay y facturación electrónica con Factus. El servidor usa Node.js y Express; la interfaz se sirve desde `Public/` y los datos se guardan en PostgreSQL mediante Supabase.

Esta guía explica cómo clonar el repositorio, instalar lo necesario y probar el mismo ambiente que usa el equipo.

## 1. Qué necesitas instalar

- **Git para Windows**, para clonar el repositorio.
- **Node.js 20.6 o posterior**, que incluye npm. La versión mínima se debe al uso de `--env-file` en el comando de inicio.
- **Un editor de código** como Visual Studio Code (opcional).

No necesitas instalar XAMPP, Apache, MySQL ni PostgreSQL. El proyecto corre con Node.js y se conecta a Supabase por internet.

Comprueba que Git y Node estén disponibles desde PowerShell:

```powershell
git --version
node --version
npm --version
```

## 2. Clonar e instalar

1. En GitHub, abre el repositorio, presiona **Code** y copia la URL para clonar.
2. En PowerShell, sustituye `URL_DEL_REPOSITORIO` por esa URL y ejecuta:

```powershell
git clone URL_DEL_REPOSITORIO RESTAURANTE
cd RESTAURANTE
npm ci
```

`npm ci` instala las dependencias fijadas en `package-lock.json`. Si descargas el repositorio como ZIP, extrae la carpeta, abre PowerShell dentro de ella y ejecuta `npm ci`.

El equipo debe compartirte el archivo `.env` de pruebas. Guárdalo en la carpeta raíz del proyecto, junto a `server.js` y `package.json`. **No uses `.env.example` para conectarte al ambiente del equipo:** contiene valores de ejemplo, no las credenciales actuales.

Npm usa `package.json`; `pakage.json` es un archivo antiguo con el nombre mal escrito.

## 3. Probar el ambiente del equipo

Para usar la base de datos y las integraciones que ya tiene el equipo:

1. Confirma que el archivo compartido se llame exactamente `.env` y esté en la raíz del proyecto.
2. No cambies sus valores ni ejecutes el esquema SQL sobre la base de datos compartida.
3. Sigue los pasos de la sección 6, **Arrancar la aplicación**.

Con ese `.env` no necesitas crear otro proyecto de Supabase ni cuentas propias de Factus, Factus Pay o Gmail. Se comparte con los integrantes para las pruebas, pero se mantiene fuera de Git.

## 4. Crear un ambiente independiente (opcional)

Sigue estos pasos únicamente si quieres usar una base de datos y credenciales propias:

1. Crea un proyecto en Supabase.
2. En **SQL Editor**, ejecuta todo el archivo [`Documentos/supabase_schema.sql`](Documentos/supabase_schema.sql). Este es el esquema actual de PostgreSQL.
3. En una base recién creada, antes del primer registro, ejecuta este ajuste para que la primera empresa tenga el ID 7:

   ```sql
   SELECT setval(pg_get_serial_sequence('public.empresa', 'id_empresa'), 6, true);
   ```

   El panel de administración de esta versión trabaja con la empresa de ID 7. No ejecutes el ajuste si ya hay datos en `empresa`; verifica que exista la empresa con ese ID.

4. Copia `.env.example` como `.env`. Desde **Project Settings → API** en Supabase, reemplaza los valores de ejemplo por la URL y las claves de tu proyecto:

   ```dotenv
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   SUPABASE_SECRET_KEY=sb_secret_...
   ```

   La clave secreta solo se usa en el servidor. No la pongas en archivos de `Public/`.

5. Configura Factus, Factus Pay o Gmail si vas a probar esas funciones (consulta la sección siguiente).
6. Arranca el servidor y crea la cuenta inicial desde **Registrarse**. El formulario crea la empresa y su administrador.
7. El esquema crea las tablas y estados, pero no incluye el catálogo del restaurante. Agrega categorías, unidades de medida, proveedores, insumos y productos desde administración.

No ejecutes `Documentos/restaurante_pruebas.sql` en Supabase: es un respaldo antiguo de MySQL, no el esquema actual.

## 5. Variables de entorno

Si pruebas el ambiente del equipo, conserva el `.env` que te compartieron. La tabla describe las variables para entender la configuración o crear un ambiente propio.

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase. |
| `SUPABASE_PUBLISHABLE_KEY` | Clave publicable usada por el servidor para Supabase Auth. |
| `SUPABASE_SECRET_KEY` | Clave privada del servidor para las consultas a la base de datos. |
| `FACTUS_BASE_URL` | URL de Factus para facturación electrónica; la plantilla usa sandbox. |
| `FACTUS_CLIENT_ID` | Identificador OAuth de Factus. |
| `FACTUS_CLIENT_SECRET` | Secreto OAuth de Factus. |
| `FACTUS_USERNAME` | Usuario de la cuenta Factus. |
| `FACTUS_PASSWORD` | Contraseña de la cuenta Factus. |
| `FACTUS_NUMBERING_RANGE_ID` | Opcional: rango de numeración si la cuenta tiene varios activos. |
| `FACTUS_PAY_BASE_URL` | URL de Factus Pay; la plantilla usa sandbox. |
| `FACTUS_PAY_EMAIL` | Correo de la cuenta Factus Pay. |
| `FACTUS_PAY_PASSWORD` | Contraseña de Factus Pay. |
| `GMAIL_EMAIL` | Cuenta Gmail que envía las facturas. |
| `GMAIL_APP_PASSWORD` | Contraseña de aplicación de Google, no la contraseña normal. |
| `PORT` | Opcional: puerto local; por defecto `3000`. Agrega esta variable al `.env` si necesitas otro puerto. |

Los valores de Factus y Factus Pay de `.env.example` apuntan a **sandbox**. En un ambiente propio, usa las URL y credenciales del mismo entorno. Para Gmail, activa la verificación en dos pasos y genera una contraseña de aplicación de 16 caracteres. El envío se hace con Nodemailer por SMTP de Gmail.

## 6. Arrancar la aplicación

Desde la carpeta raíz ejecuta:

```powershell
npm start
```

Abre [http://localhost:3000/Index.html](http://localhost:3000/Index.html). Express sirve directamente los archivos HTML, CSS y JavaScript; no hay que compilar el frontend.

Para detener el servidor, usa `Ctrl+C` en la terminal donde ejecutaste `npm start`. Si el puerto 3000 está ocupado, agrega `PORT=3001` al `.env` y abre `http://localhost:3001/Index.html`.

## 7. Cómo funciona

1. El navegador carga los paneles desde `Public/` y sus controladores usan `fetch` para comunicarse con el backend.
2. Node.js y Express sirven los archivos, validan sesiones y exponen las rutas internas bajo `/api/`. Socket.IO gestiona el chat.
3. `Models/database.js` accede a Supabase desde el servidor; las claves privadas no se envían al navegador.
4. El inicio de sesión determina el rol del empleado y permite entrar a administración, caja o cocina.
5. Caja valida productos y existencias, registra pedidos y solicita a Factus Pay el recaudo QR. El sistema consulta el estado del pago y confirma la compra cuando Factus Pay lo reporta y el monto coincide. Si el QR sigue pendiente después de diez minutos, vence y se cancela el pedido.
6. Después de confirmar el pago, el servidor solicita la factura a Factus y revisa el resultado de validación. Si se activa el envío por correo, descarga el PDF y lo envía al correo indicado usando Nodemailer y SMTP de Gmail.
7. Cocina consulta pedidos y actualiza su estado durante la preparación.

La estructura sigue una separación tipo MVC: `Public/Controllers/` coordina las acciones de la interfaz y `Models/` agrupa las rutas, la lógica del servidor, las integraciones externas y el acceso a Supabase.

### Rutas principales

| Ruta | Acceso | Uso |
|---|---|---|
| `/api/auth` | Registro e inicio de sesión | Crea la cuenta inicial y valida el acceso de los empleados. |
| `/api/admin` | Sesión autenticada de administración | Gestiona la información del restaurante. |
| `/api/caja` | Rol `admin` o `caja` | Catálogo, pedidos, pagos QR y facturas. |
| `/api/cocina` | Rol `admin` o `cocina` | Consulta y actualiza pedidos de cocina. |
| `/reportes` | Archivos estáticos | Sirve las páginas de reportes. |

### Carpetas principales

```text
Models/                 Rutas Express, autenticación, lógica y acceso a Supabase
Public/                 HTML, CSS, JavaScript, imágenes y recursos de la interfaz
Public/Controllers/     Controladores del navegador para los paneles
Reportes/               Páginas y recursos de reportes
Documentos/             Esquemas de base de datos y documentos del proyecto
server.js               Configuración de Express, Socket.IO, archivos estáticos y rutas
package.json            Dependencias y comando npm start
package-lock.json       Versiones instaladas por npm ci
.env.example            Plantilla con los nombres de variables
```

## Datos y seguridad

- El equipo comparte `.env` por separado para que sus integrantes prueben el mismo ambiente. No lo agregues a Git; `.gitignore` ya lo excluye.
- Este proyecto personal guarda y muestra la contraseña del empleado en la tabla `empleado`. Usa datos de prueba y no reutilices contraseñas de otras cuentas.
- Conserva las credenciales de servicios en `.env`; las llamadas a Factus se realizan desde el servidor.
- Los PDF generados en `Public/facturas/` también se excluyen del repositorio.

## Problemas comunes

- **`node` o `npm` no se reconoce:** instala Node.js 20.6 o posterior y abre una terminal nueva.
- **`node: bad option: --env-file`:** actualiza Node.js a la versión mínima requerida.
- **Falla `npm ci`:** confirma que ejecutaste el comando en la carpeta que contiene `package.json` y `package-lock.json`.
- **Aparece `fetch failed` o falla el inicio de sesión:** confirma que el `.env` esté junto a `server.js`, que sea el archivo compartido por el equipo y que tengas conexión a internet.
- **No se pueden administrar empleados:** verifica que exista la empresa con `id_empresa = 7`, requisito de la configuración actual del panel.
- **El catálogo aparece vacío:** registra categorías, unidades, proveedores, insumos y productos desde administración.
- **Error `EADDRINUSE`:** el puerto está ocupado; detén el servidor anterior con `Ctrl+C` o configura otro `PORT`.
- **Factus o Factus Pay rechaza una solicitud:** confirma que URL y credenciales sean del mismo ambiente (sandbox o producción) y que los datos requeridos estén completos.
- **Gmail rechaza el acceso:** usa una contraseña de aplicación de Google asociada a `GMAIL_EMAIL`, no la contraseña normal, y reinicia el servidor después de cambiar `.env`.

El proyecto todavía no tiene una suite automatizada de pruebas; `npm test` es el comando de ejemplo que viene en `package.json`.
