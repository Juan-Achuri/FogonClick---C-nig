
// PANEL DE COCINA

const API_URL = '/api/cocina';
let sonidoActivo = true;
let pedidosAnteriores = new Set();
let primeraCarga = true;
document.addEventListener('DOMContentLoaded', initCocina);


// INICIALIZACIÓN

// Registra eventos del tablero y comienza la carga periódica de pedidos.
function initCocina() {
    const botonesEstado = Array.from(document.querySelectorAll('[data-estado-tab]'));
    botonesEstado.forEach((boton, indice) => {
        boton.addEventListener('click', () => mostrarEstadoPedidos(boton.dataset.estadoTab));
        boton.addEventListener('keydown', (evento) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(evento.key)) return;
            evento.preventDefault();
            const direccion = evento.key === 'ArrowRight' ? 1 : -1;
            const siguiente = (indice + direccion + botonesEstado.length) % botonesEstado.length;
            botonesEstado[siguiente].focus();
            mostrarEstadoPedidos(botonesEstado[siguiente].dataset.estadoTab);
        });
    });
    mostrarEstadoPedidos('pendiente');

    cargarPedidos();
    window.setInterval(cargarPedidos, 8000);

    const btnSonido = document.getElementById('btn-sonido');
    if (btnSonido) {
        btnSonido.addEventListener('click', toggleSonido);
    }
}

// Cambia el estado usado para filtrar las columnas visibles del tablero.
function mostrarEstadoPedidos(estado) {
    document.querySelectorAll('[data-estado-tab]').forEach((boton) => {
        const seleccionado = boton.dataset.estadoTab === estado;
        boton.classList.toggle('is-active', seleccionado);
        boton.setAttribute('aria-selected', String(seleccionado));
        boton.tabIndex = seleccionado ? 0 : -1;
    });

    document.querySelectorAll('.kanban-row[data-estado]').forEach((panel) => {
        panel.hidden = panel.dataset.estado !== estado;
    });
}


// NAVEGACIÓN ENTRE SECCIONES

// Muestra una sección de cocina y oculta las otras secciones del panel.
function mostrarSeccion(seccion) {
    document.querySelectorAll('.admin-section').forEach(sec => {
        sec.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
    });

    const target = document.getElementById(seccion);
    if (target) target.classList.add('active');

    const btn = document.querySelector(`.nav-item[data-section="${seccion}"]`);
    if (btn) btn.classList.add('active');
}

// CONSULTAR TODOS LOS PEDIDOS

// Consulta pedidos actuales y actualiza tarjetas, contadores y alertas visuales.
async function cargarPedidos() {
    try {
        const response = await fetch(`${API_URL}/pedidos`);
        if (!response.ok) throw new Error('Error al cargar pedidos');

        const pedidos = await response.json();
        if (!Array.isArray(pedidos)) throw new Error('El servidor devolvió una lista de pedidos inválida.');

        const idsActuales = new Set(pedidos.map(pedido => Number(pedido.id)));
        const hayPedidoNuevo = !primeraCarga && pedidos.some(pedido =>
            pedido.estado === 'pendiente' && !pedidosAnteriores.has(Number(pedido.id))
        );
        pedidosAnteriores = idsActuales;
        primeraCarga = false;

        if (hayPedidoNuevo) reproducirSonidoNuevoPedido();

        actualizarContadores(pedidos);
        renderizarPedidosPendientes(pedidos);
    renderizarPedidosPreparacion(pedidos);
    renderizarPedidosCompletados(pedidos);
    renderizarPedidosCancelados(pedidos);

    } catch (error) {
        console.error('Error en cargarPedidos:', error);
    }
}

// CONTADORES

// Cuenta pedidos por estado y actualiza los indicadores del tablero.
function actualizarContadores(pedidos) {
    const pendientes = pedidos.filter(p => p.estado === 'pendiente').length;
    const preparacion = pedidos.filter(p => p.estado === 'preparacion').length;
    const completados = pedidos.filter(p => p.estado === 'completado').length;
    const cancelados = pedidos.filter(p => p.estado === 'cancelado').length;

    const contadores = {
        'stat-pendiente': pendientes,
        'stat-preparacion': preparacion,
        'stat-completado': completados,
        'stat-cancelado': cancelados
    };
    for (const [id, valor] of Object.entries(contadores)) {
        const elemento = document.getElementById(id);
        if (elemento) elemento.textContent = valor;
    }
}

// CAJAS PEDIDOS PENDIENTES

// Dibuja las tarjetas de pedidos que esperan preparación.
function renderizarPedidosPendientes(pedidos) {
    const contenedor = document.getElementById('row-pendiente');
    if (!contenedor) return;

    contenedor.innerHTML = '';

    const pendientes = pedidos.filter(p => p.estado === 'pendiente');

    if (pendientes.length === 0) {
        contenedor.innerHTML = '<div class="kanban-empty">Sin pedidos pendientes</div>';
        return;
    }

    pendientes.forEach(pedido => {
        const card = crearCardPedido(pedido, 'En Preparación', cambiarEstadoAPreparacion, false, 'btn-preparar', true);
        contenedor.appendChild(card);
    });
}

// CAJAS PEDIDOS EN PREPARACIÓN

// Dibuja las tarjetas de los pedidos que están en preparación.
function renderizarPedidosPreparacion(pedidos) {
    const contenedor = document.getElementById('row-preparacion');
    if (!contenedor) return;

    contenedor.innerHTML = '';

    const enPreparacion = pedidos.filter(p => p.estado === 'preparacion');

    if (enPreparacion.length === 0) {
        contenedor.innerHTML = '<div class="kanban-empty">Sin pedidos en preparación</div>';
        return;
    }

    enPreparacion.forEach(pedido => {
        const card = crearCardPedido(pedido, 'Completado', cambiarEstadoACompletado, false, 'btn-completar', true);
        contenedor.appendChild(card);
    });
}

