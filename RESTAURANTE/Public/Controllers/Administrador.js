// PANEL ADMINISTRADOR

// URL base de la API del servidor backend
const URL_API = 'http://localhost:3000/api/admin';

// Variable para controlar auto-refresh de inventario
let intervaloInventario = null;


// NAVEGACIÓN ENTRE SECCIONES

// Muestra la sección clickeada y oculta las demás.
// También carga los datos de esa sección desde el servidor.
function mostrarSeccion(seccion) {
    
    // Oculta todas las secciones y desactiva todos los botones del sidebar
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    // Muestra la sección seleccionada
    const seccionEl = document.getElementById(seccion);
    if (seccionEl) seccionEl.classList.add('active');
    
    // Activa el botón del sidebar correspondiente
    const botonEl = document.querySelector(`.nav-item[data-section="${seccion}"]`);
    if (botonEl) botonEl.classList.add('active');

    //  Recargar insumos al volver a la pestaña
    if (seccion === 'inventario') {
        window.addEventListener('focus', recargarInsumosSiEsInventario);
    } else {
        window.removeEventListener('focus', recargarInsumosSiEsInventario);
    }

    // Carga los datos de cada sección según corresponda
    if (seccion === 'estadisticas') cargarEstadisticas();
    if (seccion === 'empleados') cargarEmpleados();
    if (seccion === 'proveedores') cargarProveedores();
    if (seccion === 'inventario') cargarInsumos();           
    if (seccion === 'recetas') cargarRecetas();
    if (seccion === 'menu') cargarProductos();
    if (seccion === 'facturas') cargarFacturas();
    if (seccion === 'reportes') cargarReportes();
}

// Recarga insumos solo si estamos en la sección de inventario
function recargarInsumosSiEsInventario() {
    const seccionInventario = document.getElementById('inventario');
    if (seccionInventario && seccionInventario.classList.contains('active')) {
        cargarInsumos();
    }
}

// INICIALIZACIÓN

// Cierra el modal al hacer clic fuera de él
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.modal-overlay').forEach(m => {
        m.addEventListener('click', e => { 
            if (e.target === m) m.classList.remove('active'); 
        });
    });
    
    // Carga la primera sección por defecto
    mostrarSeccion('estadisticas');
});

// Lee la empresa guardada al iniciar sesión; el servidor valida la empresa desde la sesión.
function getIdEmpresa() {
    const id = localStorage.getItem('id_empresa');
    if (!id || id === 'null' || id === 'undefined') {
        console.warn('⚠️ No hay id_empresa en localStorage. Usando fallback 1.');
        return 1;
    }
    return parseInt(id);
}

// Obtiene del navegador el identificador del empleado autenticado.
function getIdEmpleado() {
    return localStorage.getItem('id_empleado');
}

// Devuelve el rol guardado en la sesión local del panel.
function getRol() {
    return localStorage.getItem('rol');
}

// Evita que los datos de empleados, incluida su contraseña visible, se interpreten como HTML.
function escaparHTML(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, caracter => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[caracter]);
}

// Limpia la sesión local y vuelve a la página de inicio de sesión.
function cerrarSesion() {
    localStorage.clear();
    window.location.href = '../index.html';
}

// Consulta los empleados en la BD y llena la tabla del HTML
async function cargarEmpleados() {
    try {
        const res = await fetch(`${URL_API}/empleados`);
        const datos = await res.json();
        if (!datos.success) return;

        const tbody = document.getElementById('tabla-empleados');
        
        if (!datos.empleados || datos.empleados.length === 0) {
            tbody.innerHTML = '';
            return;
        }

        // Ordena: admin primero, luego el resto
        const ordenados = datos.empleados.sort((a, b) => {
            if (a.ROL === 'admin' && b.ROL !== 'admin') return -1;
            if (a.ROL !== 'admin' && b.ROL === 'admin') return 1;
            return 0;
        });

        tbody.innerHTML = ordenados.map(e => `
            <tr>
                <td>${e.ID}</td>
                <td>${e.NOMBRE}</td>
                <td>${e.CEDULA || ''}</td>
                <td>${e.CORREO}</td>
                <td>${escaparHTML(e.CONTRASENA || 'Sin configurar')}</td>
                <td>${e.ROL}</td>
                <td>${e.TELEFONO || ''}</td>
            </tr>
        `).join('');
    } catch (e) {}
}

//Agregar Empleados:
// Abre el modal para agregar un nuevo empleado
function Form_Agregar_Empleado() {
    document.getElementById('emp-id').value = '';
    document.getElementById('form-empleado').reset();
    document.getElementById('emp-modal-titulo').textContent = 'Nuevo Empleado';
    document.getElementById('modal-empleado').classList.add('active');
}