// CREAR CARD DE PEDIDO

// Construye una tarjeta de pedido y conecta el botón de cambio de estado.
function crearCardPedido(pedido, textoBoton, onClickBoton, sinBoton = false, claseBoton = 'btn-preparar', mostrarCancelar = false) {
    const card = document.createElement('div');
    card.className = 'pedido-card';
    card.dataset.estado = pedido.estado;
    const encabezado = document.createElement('div');
    encabezado.className = 'pedido-card-header';
    const numero = document.createElement('span');
    numero.className = 'pedido-id';
    numero.textContent = `Pedido #${pedido.id}`;
    encabezado.appendChild(numero);

    const cuerpo = document.createElement('div');
    cuerpo.className = 'pedido-card-body';
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    if (productos.length) {
        productos.forEach(producto => {
            const fila = document.createElement('div');
            fila.className = 'pedido-producto';
            const nombre = document.createElement('span');
            nombre.className = 'prod-nombre';
            nombre.textContent = producto.nombre || 'Producto sin nombre';
            const cantidad = document.createElement('span');
            cantidad.className = 'prod-cant';
            cantidad.textContent = `x${producto.cantidad}`;
            fila.append(nombre, cantidad);
            cuerpo.appendChild(fila);
        });
    } else {
        const vacio = document.createElement('div');
        vacio.className = 'pedido-producto';
        vacio.textContent = 'Sin productos';
        cuerpo.appendChild(vacio);
    }
    card.append(encabezado, cuerpo);

    if (!sinBoton) {
        const pie = document.createElement('div');
        pie.className = 'pedido-card-footer';
        const btn = document.createElement('button');
        btn.className = claseBoton;
        btn.type = 'button';
        btn.textContent = textoBoton;
        btn.addEventListener('click', () => onClickBoton(pedido.id));
        pie.appendChild(btn);
        if (mostrarCancelar) {
            const btnCancelar = document.createElement('button');
            btnCancelar.className = 'btn-cancelar';
            btnCancelar.type = 'button';
            btnCancelar.textContent = 'Cancelar';
            btnCancelar.addEventListener('click', () => cancelarPedido(pedido.id));
            pie.appendChild(btnCancelar);
        }
        card.appendChild(pie);
    }

    return card;
}

// CAMBIAR ESTADO: PENDIENTE → PREPARANDO

// Solicita al backend pasar el pedido pendiente a preparación.
async function cambiarEstadoAPreparacion(idPedido) {
    await actualizarEstadoPedido(idPedido, 'preparacion', 'No se pudo preparar el pedido');
}

// Dibuja los pedidos terminados sin acciones de cambio de estado.
function renderizarPedidosCompletados(pedidos) {
    const contenedor = document.getElementById('row-completado');
    if (!contenedor) return;

    contenedor.innerHTML = '';

    const completados = pedidos.filter(p => p.estado === 'completado');

    if (completados.length === 0) {
        contenedor.innerHTML = '<div class="kanban-empty">Sin pedidos completados</div>';
        return;
    }

    completados.forEach(pedido => {
        const card = crearCardPedido(pedido, '', null, true); // sinBoton = true
        contenedor.appendChild(card);
    });
}

// Muestra los pedidos cancelados, que ya no tienen acciones disponibles.
function renderizarPedidosCancelados(pedidos) {
    const contenedor = document.getElementById('row-cancelado');
    if (!contenedor) return;
    contenedor.replaceChildren();

    const cancelados = pedidos.filter(pedido => pedido.estado === 'cancelado');
    if (!cancelados.length) {
        contenedor.innerHTML = '<div class="kanban-empty">Sin pedidos cancelados</div>';
        return;
    }
    cancelados.forEach(pedido => contenedor.appendChild(crearCardPedido(pedido, '', null, true)));
}


// Marca el pedido como completado y vuelve a cargar las columnas.
async function cambiarEstadoACompletado(idPedido) {
    await actualizarEstadoPedido(idPedido, 'completado', 'No se pudo completar el pedido');
}

// Cancela un pedido pendiente o en preparación cuando ya no se va a atender.
async function cancelarPedido(idPedido) {
    if (!window.confirm(`¿Cancelar el pedido #${idPedido}?`)) return;
    await actualizarEstadoPedido(idPedido, 'cancelado', 'No se pudo cancelar el pedido');
}

// Guarda el nuevo estado del pedido y vuelve a dibujar las columnas.
async function actualizarEstadoPedido(idPedido, estado, mensajeError) {
    try {
        const response = await fetch(`${API_URL}/pedidos/${idPedido}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Error al cambiar el estado');
        }

        await cargarPedidos();
    } catch (error) {
        console.error('Error actualizando estado del pedido:', error);
        window.alert(`${mensajeError}: ${error.message}`);
    }
}


// TOGGLE SONIDO

// Activa o silencia las notificaciones sonoras de pedidos nuevos.
function toggleSonido() {
    sonidoActivo = !sonidoActivo;
    const btn = document.getElementById('btn-sonido');
    if (btn) {
        btn.textContent = sonidoActivo ? '🔔' : '🔕';
        btn.title = sonidoActivo ? 'Desactivar sonido' : 'Activar sonido';
    }
}

// Reproduce el aviso cuando aparece un pedido pendiente nuevo.
function reproducirSonidoNuevoPedido() {
    if (!sonidoActivo) return;
    const audio = document.getElementById('audio-nuevo');
    if (audio) audio.play().catch(() => {});
}