// Guarda el nuevo empleado en la BD
async function guardarEmpleado(e) {
    e.preventDefault();

    const payload = {
        cedula: document.getElementById('reg-cedula').value.trim(),
        nombre: document.getElementById('emp-nombre').value.trim(),
        correo: document.getElementById('emp-correo').value.trim(),
        telefono: document.getElementById('emp-telefono').value.trim() || null,
        password: document.getElementById('emp-password').value,
        rol: document.getElementById('emp-rol').value
    };

    try {
        const res = await fetch(`${URL_API}/empleados`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-empleado');
            cargarEmpleados();
        } else {
            alert(datos.message || 'Error al guardar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

//Elimina Empleado:
// Abre el modal para eliminar un empleado
function Form_Eliminar_Empleado() {
    cargarSelectEmpleadosEliminar();
    document.getElementById('elim-emp-id').value = '';
    document.getElementById('modal-eliminar-empleado').classList.add('active');
}

// Carga el select de empleados excluyendo al admin
async function cargarSelectEmpleadosEliminar() {
    try {
        const res = await fetch(`${URL_API}/empleados`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('elim-emp-selector');
        // Filtra: solo muestra empleados que NO sean admin
        const filtrados = datos.empleados.filter(e => {
            const rol = String(e.ROL || '').trim().toLowerCase();
            return rol !== 'admin' && rol !== 'administrador';
        });

        select.innerHTML = '<option value="">-- Elige un empleado --</option>' +
            filtrados.map(e => `<option value="${e.ID}">${escaparHTML(e.NOMBRE)} — ${escaparHTML(e.ROL)} — C.C. ${escaparHTML(e.CEDULA)}</option>`).join('');
    } catch (e) {}
}

// Guarda el ID del empleado seleccionado en el input hidden
function onCambiarEmpleadoEliminar() {
    const id = document.getElementById('elim-emp-selector').value;
    document.getElementById('elim-emp-id').value = id;
}

// Confirma y elimina el empleado de la BD
async function confirmarEliminarEmpleado(e) {
    e.preventDefault();
    const id = document.getElementById('elim-emp-id').value;
    if (!id) {
        alert('Selecciona un empleado para eliminar');
        return;
    }

    if (!confirm('¿Estás seguro de eliminar este empleado?')) return;

    try {
        const res = await fetch(`${URL_API}/empleados/${id}`, { method: 'DELETE' });
        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-eliminar-empleado');
            cargarEmpleados();
        } else {
            alert(datos.message || 'Error al eliminar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

// EDITAR EMPLEADO:
// Abre el modal para editar un empleado
async function Form_Editar_Empleado() {
    try {
        const res = await fetch(`${URL_API}/empleados`);
        const datos = await res.json();
        if (!datos.success) return;

        // Llena el select con todos los empleados
        const select = document.getElementById('edit-emp-selector');
        select.innerHTML = '<option value="">-- Elige un empleado --</option>' +
            datos.empleados.map(e => `<option value="${e.ID}">${e.NOMBRE} (${e.ROL})</option>`).join('');

        // Limpia todos los campos incluyendo el ID
        document.getElementById('edit-emp-id').value = '';
        document.getElementById('edit-emp-cedula').value = '';
        document.getElementById('edit-emp-nombre').value = '';
        document.getElementById('edit-emp-rol').value = '';
        document.getElementById('edit-emp-correo').value = '';
        document.getElementById('edit-emp-telefono').value = '';
        document.getElementById('edit-emp-password').value = '';
        ['edit-emp-cedula', 'edit-emp-nombre', 'edit-emp-rol', 'edit-emp-correo', 'edit-emp-telefono']
            .forEach(id => delete document.getElementById(id).dataset.original);

        document.getElementById('modal-editar-empleado').classList.add('active');
    } catch (e) {}
}

// Carga los datos del empleado seleccionado en el formulario
function onCambiarEmpleadoEditar() {
    const id = document.getElementById('edit-emp-selector').value;
    
    // Si no hay selección, limpia todo
    if (!id) {
        document.getElementById('edit-emp-id').value = '';
        document.getElementById('edit-emp-cedula').value = '';
        document.getElementById('edit-emp-nombre').value = '';
        document.getElementById('edit-emp-rol').value = '';
        document.getElementById('edit-emp-correo').value = '';
        document.getElementById('edit-emp-telefono').value = '';
        document.getElementById('edit-emp-password').value = '';
        return;
    }

    // Guarda el ID inmediatamente
    document.getElementById('edit-emp-id').value = id;

    // Carga datos del empleado seleccionado
    fetch(`${URL_API}/empleados/${id}`)
        .then(r => r.json())
        .then(datos => {
            if (!datos.success) {
                // Si falla la carga, limpia el ID
                document.getElementById('edit-emp-id').value = '';
                return;
            }
            const e = datos.empleado;
            const rolId = ({ cocina: '2', caja: '3' })[String(e.ROL || '').trim().toLowerCase()] || '';
            
            // Pre-llena los campos con los valores actuales
            const campos = {
                'edit-emp-cedula': e.CEDULA || '',
                'edit-emp-nombre': e.NOMBRE || '',
                'edit-emp-rol': rolId,
                'edit-emp-correo': e.CORREO || '',
                'edit-emp-telefono': e.TELEFONO || ''
            };
            for (const [campoId, valor] of Object.entries(campos)) {
                const campo = document.getElementById(campoId);
                campo.value = valor;
                campo.dataset.original = valor;
            }
            document.getElementById('edit-emp-password').value = '';
        })
        .catch(() => {
            document.getElementById('edit-emp-id').value = '';
        });
}

// Guarda los cambios del empleado editado
async function guardarEdicionEmpleado(e) {
    e.preventDefault();

    // Intenta obtener el ID, si está vacío usa el select
    let id = document.getElementById('edit-emp-id').value;
    if (!id) {
        id = document.getElementById('edit-emp-selector').value;
    }

    if (!id) {
        alert('Selecciona un empleado del listado');
        return;
    }

    // Solo envía los campos que cambiaron para no actualizar el correo de Auth sin necesidad.
    const payload = {};

    const cedula = document.getElementById('edit-emp-cedula').value.trim();
    if (cedula && cedula !== document.getElementById('edit-emp-cedula').dataset.original) payload.cedula = cedula;
    
    const nombre = document.getElementById('edit-emp-nombre').value.trim();
    if (nombre && nombre !== document.getElementById('edit-emp-nombre').dataset.original) payload.nombre = nombre;
    
    const correo = document.getElementById('edit-emp-correo').value.trim();
    if (correo && correo !== document.getElementById('edit-emp-correo').dataset.original) payload.correo = correo;
    
    const telefono = document.getElementById('edit-emp-telefono').value.trim();
    if (telefono && telefono !== document.getElementById('edit-emp-telefono').dataset.original) payload.telefono = telefono;
    
    const rol = document.getElementById('edit-emp-rol').value;
    if (rol && rol !== document.getElementById('edit-emp-rol').dataset.original) payload.rol = rol;
    
    const password = document.getElementById('edit-emp-password').value;
    if (password) payload.password = password;

    // Si no hay nada que actualizar
    if (Object.keys(payload).length === 0) {
        alert('No hay cambios para guardar');
        return;
    }

    try {
        const res = await fetch(`${URL_API}/empleados/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-editar-empleado');
            cargarEmpleados();
        } else {
            alert(datos.message || 'Error al actualizar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}


// PROVEEDORES

// Consulta los proveedores en la BD y llenar la tabla
async function cargarProveedores() {
    try {
        const res = await fetch(`${URL_API}/proveedores`);
        const datos = await res.json();
        if (!datos.success) return;

        const tbody = document.getElementById('tabla-proveedores');
        if (!datos.proveedores || datos.proveedores.length === 0) {
            tbody.innerHTML = '';
            return;
        }

        tbody.innerHTML = datos.proveedores.map(p => `
            <tr>
                <td>${p.ID}</td>
                <td>${p.NOMBRE}</td>
                <td>${p.CORREO || '-'}</td>
                <td>${p.TELEFONO || '-'}</td>
            </tr>
        `).join('');
    } catch (e) {}
}

// AGREGAR PROVEEDOR
// Abre el modal para agregar un nuevo proveedor
function Agregar_Proveedor() {
    document.getElementById('prov-id').value = '';
    document.getElementById('form-proveedor').reset();
    document.getElementById('prov-modal-titulo').textContent = 'Nuevo Proveedor';
    document.getElementById('modal-proveedor').classList.add('active');
}

// Guarda el nuevo proveedor en la BD
async function guardarProveedor(e) {
    e.preventDefault();

    const payload = {
        id_empresa: getIdEmpresa(),
        nombre: document.getElementById('prov-nombre').value.trim(),
        correo: document.getElementById('prov-correo').value.trim() || null,
        telefono: document.getElementById('prov-telefono').value.trim() || null
    };

    try {
        const res = await fetch(`${URL_API}/proveedores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-proveedor');
            cargarProveedores();
        } else {
            alert(datos.message || 'Error al guardar proveedor');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

//ELIMINAR PROVEEDOR
// Abre el modal para eliminar un proveedor
async function Eliminar_Proveedor() {
    try {
        const res = await fetch(`${URL_API}/proveedores`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('elim-prov-selector');
        select.innerHTML = '<option value="">-- Elige un proveedor --</option>' +
            datos.proveedores.map(p => `<option value="${p.ID}">${p.NOMBRE} — ${p.CORREO || 'Sin correo'}</option>`).join('');

        document.getElementById('elim-prov-id').value = '';
        document.getElementById('modal-eliminar-proveedor').classList.add('active');
    } catch (e) {}
}

// Guarda el ID del proveedor seleccionado
function onCambiarProveedorEliminar() {
    const id = document.getElementById('elim-prov-selector').value;
    document.getElementById('elim-prov-id').value = id;
}

// Confirma y elimina el proveedor de la BD
async function confirmarEliminarProveedor(e) {
    e.preventDefault();
    const id = document.getElementById('elim-prov-id').value;
    if (!id) {
        alert('Selecciona un proveedor para eliminar');
        return;
    }

    if (!confirm('¿Estás seguro de eliminar este proveedor?')) return;

    try {
        const res = await fetch(`${URL_API}/proveedores/${id}`, { method: 'DELETE' });
        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-eliminar-proveedor');
            cargarProveedores();
        } else {
            alert(datos.message || 'Error al eliminar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

//EDITAR PROVEEDOR
// Abre el modal para editar un proveedor
async function Editar_Proveedor() {
    try {
        const res = await fetch(`${URL_API}/proveedores`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('edit-prov-selector');
        select.innerHTML = '<option value="">-- Elige un proveedor --</option>' +
            datos.proveedores.map(p => `<option value="${p.ID}">${p.NOMBRE}</option>`).join('');

        // Limpia todos los campos
        document.getElementById('edit-prov-id').value = '';
        document.getElementById('edit-prov-nombre').value = '';
        document.getElementById('edit-prov-correo').value = '';
        document.getElementById('edit-prov-telefono').value = '';

        document.getElementById('modal-editar-proveedor').classList.add('active');
    } catch (e) {}
}

// Carga los datos del proveedor seleccionado en el formulario
function onCambiarProveedorEditar() {
    const id = document.getElementById('edit-prov-selector').value;
    
    // Si no hay selección, limpia todo
    if (!id) {
        document.getElementById('edit-prov-id').value = '';
        document.getElementById('edit-prov-nombre').value = '';
        document.getElementById('edit-prov-correo').value = '';
        document.getElementById('edit-prov-telefono').value = '';
        return;
    }

    // Guarda el ID inmediatamente
    document.getElementById('edit-prov-id').value = id;

    // Carga datos del proveedor seleccionado
    fetch(`${URL_API}/proveedores/${id}`)
        .then(r => r.json())
        .then(datos => {
            if (!datos.success) {
                document.getElementById('edit-prov-id').value = '';
                return;
            }
            const p = datos.proveedor;
            
            // Pre-llena los campos con los valores actuales
            document.getElementById('edit-prov-nombre').value = p.NOMBRE;
            document.getElementById('edit-prov-correo').value = p.CORREO;
            document.getElementById('edit-prov-telefono').value = p.TELEFONO || '';
        })
        .catch(() => {
            document.getElementById('edit-prov-id').value = '';
        });
}

// Guarda los cambios del proveedor editado
async function guardarEdicionProveedor(e) {
    e.preventDefault();

    const id = document.getElementById('edit-prov-id').value;
    if (!id) {
        alert('Selecciona un proveedor del listado');
        return;
    }

    // Solo envía los campos que tienen valor
    const payload = {};
    
    const nombre = document.getElementById('edit-prov-nombre').value.trim();
    if (nombre) payload.nombre = nombre;
    
    const correo = document.getElementById('edit-prov-correo').value.trim();
    if (correo) payload.correo = correo;
    
    const telefono = document.getElementById('edit-prov-telefono').value.trim();
    if (telefono) payload.telefono = telefono;

    if (Object.keys(payload).length === 0) {
        alert('No hay cambios para guardar');
        return;
    }

    try {
        const res = await fetch(`${URL_API}/proveedores/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-editar-proveedor');
            cargarProveedores();
        } else {
            alert(datos.message || 'Error al actualizar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}


// INSUMOS

// Consulta los insumos en la BD y llena la tabla
async function cargarInsumos() {
    try {
        const res = await fetch(`${URL_API}/insumos`);
        const datos = await res.json();
        
        // DEBUG: Ver qué devuelve el servidor
        console.log('Respuesta insumos:', datos);
        
        if (!datos.success) return;

        const tbody = document.getElementById('tabla-ingredientes');
        if (!datos.insumos || datos.insumos.length === 0) {
            tbody.innerHTML = '';
            return;
        }

        tbody.innerHTML = datos.insumos.map(i => {
           
            let fecha = '-';
            if (i.FECHA_VENCIMIENTO) {
                const f = new Date(i.FECHA_VENCIMIENTO);
                fecha = f.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }
            
            return `
                <tr>
                    <td>${i.ID}</td>
                    <td>${i.NOMBRE}</td>
                    <td>${i.UNIDAD}</td>
                    <td>${i.STOCK}</td>
                    <td>${fecha}</td>
                    <td>${i.PROVEEDOR || i.proveedor || 'Sin proveedor'}</td>
                </tr>
            `;
        }).join('');

    } catch (e) {}
}

//AGREGAR INSUMO
// Abre el modal para agregar un nuevo insumo
async function Agregar_INSUMO() {
    document.getElementById('ing-id').value = '';
    document.getElementById('form-ingrediente').reset();
    document.getElementById('ing-modal-titulo').textContent = 'Nuevo Ingrediente';
    
    // Carga proveedores en el select
    await cargarSelectProveedores();
    
    document.getElementById('modal-ingrediente').classList.add('active');
}

// Carga los proveedores en el select del modal insumo
async function cargarSelectProveedores() {
    try {
        const res = await fetch(`${URL_API}/proveedores`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('ing-proveedor');
        select.innerHTML = '<option value="">-- Sin proveedor --</option>' +
            datos.proveedores.map(p => `<option value="${p.ID}">${p.NOMBRE}</option>`).join('');
    } catch (e) {}
}

// Guarda el nuevo insumo en la BD
// Si en un insumo directo osea un producto tambien se guarda en la entidad producto
// Obtiene el ID de la empresa del usuario logueado
async function guardarIngrediente(e) {
    e.preventDefault();

    const fechaVencimiento = document.getElementById('ing-fecha-vencimiento').value;
    if (fechaVencimiento) {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const fechaIngresada = new Date(fechaVencimiento + 'T00:00:00');
        if (fechaIngresada <= hoy) {
            alert('La fecha de vencimiento debe ser posterior a hoy');
            return;
        }
    }

    const esDirecto = document.getElementById('ing-es-directo').checked;
    const proveedorId = document.getElementById('ing-proveedor').value;

    const payload = {
        id_empresa: getIdEmpresa(),
        id_proveedor: proveedorId ? parseInt(proveedorId) : null,
        nombre: document.getElementById('ing-nombre').value.trim(),
        unidad: document.getElementById('ing-unidad').value.trim(),
        stock: parseFloat(document.getElementById('ing-stock').value),
        fecha_vencimiento: fechaVencimiento || null,
        es_producto_directo: esDirecto,
        costo_compra: parseFloat(document.getElementById('ing-costo').value)
    };

    if (esDirecto) {
        // Validación obligatoria por JS 
        const precio = parseFloat(document.getElementById('ing-precio').value);
        if (!precio || precio <= 0) {
            alert('El precio es obligatorio para productos directos');
            document.getElementById('ing-precio').focus();
            return;
        }
        payload.precio = precio;

        // si eligió nueva, tomar el texto del input
        let categoria = document.getElementById('ing-categoria').value;
        if (categoria === '__nueva__') {
            categoria = document.getElementById('ing-categoria-nueva').value.trim();
            if (!categoria) {
                alert('Escribe el nombre de la nueva categoría');
                document.getElementById('ing-categoria-nueva').focus();
                return;
            }
        }
        if (!categoria) {
            alert('La categoría es obligatoria para productos directos');
            return;
        }
        payload.categoria = categoria;

        payload.descripcion = document.getElementById('ing-descripcion').value.trim() || null;
        
        const foto = document.getElementById('ing-foto').value.trim();
        if (!foto) {
            alert('La foto es obligatoria para productos directos');
            document.getElementById('ing-foto').focus();
            return;
        }
        payload.foto = foto;
    }

    try {
        const res = await fetch(`${URL_API}/insumos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-ingrediente');
            cargarInsumos();
            if (esDirecto) cargarProductos();
        } else {
            alert(datos.message || 'Error al guardar insumo');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

//ELIMINAR INSUMO
// Abre el modal para eliminar un insumo
async function Eliminar_INSUMO() {
    try {
        const res = await fetch(`${URL_API}/insumos`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('elim-insumo-selector');
        select.innerHTML = '<option value="">-- Elige un insumo --</option>' +
            datos.insumos.map(i => `<option value="${i.ID}">${i.NOMBRE} — ${i.UNIDAD}</option>`).join('');

        document.getElementById('elim-insumo-id').value = '';
        document.getElementById('modal-eliminar-insumo').classList.add('active');
    } catch (e) {}
}

// Guarda el ID del insumo seleccionado
function onCambiarInsumoEliminar() {
    const id = document.getElementById('elim-insumo-selector').value;
    document.getElementById('elim-insumo-id').value = id;
}

// Confirma y elimina el insumo de la BD
async function confirmarEliminarInsumo(e) {
    e.preventDefault();
    const id = document.getElementById('elim-insumo-id').value;
    if (!id) {
        alert('Selecciona un insumo para eliminar');
        return;
    }

    if (!confirm('¿Estás seguro de eliminar este insumo?')) return;

    try {
        const res = await fetch(`${URL_API}/insumos/${id}`, { method: 'DELETE' });
        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-eliminar-insumo');
            cargarInsumos();
        } else {
            alert(datos.message || 'Error al eliminar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

// EDITAR INSUMO
// Abre el modal para editar un insumo
async function Editar_INSUMO() {
    try {
        const res = await fetch(`${URL_API}/insumos`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('edit-insumo-selector');
        select.innerHTML = '<option value="">-- Elige un insumo --</option>' +
            datos.insumos.map(i => `<option value="${i.ID}">${i.NOMBRE}</option>`).join('');

        // Limpia todos los campos
        document.getElementById('edit-insumo-id').value = '';
        document.getElementById('edit-insumo-nombre').value = '';
        document.getElementById('edit-insumo-unidad').value = '';
        document.getElementById('edit-insumo-stock').value = '';

        // Carga proveedores en el select
        await cargarSelectProveedoresEditar();

        document.getElementById('modal-editar-insumo').classList.add('active');
    } catch (e) {}
}

// Carga los datos del insumo seleccionado en el formulario
function onCambiarInsumoEditar() {
    const id = document.getElementById('edit-insumo-selector').value;
    
    // Si no hay selección, limpia todo
    if (!id) {
        document.getElementById('edit-insumo-id').value = '';
        document.getElementById('edit-insumo-nombre').value = '';
        document.getElementById('edit-insumo-unidad').value = '';
        document.getElementById('edit-insumo-stock').value = '';
        document.getElementById('edit-insumo-proveedor').value = '';
        return;
    }

    // Guarda el ID inmediatamente
    document.getElementById('edit-insumo-id').value = id;

    // Carga datos del insumo seleccionado
    fetch(`${URL_API}/insumos/${id}`)
        .then(r => r.json())
        .then(datos => {
            if (!datos.success) {
                document.getElementById('edit-insumo-id').value = '';
                return;
            }
            const i = datos.insumo;
            
            // Pre-llena los campos con los valores actuales
            document.getElementById('edit-insumo-nombre').value = i.NOMBRE;
            document.getElementById('edit-insumo-unidad').value = i.UNIDAD;
            document.getElementById('edit-insumo-stock').value = i.STOCK;
            
            // Selecciona el proveedor actual (o '' si no tiene)
            const provSelect = document.getElementById('edit-insumo-proveedor');
            if (i.ID_PROVEEDOR) {
                provSelect.value = i.ID_PROVEEDOR;
            } else {
                provSelect.value = 'null'; // Selecciona "Sin proveedor"
            }
        })
        .catch(() => {
            document.getElementById('edit-insumo-id').value = '';
        });
}

// Carga proveedores en el select de editar insumo
async function cargarSelectProveedoresEditar() {
    try {
        const res = await fetch(`${URL_API}/proveedores`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('edit-insumo-proveedor');
        select.innerHTML = '<option value="">-- Conservar actual --</option>' +
            '<option value="null">-- Sin proveedor --</option>' +
            datos.proveedores.map(p => `<option value="${p.ID}">${p.NOMBRE}</option>`).join('');
    } catch (e) {}
}

// Guarda los cambios del insumo editado
async function guardarEdicionInsumo(e) {
    e.preventDefault();

    const id = document.getElementById('edit-insumo-id').value;
    if (!id) {
        alert('Selecciona un insumo del listado');
        return;
    }

    // Solo envía los campos que tienen valor
    const payload = {};
    
    const nombre = document.getElementById('edit-insumo-nombre').value.trim();
    if (nombre) payload.nombre = nombre;
    
    const unidad = document.getElementById('edit-insumo-unidad').value.trim();
    if (unidad) payload.unidad = unidad;
    
    const stock = document.getElementById('edit-insumo-stock').value;
    if (stock) payload.stock = parseFloat(stock);
    
    const proveedorId = document.getElementById('edit-insumo-proveedor').value;
    if (proveedorId === 'null') {
        payload.id_proveedor = null;  // Quitar proveedor
    } else if (proveedorId) {
        payload.id_proveedor = parseInt(proveedorId);  // Cambiar proveedor
    }

    if (Object.keys(payload).length === 0) {
        alert('No hay cambios para guardar');
        return;
    }

    try {
        const res = await fetch(`${URL_API}/insumos/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-editar-insumo');
            cargarInsumos();
        } else {
            alert(datos.message || 'Error al actualizar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

//Si el insumo registrado es un producto directo, la unidad de medida se guarda como unidad
// Ademas se le pide los campos de producto
function toggleProductoDirecto() {
    const checkbox = document.getElementById('ing-es-directo');
    const unidadInput = document.getElementById('ing-unidad');
    const camposDirecto = document.getElementById('campos-directo');
    
    // Campos que deben ser obligatorios solo cuando es directo
    const precio = document.getElementById('ing-precio');
    const categoria = document.getElementById('ing-categoria');
    const foto = document.getElementById('ing-foto');
    
    if (checkbox.checked) {
        unidadInput.value = 'unidad';
        unidadInput.readOnly = true;
        camposDirecto.style.display = 'block';
        
        // Hacer obligatorios dinámicamente
        precio.required = true;
        categoria.required = true;
        foto.required = true;
    } else {
        unidadInput.value = '';
        unidadInput.readOnly = false;
        camposDirecto.style.display = 'none';
        
        // Quitar obligatoriedad y limpiar valores
        precio.required = false;
        categoria.required = false;
        foto.required = false;
        
        precio.value = '';
        categoria.value = '';
        foto.value = '';
        document.getElementById('ing-categoria-nueva').value = '';
        document.getElementById('ing-categoria-nueva').style.display = 'none';
        document.getElementById('ing-descripcion').value = '';
    }
}

//Categorias del insumo directo
function toggleNuevaCategoriaInsumo() {
    const select = document.getElementById('ing-categoria');
    const inputNueva = document.getElementById('ing-categoria-nueva');
    if (select.value === '__nueva__') {
        inputNueva.style.display = 'block';
        inputNueva.required = true;
        inputNueva.focus();
    } else {
        inputNueva.style.display = 'none';
        inputNueva.required = false;
        inputNueva.value = '';
    }
}


// PRODUCTOS

// Consulta los productos en la BD y llena la tabla
async function cargarProductos() {
    try {
        const res = await fetch(`${URL_API}/productos`);
        const datos = await res.json();
        if (!datos.success) return;

        const tbody = document.getElementById('tabla-productos');
        if (!datos.productos || datos.productos.length === 0) {
            tbody.innerHTML = '';
            return;
        }

        tbody.innerHTML = datos.productos.map(p => `
            <tr>
                <td>${p.ID}</td>
                <td>${p.NOMBRE}</td>
                <td>$${parseFloat(p.PRECIO).toFixed(2)}</td>
                <td>${p.CATEGORIA || '-'}</td>
                <td>${p.DESCRIPCION || '-'}</td>
            </tr>
        `).join('');
    } catch (e) {}
}

// AGREGAR PRODUCTO
// Abre el modal para agregar un nuevo producto
function Agregar_PRODUCTO() {
    document.getElementById('prod-id').value = '';
    document.getElementById('form-producto').reset();
    document.getElementById('prod-modal-titulo').textContent = 'Nuevo Producto';
    document.getElementById('prod-categoria-nueva').style.display = 'none';
    document.getElementById('modal-producto').classList.add('active');
}

// Muestra u oculta el campo de nueva categoría
function toggleNuevaCategoria() {
    const select = document.getElementById('prod-categoria');
    const inputNueva = document.getElementById('prod-categoria-nueva');
    if (select.value === '__nueva__') {
        inputNueva.style.display = 'block';
        inputNueva.required = true;
        inputNueva.focus();
    } else {
        inputNueva.style.display = 'none';
        inputNueva.required = false;
        inputNueva.value = '';
    }
}

// Guarda el nuevo producto en la BD
async function guardarProducto(e) {
    e.preventDefault();

    let categoria = document.getElementById('prod-categoria').value;
    if (categoria === '__nueva__') {
        categoria = document.getElementById('prod-categoria-nueva').value.trim();
        if (!categoria) {
            alert('Escribe el nombre de la nueva categoría');
            return;
        }
    }

    const payload = {
        id_empresa: 1,
        nombre: document.getElementById('prod-nombre').value.trim(),
        precio: parseFloat(document.getElementById('prod-precio').value),
        categoria: categoria,
        descripcion: document.getElementById('prod-descripcion').value.trim() || null,
        foto: document.getElementById('prod-foto').value.trim() || null
    };

    try {
        const res = await fetch(`${URL_API}/productos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-producto');
            cargarProductos();
        } else {
            alert(datos.message || 'Error al guardar producto');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

// ELIMINAR PRODUCTO
// Abre el modal para eliminar un producto
async function Eliminar_PRODUCTO() {
    try {
        const res = await fetch(`${URL_API}/productos`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('elim-prod-selector');
        select.innerHTML = '<option value="">-- Elige un producto --</option>' +
            datos.productos.map(p => `<option value="${p.ID}">${p.NOMBRE} — $${parseFloat(p.PRECIO).toFixed(2)}</option>`).join('');

        document.getElementById('elim-prod-id').value = '';
        document.getElementById('modal-eliminar-producto').classList.add('active');
    } catch (e) {}
}

// Guarda el ID del producto seleccionado
function onCambiarProductoEliminar() {
    const id = document.getElementById('elim-prod-selector').value;
    document.getElementById('elim-prod-id').value = id;
}

// Confirma y elimina el producto de la BD
async function confirmarEliminarProducto(e) {
    e.preventDefault();
    const id = document.getElementById('elim-prod-id').value;
    if (!id) {
        alert('Selecciona un producto para eliminar');
        return;
    }

    if (!confirm('¿Estás seguro de eliminar este producto?')) return;

    try {
        const res = await fetch(`${URL_API}/productos/${id}`, { method: 'DELETE' });
        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-eliminar-producto');
            cargarProductos();
        } else {
            alert(datos.message || 'Error al eliminar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

// EDITAR PRODUCTO
// Abre el modal para editar un producto
async function Editar_PRODUCTO() {
    try {
        const res = await fetch(`${URL_API}/productos`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('edit-prod-selector');
        select.innerHTML = '<option value="">-- Elige un producto --</option>' +
            datos.productos.map(p => `<option value="${p.ID}">${p.NOMBRE}</option>`).join('');

        // Limpia todos los campos
        document.getElementById('edit-prod-id').value = '';
        document.getElementById('edit-prod-nombre').value = '';
        document.getElementById('edit-prod-precio').value = '';
        document.getElementById('edit-prod-categoria').value = '';
        document.getElementById('edit-prod-categoria-nueva').value = '';
        document.getElementById('edit-prod-categoria-nueva').style.display = 'none';
        document.getElementById('edit-prod-descripcion').value = '';
        document.getElementById('edit-prod-foto').value = '';

        // Carga categorías existentes en el select
        await cargarCategoriasEditar();

        document.getElementById('modal-editar-producto').classList.add('active');
    } catch (e) {}
}

// Carga las categorías existentes en el select de editar
async function cargarCategoriasEditar() {
    try {
        const res = await fetch(`${URL_API}/productos`);
        const datos = await res.json();
        if (!datos.success) return;

        // Extrae categorías únicas
        const categorias = [...new Set(datos.productos.map(p => p.CATEGORIA).filter(c => c))];
        
        const select = document.getElementById('edit-prod-categoria');
        // Mantiene las primeras opciones
        select.innerHTML = '<option value="">-- Conservar actual --</option>' +
            categorias.map(c => `<option value="${c}">${c}</option>`).join('') +
            '<option value="__nueva__">+ Crear nueva categoría...</option>';
    } catch (e) {}
}

// Muestra u oculta el campo de nueva categoría en editar
function toggleEditarCategoria() {
    const select = document.getElementById('edit-prod-categoria');
    const inputNueva = document.getElementById('edit-prod-categoria-nueva');
    if (select.value === '__nueva__') {
        inputNueva.style.display = 'block';
        inputNueva.focus();
    } else {
        inputNueva.style.display = 'none';
        inputNueva.value = '';
    }
}

// Carga los datos del producto seleccionado en el formulario
function onCambiarProductoEditar() {
    const id = document.getElementById('edit-prod-selector').value;
    console.log('ID seleccionado:', id);
    
    if (!id) {
        document.getElementById('edit-prod-id').value = '';
        document.getElementById('edit-prod-nombre').value = '';
        document.getElementById('edit-prod-precio').value = '';
        document.getElementById('edit-prod-categoria').value = '';
        document.getElementById('edit-prod-categoria-nueva').value = '';
        document.getElementById('edit-prod-categoria-nueva').style.display = 'none';
        document.getElementById('edit-prod-descripcion').value = '';
        const fotoInput = document.getElementById('edit-prod-foto');
        if (fotoInput && fotoInput.type !== 'file') fotoInput.value = '';
        return;
    }

    document.getElementById('edit-prod-id').value = id;

    fetch(`${URL_API}/productos/${id}`)
        .then(r => {
            console.log('Status respuesta:', r.status);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(datos => {
            console.log('Datos recibidos:', datos);
            
            if (!datos.success) {
                console.error('success=false:', datos.message);
                document.getElementById('edit-prod-id').value = '';
                return;
            }
            
            const p = datos.producto;
            console.log('Producto:', p);
            console.log('NOMBRE:', p.NOMBRE);
            console.log('PRECIO:', p.PRECIO);
            console.log('CATEGORIA:', p.CATEGORIA);
            
            document.getElementById('edit-prod-nombre').value = p.NOMBRE || '';
            document.getElementById('edit-prod-precio').value = p.PRECIO || '';
            document.getElementById('edit-prod-descripcion').value = p.DESCRIPCION || '';
            
            const fotoInput = document.getElementById('edit-prod-foto');
            if (fotoInput && fotoInput.type !== 'file') fotoInput.value = p.FOTO || '';

            // CATEGORÍA 
            const catSelect = document.getElementById('edit-prod-categoria');
            const catInputNueva = document.getElementById('edit-prod-categoria-nueva');
            const catActual = p.CATEGORIA || '';
            
            let existe = false;
            for (let i = 0; i < catSelect.options.length; i++) {
                if (catSelect.options[i].value === catActual && catActual !== '') {
                    existe = true;
                    break;
                }
            }

            if (catActual && existe) {
                catSelect.value = catActual;
                catInputNueva.style.display = 'none';
                catInputNueva.value = '';
            } else if (catActual) {
                catSelect.value = '__nueva__';
                catInputNueva.style.display = 'block';
                catInputNueva.value = catActual;
            } else {
                catSelect.value = '';
                catInputNueva.style.display = 'none';
                catInputNueva.value = '';
            }
        })
        .catch(err => {
            console.error('ERROR FETCH:', err);
            document.getElementById('edit-prod-id').value = '';
        });
}

// Guarda los cambios del producto editado
async function guardarEdicionProducto(e) {
    e.preventDefault();

    const id = document.getElementById('edit-prod-id').value;
    if (!id) {
        alert('Selecciona un producto del listado');
        return;
    }

    // Solo envía los campos que tienen valor
    const payload = {};
    
    const nombre = document.getElementById('edit-prod-nombre').value.trim();
    if (nombre) payload.nombre = nombre;
    
    const precio = document.getElementById('edit-prod-precio').value;
    if (precio) payload.precio = parseFloat(precio);
    
    let categoria = document.getElementById('edit-prod-categoria').value;
    if (categoria === '__nueva__') {
        categoria = document.getElementById('edit-prod-categoria-nueva').value.trim();
        if (categoria) payload.categoria = categoria;
    } else if (categoria) {
        payload.categoria = categoria;
    }
    
    const descripcion = document.getElementById('edit-prod-descripcion').value.trim();
    if (descripcion) payload.descripcion = descripcion;
    
    const foto = document.getElementById('edit-prod-foto').value.trim();
    if (foto) payload.foto = foto;

    if (Object.keys(payload).length === 0) {
        alert('No hay cambios para guardar');
        return;
    }

    try {
        const res = await fetch(`${URL_API}/productos/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-editar-producto');
            cargarProductos();
        } else {
            alert(datos.message || 'Error al actualizar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}


// ESTADÍSTICAS

// Solicita y actualiza los indicadores de pedidos, ventas, costos e ingresos.
async function cargarEstadisticas() {
    try {
        // Pedidos hoy (completados)
        const resPedidos = await fetch(`${URL_API}/estadisticas/pedidos-hoy`);
        const datosPedidos = await resPedidos.json();
        const elPedidos = document.getElementById('dash-pedidos');
        if (elPedidos && datosPedidos.success) {
            elPedidos.textContent = datosPedidos.total;
        }

        // Ventas hoy
        const resVentas = await fetch(`${URL_API}/estadisticas/ventas-hoy`);
        const datosVentas = await resVentas.json();
        const elVentas = document.getElementById('dash-ventas');
        if (elVentas && datosVentas.success) {
            elVentas.textContent = `$${formatearPrecioAdmin(datosVentas.total)}`;
        }

        // Más vendido
        const resTop = await fetch(`${URL_API}/estadisticas/mas-vendido`);
        const datosTop = await resTop.json();
        const elTop = document.getElementById('dash-top');
        if (elTop && datosTop.success) {
            elTop.textContent = datosTop.nombre;
        }

        // Gastos
        const resGastos = await fetch(`${URL_API}/estadisticas/gastos`);
        const datosGastos = await resGastos.json();
        const elGastos = document.getElementById('dash-gastos');
        if (elGastos && datosGastos.success) {
            elGastos.textContent = `$${formatearPrecioAdmin(datosGastos.total)}`;
        }

        // Ingresos
        const resIngresos = await fetch(`${URL_API}/estadisticas/ingresos`);
        const datosIngresos = await resIngresos.json();
        const elIngresos = document.getElementById('dash-ingresos');
        if (elIngresos && datosIngresos.success) {
            elIngresos.textContent = `$${formatearPrecioAdmin(datosIngresos.total)}`;
        }

        // Ganancias
        const resGanancias = await fetch(`${URL_API}/estadisticas/ganancias`);
        const datosGanancias = await resGanancias.json();
        const elGanancias = document.getElementById('dash-ganancias');
        if (elGanancias && datosGanancias.success) {
            elGanancias.textContent = `$${formatearPrecioAdmin(datosGanancias.total)}`;
        }

    } catch (e) {
        console.error('Error cargando estadísticas:', e);
    }
}

// Formatea un valor numérico como moneda para el panel administrativo.
function formatearPrecioAdmin(valor) {
    return parseFloat(valor).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}


// FACTURAS

// Consulta las facturas y dibuja el listado con el filtro de fecha seleccionado.
async function cargarFacturas() {
    try {
        // Obtener fecha del input (si hay)
        const fechaInput = document.getElementById('hist-fecha').value;
        
        // Construir URL: si hay fecha, la manda; si no, trae todas
        let url = `${URL_API}/facturas?id_empresa=1`;
        if (fechaInput) {
            url += `&fecha=${fechaInput}`;
        }

        const res = await fetch(url);
        const datos = await res.json();
        
        if (!datos.success) return;

        const tbody = document.getElementById('tabla-facturas');
        tbody.onclick = async event => {
            const link = event.target.closest('[data-factura-api]');
            if (!link) return;
            event.preventDefault();
            const tab = window.open('about:blank', '_blank');
            try {
                const token = localStorage.getItem('supabase_access_token');
                const responsePdf = await fetch(link.dataset.facturaApi, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                });
                if (!responsePdf.ok) {
                    const error = await responsePdf.json().catch(() => ({}));
                    throw new Error(error.message || 'No se pudo recuperar el PDF de Factus.');
                }
                const pdfUrl = URL.createObjectURL(await responsePdf.blob());
                if (tab) tab.location = pdfUrl;
                else window.open(pdfUrl, '_blank', 'noopener');
                window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
            } catch (error) {
                if (tab) tab.close();
                console.error('Error recuperando el PDF de la factura:', error);
                alert(error.message || 'No se pudo abrir el PDF de la factura.');
            }
        };
        
        if (!datos.facturas || datos.facturas.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No hay facturas${fechaInput ? ' para esta fecha' : ''}</td></tr>`;
            return;
        }

        tbody.innerHTML = datos.facturas.map(f => {
            let fechaFormateada = '-';
            if (f.FECHA_EMISION) {
                const fecha = new Date(f.FECHA_EMISION);
                fechaFormateada = fecha.toLocaleString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }

            let enlacePdf = '<span>Sin PDF</span>';
            if (f.URL_FACTURA) {
                try {
                    const urlPdf = new URL(f.URL_FACTURA, window.location.origin);
                    if (urlPdf.origin === window.location.origin && urlPdf.pathname.startsWith('/api/caja/factus-pay/recaudos/')) {
                        enlacePdf = `<a href="#" data-factura-api="${escaparHTML(urlPdf.href)}">Ver PDF</a>`;
                    } else if (urlPdf.protocol === 'https:' || urlPdf.protocol === 'http:') {
                        enlacePdf = `<a href="${escaparHTML(urlPdf.href)}" target="_blank" rel="noopener noreferrer">Ver PDF</a>`;
                    }
                } catch (_error) {}
            }

            return `
                <tr>
                    <td>#${escaparHTML(f.ID_FACTURA)}</td>
                    <td>$${parseFloat(f.TOTAL || 0).toFixed(2)}</td>
                    <td>${fechaFormateada}</td>
                    <td>${enlacePdf}</td>
                </tr>
            `;
        }).join('');

    } catch (e) {
        console.error('Error cargando facturas:', e);
    }
}


// RECETAS

// Consulta las recetas en la BD y llena la tabla
async function cargarRecetas() {
    try {
        const res = await fetch(`${URL_API}/recetas`);
        const datos = await res.json();
        
        if (!datos.success) return;

        const tbody = document.getElementById('tabla-recetas');
        if (!datos.recetas || datos.recetas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No hay recetas registradas</td></tr>';
            return;
        }

        tbody.innerHTML = datos.recetas.map(r => `
            <tr>
                <td>${r.ID}</td>
                <td>${r.NOMBRE}</td>
                <td>${r.PRODUCTO_NOMBRE}</td>
                <td>${r.DESCRIPCION || '-'}</td>
            </tr>
        `).join('');

    } catch (e) {
        console.error('Error cargando recetas:', e);
    }
}

// AGREGAR RECETA
// Abre el modal para agregar una nueva receta
async function Agregar_RECETA() {
    document.getElementById('receta-id').value = '';
    document.getElementById('form-receta-agregar').reset();
    document.getElementById('receta-modal-titulo').textContent = 'Nueva Receta';
    
    // Carga productos en el select
    await cargarSelectProductosReceta();
    
    // Limpia y añade una fila de insumo vacía
    const container = document.getElementById('receta-insumos-container');
    container.innerHTML = '';
    agregarFilaInsumo();
    
    document.getElementById('modal-receta-agregar').classList.add('active');
}

// Carga los productos en el select de receta
async function cargarSelectProductosReceta() {
    try {
        const res = await fetch(`${URL_API}/productos`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('receta-producto');
        select.innerHTML = '<option value="">-- Selecciona un producto --</option>' +
            datos.productos.map(p => `<option value="${p.ID}">${p.NOMBRE} — $${parseFloat(p.PRECIO).toFixed(2)}</option>`).join('');
    } catch (e) {}
}

// Añade una fila de insumo al formulario de agregar
function agregarFilaInsumo() {
    const container = document.getElementById('receta-insumos-container');
    const fila = document.createElement('div');
    fila.className = 'two-columns';
    fila.style.cssText = 'margin-bottom:10px;';
    fila.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
            <select class="receta-insumo-select" required>
                <option value="">-- Insumo --</option>
            </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
            <input type="number" class="receta-insumo-cantidad" step="0.01" placeholder="Cantidad" required>
        </div>
    `;
    container.appendChild(fila);
    
    // Carga insumos en el select recién creado
    cargarSelectInsumosEnFila(fila.querySelector('.receta-insumo-select'));
}

// Carga insumos en un select específico
async function cargarSelectInsumosEnFila(selectElement) {
    try {
        const res = await fetch(`${URL_API}/insumos`);
        const datos = await res.json();
        if (!datos.success) return;

        selectElement.innerHTML = '<option value="">-- Insumo --</option>' +
            datos.insumos.map(i => `<option value="${i.ID}">${i.NOMBRE} (${i.UNIDAD})</option>`).join('');
    } catch (e) {}
}

// Guarda la nueva receta en la BD
async function guardarReceta(e) {
    e.preventDefault();

    const idProducto = document.getElementById('receta-producto').value;
    if (!idProducto) {
        alert('Selecciona un producto');
        return;
    }

    // Toma el nombre del producto seleccionado para usarlo como nombre de receta
    const productoSelect = document.getElementById('receta-producto');
    const nombreReceta = productoSelect.options[productoSelect.selectedIndex].text.split('—')[0].trim();

    // Validación: descripción obligatoria
    const descripcion = document.getElementById('receta-descripcion').value.trim();
    if (!descripcion) {
        alert('La descripción es obligatoria');
        return;
    }

    // Recolecta los insumos
    const filas = document.querySelectorAll('#receta-insumos-container .two-columns');
    const insumos = [];
    
    for (const fila of filas) {
        const idInsumo = fila.querySelector('.receta-insumo-select').value;
        const cantidad = fila.querySelector('.receta-insumo-cantidad').value;
        
        if (!idInsumo || !cantidad) {
            alert('Completa todos los insumos o elimina las filas vacías');
            return;
        }
        
        insumos.push({
            id_insumo: parseInt(idInsumo),
            cantidad: parseFloat(cantidad)
        });
    }

    const payload = {
        id_empresa: getIdEmpresa(),
        id_producto: parseInt(idProducto),
        nombre: nombreReceta,      
        descripcion: descripcion,  
        insumos: insumos
    };

    try {
        const res = await fetch(`${URL_API}/recetas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-receta-agregar');
            cargarRecetas();
        } else {
            alert(datos.message || 'Error al guardar receta');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

// ELIMINAR RECETA
// Abre el modal para eliminar una receta
async function Eliminar_RECETA() {
    try {
        const res = await fetch(`${URL_API}/recetas`);
        const datos = await res.json();
        if (!datos.success) return;

        const select = document.getElementById('elim-receta-selector');
        select.innerHTML = '<option value="">-- Elige una receta --</option>' +
            datos.recetas.map(r => `<option value="${r.ID}">${r.NOMBRE} — ${r.PRODUCTO_NOMBRE}</option>`).join('');

        document.getElementById('elim-receta-id').value = '';
        document.getElementById('modal-eliminar-receta').classList.add('active');
    } catch (e) {}
}

// Guarda el ID de la receta seleccionada
function onCambiarRecetaEliminar() {
    const id = document.getElementById('elim-receta-selector').value;
    document.getElementById('elim-receta-id').value = id;
}

// Confirma y elimina la receta de la BD
async function confirmarEliminarReceta(e) {
    e.preventDefault();
    const id = document.getElementById('elim-receta-id').value;
    if (!id) {
        alert('Selecciona una receta para eliminar');
        return;
    }

    if (!confirm('¿Estás seguro de eliminar esta receta?')) return;

    try {
        const res = await fetch(`${URL_API}/recetas/${id}`, { method: 'DELETE' });
        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-eliminar-receta');
            cargarRecetas();
        } else {
            alert(datos.message || 'Error al eliminar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

// EDITAR RECETA
// Abre el modal para editar una receta
async function Editar_RECETA() {
    try {
        // Carga recetas en el selector
        const resRecetas = await fetch(`${URL_API}/recetas`);
        const datosRecetas = await resRecetas.json();
        if (!datosRecetas.success) return;

        const select = document.getElementById('edit-receta-selector');
        select.innerHTML = '<option value="">-- Elige una receta --</option>' +
            datosRecetas.recetas.map(r => `<option value="${r.ID}">${r.NOMBRE}</option>`).join('');

        // Carga productos en el select de producto
        const resProductos = await fetch(`${URL_API}/productos`);
        const datosProductos = await resProductos.json();
        if (datosProductos.success) {
            const selectProd = document.getElementById('edit-receta-producto');
            // Mantiene la primera opción "Conservar actual"
            selectProd.innerHTML = '<option value="">-- Conservar actual --</option>' +
                datosProductos.productos.map(p => `<option value="${p.ID}">${p.NOMBRE}</option>`).join('');
        }

        // Limpia campos
        document.getElementById('edit-receta-id').value = '';
        document.getElementById('edit-receta-nombre').value = '';
        document.getElementById('edit-receta-descripcion').value = '';
        
        // Limpia insumos
        const container = document.getElementById('edit-receta-insumos-container');
        container.innerHTML = '';

        document.getElementById('modal-editar-receta').classList.add('active');
    } catch (e) {}
}

// Carga los datos de la receta seleccionada en el formulario
async function onCambiarRecetaEditar() {
    const id = document.getElementById('edit-receta-selector').value;
    
    if (!id) {
        document.getElementById('edit-receta-id').value = '';
        document.getElementById('edit-receta-nombre').value = '';
        document.getElementById('edit-receta-descripcion').value = '';
        document.getElementById('edit-receta-producto').value = '';
        document.getElementById('edit-receta-insumos-container').innerHTML = '';
        return;
    }

    document.getElementById('edit-receta-id').value = id;

    try {
        const res = await fetch(`${URL_API}/recetas/${id}`);
        const datos = await res.json();
        
        if (!datos.success) {
            document.getElementById('edit-receta-id').value = '';
            return;
        }

        const r = datos.receta;
        document.getElementById('edit-receta-nombre').value = r.NOMBRE || '';
        document.getElementById('edit-receta-descripcion').value = r.DESCRIPCION || '';
        
        // Producto
        if (r.ID_PRODUCTO) {
            document.getElementById('edit-receta-producto').value = r.ID_PRODUCTO;
        }

        // Insumos
        const container = document.getElementById('edit-receta-insumos-container');
        container.innerHTML = '';

        if (datos.detalles && datos.detalles.length > 0) {
            for (const d of datos.detalles) {
                await agregarFilaInsumoEditar(d.ID_INSUMO, d.CANTIDAD);
            }
        } else {
            agregarFilaInsumoEditar();
        }

    } catch (err) {
        document.getElementById('edit-receta-id').value = '';
    }
}

// Añade una fila de insumo al formulario de editar
async function agregarFilaInsumoEditar(idInsumo = '', cantidad = '') {
    const container = document.getElementById('edit-receta-insumos-container');
    const fila = document.createElement('div');
    fila.className = 'two-columns';
    fila.style.cssText = 'margin-bottom:10px;';
    fila.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
            <select class="edit-receta-insumo-select" required>
                <option value="">-- Insumo --</option>
            </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
            <input type="number" class="edit-receta-insumo-cantidad" step="0.01" placeholder="Cantidad" value="${cantidad}" required>
        </div>
    `;
    container.appendChild(fila);
    
    // Carga insumos y selecciona el actual si aplica
    const select = fila.querySelector('.edit-receta-insumo-select');
    await cargarSelectInsumosEditar(select, idInsumo);
}

// Carga insumos en el select de editar
async function cargarSelectInsumosEditar(selectElement, idSeleccionado = '') {
    try {
        const res = await fetch(`${URL_API}/insumos`);
        const datos = await res.json();
        if (!datos.success) return;

        selectElement.innerHTML = '<option value="">-- Insumo --</option>' +
            datos.insumos.map(i => `<option value="${i.ID}">${i.NOMBRE} (${i.UNIDAD})</option>`).join('');
        
        if (idSeleccionado) {
            selectElement.value = idSeleccionado;
        }
    } catch (e) {}
}

// Guarda los cambios de la receta editada
async function guardarEdicionReceta(e) {
    e.preventDefault();

    const id = document.getElementById('edit-receta-id').value;
    if (!id) {
        alert('Selecciona una receta del listado');
        return;
    }

    // Solo envía los campos que tienen valor
    const payload = {};
    
    const nombre = document.getElementById('edit-receta-nombre').value.trim();
    if (nombre) payload.nombre = nombre;
    
    const descripcion = document.getElementById('edit-receta-descripcion').value.trim();
    if (descripcion) payload.descripcion = descripcion;
    
    const idProducto = document.getElementById('edit-receta-producto').value;
    if (idProducto) payload.id_producto = parseInt(idProducto);

    // Recolecta insumos
    const filas = document.querySelectorAll('#edit-receta-insumos-container .two-columns');
    const insumos = [];
    
    for (const fila of filas) {
        const idInsumo = fila.querySelector('.edit-receta-insumo-select').value;
        const cantidad = fila.querySelector('.edit-receta-insumo-cantidad').value;
        
        if (idInsumo && cantidad) {
            insumos.push({
                id_insumo: parseInt(idInsumo),
                cantidad: parseFloat(cantidad)
            });
        }
    }

    if (insumos.length > 0) {
        payload.insumos = insumos;
    }

    // Si no hay nada que actualizar
    if (Object.keys(payload).length === 0) {
        alert('No hay cambios para guardar');
        return;
    }

    try {
        const res = await fetch(`${URL_API}/recetas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const datos = await res.json();
        if (datos.success) {
            cerrarModal('modal-editar-receta');
            cargarRecetas();
        } else {
            alert(datos.message || 'Error al actualizar');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}


// EXPONER FUNCIONES GLOBALES 

window.cargarRecetas = cargarRecetas;
window.Agregar_RECETA = Agregar_RECETA;
window.agregarFilaInsumo = agregarFilaInsumo;
window.guardarReceta = guardarReceta;
window.Eliminar_RECETA = Eliminar_RECETA;
window.onCambiarRecetaEliminar = onCambiarRecetaEliminar;
window.confirmarEliminarReceta = confirmarEliminarReceta;
window.Editar_RECETA = Editar_RECETA;
window.onCambiarRecetaEditar = onCambiarRecetaEditar;
window.agregarFilaInsumoEditar = agregarFilaInsumoEditar;
window.guardarEdicionReceta = guardarEdicionReceta;


// EXTRAS

// Cierra cualquier modal
function cerrarModal(id) {
    document.getElementById(id).classList.remove('active');

    // Si el modal es de insumos, recargar la tabla automáticamente
    const modalesInsumo = ['modal-ingrediente', 'modal-editar-insumo', 'modal-eliminar-insumo'];
    if (modalesInsumo.includes(id)) {
        cargarInsumos();
    }
}


// Expone funciones globales para los onclick inline del HTML
window.Form_Agregar_Empleado = Form_Agregar_Empleado;
window.guardarEmpleado = guardarEmpleado;
window.cerrarModal = cerrarModal;
window.Form_Eliminar_Empleado = Form_Eliminar_Empleado;
window.onCambiarEmpleadoEliminar = onCambiarEmpleadoEliminar;
window.confirmarEliminarEmpleado = confirmarEliminarEmpleado;
window.Form_Editar_Empleado = Form_Editar_Empleado;
window.onCambiarEmpleadoEditar = onCambiarEmpleadoEditar;
window.guardarEdicionEmpleado = guardarEdicionEmpleado;
window.cargarProveedores = cargarProveedores;
window.guardarProveedor = guardarProveedor;
window.Eliminar_Proveedor = Eliminar_Proveedor;
window.onCambiarProveedorEliminar = onCambiarProveedorEliminar;
window.confirmarEliminarProveedor = confirmarEliminarProveedor;
window.Editar_Proveedor = Editar_Proveedor;
window.onCambiarProveedorEditar = onCambiarProveedorEditar;
window.guardarEdicionProveedor = guardarEdicionProveedor;
window.cargarInsumos = cargarInsumos;
window.Agregar_INSUMO = Agregar_INSUMO;
window.guardarIngrediente = guardarIngrediente;
window.Eliminar_INSUMO = Eliminar_INSUMO;
window.onCambiarInsumoEliminar = onCambiarInsumoEliminar;
window.confirmarEliminarInsumo = confirmarEliminarInsumo;
window.Editar_INSUMO = Editar_INSUMO;
window.onCambiarInsumoEditar = onCambiarInsumoEditar;
window.guardarEdicionInsumo = guardarEdicionInsumo;
window.recargarInsumosSiEsInventario = recargarInsumosSiEsInventario;

window.cargarProductos = cargarProductos;
window.Agregar_PRODUCTO = Agregar_PRODUCTO;
window.toggleNuevaCategoria = toggleNuevaCategoria;
window.guardarProducto = guardarProducto;

window.Editar_PRODUCTO = Editar_PRODUCTO;
window.onCambiarProductoEditar = onCambiarProductoEditar;
window.toggleEditarCategoria = toggleEditarCategoria;
window.guardarEdicionProducto = guardarEdicionProducto;

window.cargarFacturas = cargarFacturas;

window.toggleProductoDirecto = toggleProductoDirecto;
window.cerrarSesion = cerrarSesion;