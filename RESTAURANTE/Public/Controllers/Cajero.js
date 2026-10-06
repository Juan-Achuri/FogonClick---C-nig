// FOGONCLICK - CAJERO

// Rutas relativas para que el cajero funcione desde el mismo host donde corre
// el servidor, tanto en local como cuando se publique.
const URL_API = '/api';
const URL_CAJA = `${URL_API}/caja`;
const FACTUS_PENDING_STORAGE_KEY = 'fogonClickFactusInvoicePending';
// TEMPORAL: abrir Cajero.html?factusPayTest=1 para mostrar copias locales del catálogo.
const FACTUS_PAY_TEST_MODE = new URLSearchParams(window.location.search).get('factusPayTest') === '1';
const FACTUS_PAY_TEST_PRODUCTS = [
    { ID: 990001, ID_EMPRESA: 1, NOMBRE: 'GASEOSA · COPIA DE PRUEBA', PRECIO: 2000, CATEGORIA: 'Prueba Factus Pay', DESCRIPCION: 'Producto temporal para validar el recaudo QR en sandbox.', FOTO: 'Medios/logo.png' },
    { ID: 990002, ID_EMPRESA: 1, NOMBRE: 'PERRO CALIENTE · COPIA DE PRUEBA', PRECIO: 10000, CATEGORIA: 'Prueba Factus Pay', DESCRIPCION: 'Producto temporal de $10.000 para cumplir el mínimo de Factus Pay sandbox.', FOTO: 'Medios/logo.png' }
];
const FACTUS_PAY_TEST_IDS = new Set(FACTUS_PAY_TEST_PRODUCTS.map((item) => item.ID));

let carrito = [];
let productos = [];
let errorCargaProductos = '';
let inventarioCaja = { estado: 'cargando', insumos: [], recetasPorProducto: new Map(), detallesPorReceta: new Map() };
let avisoStockTimer = null;
let numeroFactura = 1;
let factusPayPollTimer = null;
let factusPayFinalized = false;
let factusPayInvoicePayload = null;
let factusPayInvoiceReference = null;
let factusInvoicePdfObjectUrl = null;
let factusInvoicePdfPublicUrl = '';
let factusInvoiceNumber = '';
let factusEmailSending = false;
let factusEmailSent = false;
let municipiosFactus = [];
const MUNICIPALITY_FIELDS = [
    ['MunicipioClienteNombre', 'MunicipioCliente'],
    ['MunicipioRecuperarNombre', 'MunicipioRecuperar'],
    ['FactusFacturaMunicipioNombre', 'FactusFacturaMunicipio']
];

// ARRANCAR LA PANTALLA Y CARGAR DATOS
document.addEventListener('DOMContentLoaded', () => {
    mostrarSeccion('ventas');
    inicializarTabs();
    cargarProductos();
    cargarNumeroFactura();
    inicializarEventos();
    inicializarSelectorMunicipio();
    inicializarCamposCorreccionClienteFactura();
    document.getElementById('FactusPayCerrar')?.addEventListener('click', cerrarModalFactusPay);
    document.getElementById('FactusFacturaCerrar')?.addEventListener('click', cerrarModalFactusPay);
    document.getElementById('FactusFacturaReintentar')?.addEventListener('click', reintentarFacturaFactus);
    document.getElementById('FactusFacturaRecuperar')?.addEventListener('click', recuperarFacturaPendiente);
    document.getElementById('FactusFacturaVer')?.addEventListener('click', abrirFacturaFactus);
    document.getElementById('FactusEnviarCorreo')?.addEventListener('change', cambiarEnvioCorreoFactura);
    document.getElementById('FactusCorreoDestino')?.addEventListener('change', () => {
        if (document.getElementById('FactusEnviarCorreo').checked) enviarFacturaFactusCorreo();
    });
    restaurarFacturaPendiente();
});

// Agrega al modal los campos fiscales para corregir un pedido pagado sin tocar su cobro.
function inicializarCamposCorreccionClienteFactura() {
    const errorField = document.getElementById('FactusFacturaError');
    const retryButton = document.getElementById('FactusFacturaReintentar');
    if (!errorField || !retryButton || document.getElementById('FactusFacturaClienteGrupo')) return;

    const panel = document.createElement('section');
    panel.id = 'FactusFacturaClienteGrupo';
    panel.className = 'factus-customer-correction';
    panel.style.cssText = 'display:grid;gap:12px;margin:12px 0;padding:14px;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.025);';
    panel.hidden = true;
    panel.style.display = 'none';

    const heading = document.createElement('strong');
    heading.textContent = 'Revisa los datos del comprador';
    panel.appendChild(heading);

    const help = document.createElement('small');
    help.className = 'factus-field-help';
    help.textContent = 'Escribe el documento y el nombre exactos del comprador. Para NIT, ingresa el número sin puntos ni guion y el DV aparte.';
    panel.appendChild(help);

    const columns = document.createElement('div');
    columns.className = 'two-columns';
    panel.appendChild(columns);

    const docGroup = document.createElement('div');
    docGroup.className = 'form-group';
    const docLabel = document.createElement('label');
    docLabel.htmlFor = 'FactusFacturaTipoDocumento';
    docLabel.textContent = 'Tipo de documento';
    const docSelect = document.createElement('select');
    docSelect.id = 'FactusFacturaTipoDocumento';
    [
        ['13', 'Cédula de ciudadanía'], ['31', 'NIT'], ['22', 'Cédula de extranjería'],
        ['41', 'Pasaporte'], ['42', 'Documento extranjero'], ['47', 'PEP'], ['48', 'PPT']
    ].forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        docSelect.appendChild(option);
    });
    docGroup.append(docLabel, docSelect);
    columns.appendChild(docGroup);

    const orgGroup = document.createElement('div');
    orgGroup.className = 'form-group';
    const orgLabel = document.createElement('label');
    orgLabel.htmlFor = 'FactusFacturaTipoCliente';
    orgLabel.textContent = 'Tipo de cliente';
    const orgSelect = document.createElement('select');
    orgSelect.id = 'FactusFacturaTipoCliente';
    [['2', 'Persona natural'], ['1', 'Persona jurídica']].forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        orgSelect.appendChild(option);
    });
    orgGroup.append(orgLabel, orgSelect);
    columns.appendChild(orgGroup);

    const identificationGroup = document.createElement('div');
    identificationGroup.className = 'form-group';
    const identificationLabel = document.createElement('label');
    identificationLabel.htmlFor = 'FactusFacturaIdentificacion';
    identificationLabel.textContent = 'Número de documento';
    const identificationInput = document.createElement('input');
    identificationInput.id = 'FactusFacturaIdentificacion';
    identificationInput.type = 'text';
    identificationInput.autocomplete = 'off';
    identificationInput.placeholder = 'Número sin puntos';
    identificationGroup.append(identificationLabel, identificationInput);
    panel.appendChild(identificationGroup);

    const dvGroup = document.createElement('div');
    dvGroup.className = 'form-group';
    dvGroup.id = 'FactusFacturaDVGrupo';
    const dvLabel = document.createElement('label');
    dvLabel.htmlFor = 'FactusFacturaDV';
    dvLabel.textContent = 'Dígito de verificación (DV)';
    const dvInput = document.createElement('input');
    dvInput.id = 'FactusFacturaDV';
    dvInput.type = 'text';
    dvInput.inputMode = 'numeric';
    dvInput.maxLength = 1;
    dvInput.placeholder = '0';
    dvGroup.append(dvLabel, dvInput);
    panel.appendChild(dvGroup);

    const namesGroup = document.createElement('div');
    namesGroup.className = 'form-group';
    namesGroup.id = 'FactusFacturaNombresGrupo';
    const namesLabel = document.createElement('label');
    namesLabel.htmlFor = 'FactusFacturaNombres';
    namesLabel.textContent = 'Nombre completo del comprador';
    const namesInput = document.createElement('input');
    namesInput.id = 'FactusFacturaNombres';
    namesInput.type = 'text';
    namesInput.autocomplete = 'name';
    namesGroup.append(namesLabel, namesInput);
    panel.appendChild(namesGroup);

    const companyGroup = document.createElement('div');
    companyGroup.className = 'form-group';
    companyGroup.id = 'FactusFacturaRazonSocialGrupo';
    const companyLabel = document.createElement('label');
    companyLabel.htmlFor = 'FactusFacturaRazonSocial';
    companyLabel.textContent = 'Razón social registrada en el RUT';
    const companyInput = document.createElement('input');
    companyInput.id = 'FactusFacturaRazonSocial';
    companyInput.type = 'text';
    companyInput.autocomplete = 'organization';
    companyGroup.append(companyLabel, companyInput);
    panel.appendChild(companyGroup);

    errorField.insertAdjacentElement('afterend', panel);
    docSelect.addEventListener('change', actualizarCamposCorreccionClienteFactura);
    orgSelect.addEventListener('change', actualizarCamposCorreccionClienteFactura);
    actualizarCamposCorreccionClienteFactura();
}

// Muestra nombre, razón social y DV de acuerdo con el documento y tipo de comprador.
function actualizarCamposCorreccionClienteFactura() {
    const tipoDocumento = document.getElementById('FactusFacturaTipoDocumento');
    const tipoCliente = document.getElementById('FactusFacturaTipoCliente');
    if (!tipoDocumento || !tipoCliente) return;

    const esJuridica = tipoCliente.value === '1';
    if (esJuridica && tipoDocumento.value !== '31') tipoDocumento.value = '31';
    const esNit = tipoDocumento.value === '31';
    document.getElementById('FactusFacturaDVGrupo').hidden = !esNit;
    document.getElementById('FactusFacturaNombresGrupo').hidden = esJuridica;
    document.getElementById('FactusFacturaRazonSocialGrupo').hidden = !esJuridica;
}

// Carga en el formulario los últimos datos fiscales usados para este pedido.
function cargarDatosCorreccionClienteFactura(customer = {}) {
    const panel = document.getElementById('FactusFacturaClienteGrupo');
    if (!panel) return;
    document.getElementById('FactusFacturaTipoDocumento').value = String(customer.identification_document_code || '13');
    document.getElementById('FactusFacturaTipoCliente').value = String(customer.legal_organization_code || '2');
    document.getElementById('FactusFacturaIdentificacion').value = String(customer.identification || '');
    document.getElementById('FactusFacturaDV').value = String(customer.dv || '');
    document.getElementById('FactusFacturaNombres').value = String(customer.names || '');
    document.getElementById('FactusFacturaRazonSocial').value = String(customer.company || '');
    actualizarCamposCorreccionClienteFactura();
}

// Valida y guarda los datos fiscales corregidos antes de pedir otro intento a Factus.
function leerDatosCorreccionClienteFactura() {
    const tipoDocumento = document.getElementById('FactusFacturaTipoDocumento').value;
    const tipoCliente = document.getElementById('FactusFacturaTipoCliente').value;
    let identification = document.getElementById('FactusFacturaIdentificacion').value.trim();
    let dv = document.getElementById('FactusFacturaDV').value.trim();
    const names = document.getElementById('FactusFacturaNombres').value.trim();
    const company = document.getElementById('FactusFacturaRazonSocial').value.trim();
    const errorField = document.getElementById('FactusFacturaError');

    if (!identification) {
        errorField.textContent = 'Escribe el número de documento del comprador.';
        document.getElementById('FactusFacturaIdentificacion').focus();
        return false;
    }
    if (tipoDocumento === '31') {
        const separatedNit = /^([\d.\s]+)\s*-\s*(\d)$/.exec(identification);
        if (separatedNit) {
            identification = separatedNit[1].replace(/\D/g, '');
            if (!dv) dv = separatedNit[2];
        } else {
            identification = identification.replace(/\D/g, '');
        }
        if (!/^\d+$/.test(identification) || (dv && !/^\d$/.test(dv))) {
            errorField.textContent = 'Para un NIT, ingresa solo los números y deja el DV en su campo.';
            document.getElementById('FactusFacturaIdentificacion').focus();
            return false;
        }
    }
    if (tipoCliente === '1' && !company) {
        errorField.textContent = 'Escribe la razón social exactamente como aparece en el RUT.';
        document.getElementById('FactusFacturaRazonSocial').focus();
        return false;
    }
    if (tipoCliente === '2' && !names) {
        errorField.textContent = 'Escribe el nombre completo del comprador como aparece en su documento.';
        document.getElementById('FactusFacturaNombres').focus();
        return false;
    }

    const previousCustomer = factusPayInvoicePayload?.customer || {};
    factusPayInvoicePayload = {
        ...(factusPayInvoicePayload || {}),
        customer: {
            ...previousCustomer,
            identification_document_code: tipoDocumento,
            identification,
            legal_organization_code: tipoCliente,
            ...(dv ? { dv } : { dv: undefined }),
            ...(tipoCliente === '1'
                ? { company, names: undefined }
                : { names, company: undefined })
        }
    };
    errorField.textContent = '';
    return true;
}

// Conecta los campos del cliente con el catálogo de municipios de Factus.
function inicializarSelectorMunicipio() {
    MUNICIPALITY_FIELDS.forEach(([inputId, codeId]) => {
        const input = document.getElementById(inputId);
        input?.addEventListener('input', () => sincronizarMunicipioSeleccionado(inputId, codeId));
        input?.addEventListener('change', () => sincronizarMunicipioSeleccionado(inputId, codeId));
    });
    cargarMunicipiosFactus();
}

// Carga el catálogo de municipios de Factus y llena las opciones de búsqueda.
async function cargarMunicipiosFactus() {
    try {
        const response = await fetch('/Medios/municipios-factus.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const catalog = await response.json();
        municipiosFactus = Array.isArray(catalog.municipalities) ? catalog.municipalities : [];
        const datalist = document.getElementById('MunicipiosFactusOpciones');
        const options = document.createDocumentFragment();
        municipiosFactus
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, 'es') || a.department.localeCompare(b.department, 'es'))
            .forEach((municipality) => {
                const option = document.createElement('option');
                option.value = etiquetaMunicipio(municipality);
                options.appendChild(option);
            });
        datalist.replaceChildren(options);

        MUNICIPALITY_FIELDS.forEach(([inputId, codeId]) => {
            const code = document.getElementById(codeId)?.value || '11001';
            setMunicipioPorCodigo(inputId, codeId, code);
        });
    } catch (error) {
        console.error('No se pudo cargar el catálogo local de municipios Factus:', error);
    }
}

// Construye la etiqueta visible de un municipio con departamento y código.
function etiquetaMunicipio(municipality) {
    if (String(municipality.code) === '11001') return `Bogotá, D.C. (${municipality.code})`;
    return `${municipality.name} — ${municipality.department} (${municipality.code})`;
}

// Asigna un código de municipio y actualiza el texto visible correspondiente.
function setMunicipioPorCodigo(inputId, codeId, code) {
    const codeInput = document.getElementById(codeId);
    const nameInput = document.getElementById(inputId);
    if (!codeInput || !nameInput) return;
    const codeValue = String(code || '');
    codeInput.value = codeValue;
    const municipality = municipiosFactus.find(item => String(item.code) === codeValue);
    if (municipality) nameInput.value = etiquetaMunicipio(municipality);
}

// Guarda el código oficial cuando el usuario elige una opción del catálogo.
function sincronizarMunicipioSeleccionado(inputId, codeId) {
    const nameInput = document.getElementById(inputId);
    const codeInput = document.getElementById(codeId);
    if (!nameInput || !codeInput) return;
    const selected = municipiosFactus.find(item => etiquetaMunicipio(item) === nameInput.value.trim());
    codeInput.value = selected ? String(selected.code) : '';
}


// NAVEGACIÓN Y PESTAÑAS DEL MENU

// Cambia la vista del cajero entre las secciones disponibles.
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


// TABS (Recomendados / Menú Completo)

// Configura las pestañas para alternar recomendaciones y menú completo.
function inicializarTabs() {
    const btnDestacado = document.getElementById('btnDestacado');
    const btnMenu      = document.getElementById('btnMenuCompleto');
    const vistaDestacado = document.getElementById('VistaDestacado');
    const vistaMenu      = document.getElementById('VistaMenu');

    if (!btnDestacado || !btnMenu || !vistaDestacado || !vistaMenu) return;

    btnDestacado.addEventListener('click', () => {
        btnDestacado.classList.add('active');
        btnMenu.classList.remove('active');
        vistaDestacado.classList.remove('VistaOculta');
        vistaDestacado.classList.add('VistaActiva');
        vistaMenu.classList.remove('VistaActiva');
        vistaMenu.classList.add('VistaOculta');
    });

    btnMenu.addEventListener('click', () => {
        btnMenu.classList.add('active');
        btnDestacado.classList.remove('active');
        vistaMenu.classList.remove('VistaOculta');
        vistaMenu.classList.add('VistaActiva');
        vistaDestacado.classList.remove('VistaActiva');
        vistaDestacado.classList.add('VistaOculta');
    });
}


// CATÁLOGO: RECOMENDADOS Y MENÚ COMPLETO

// Obtiene los productos más vendidos para llenar la sección de recomendados.
async function cargarProductosDestacados() {
    const contenedor = document.getElementById('ContenedorRecomendados');
    if (!contenedor) return;

    try {
        const res = await fetch(`${URL_CAJA}/mas-vendidos`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const datos = await res.json();

        if (datos.success && Array.isArray(datos.productos) && datos.productos.length > 0) {
            const recomendados = FACTUS_PAY_TEST_MODE
                ? [...datos.productos, ...FACTUS_PAY_TEST_PRODUCTS]
                : datos.productos;
            renderizarCards(contenedor, recomendados);
        } else {
            mostrarFallbackRecomendados(contenedor);
        }
    } catch (err) {
        console.error('Error cargando destacados:', err);
        mostrarFallbackRecomendados(contenedor);
    }
}

// Muestra una selección local si no se pudieron obtener los más vendidos.
function mostrarFallbackRecomendados(contenedor) {
    const primeros = productos.slice(0, 4);
    if (primeros.length > 0) {
        renderizarCards(contenedor, primeros);
    } else {
        contenedor.innerHTML = `<p style="color:#888;text-align:center;padding:20px;">${errorCargaProductos || 'No hay productos destacados'}</p>`;
    }
}


// Carga el catálogo desde el backend y prepara los productos para la venta.
async function cargarProductos() {
    try {
        // Este endpoint consulta Supabase y devuelve los campos que usa el cajero.
        const res = await fetch(`${URL_CAJA}/productos`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const datos = await res.json();

        if (datos.success && Array.isArray(datos.productos)) {
            productos = datos.productos;
            errorCargaProductos = '';
        } else {
            throw new Error(datos.message || 'La respuesta no contiene una lista de productos.');
        }
    } catch (err) {
        console.error('Error cargando productos:', err);
        productos = [];
        errorCargaProductos = 'No se pudieron cargar los productos desde Supabase. Verifica tu conexión e inténtalo de nuevo.';
    }

    if (FACTUS_PAY_TEST_MODE) {
        productos = [...productos, ...FACTUS_PAY_TEST_PRODUCTS.map((item) => ({ ...item }))];
    }

    await cargarInventarioParaCatalogo();

    cargarProductosDestacados();
    renderizarMenuCompleto();
}

// Carga existencias y recetas para marcar en gris lo que no se puede preparar.
async function cargarInventarioParaCatalogo() {
    inventarioCaja.estado = 'cargando';
    try {
        const [respuestaRecetas, respuestaInsumos] = await Promise.all([
            fetch(`${URL_CAJA}/recetas`),
            fetch(`${URL_CAJA}/insumos`)
        ]);
        if (!respuestaRecetas.ok || !respuestaInsumos.ok) throw new Error('No se pudo leer el inventario.');
        const [datosRecetas, datosInsumos] = await Promise.all([
            respuestaRecetas.json(),
            respuestaInsumos.json()
        ]);
        if (!datosRecetas.success || !datosInsumos.success) throw new Error('El servidor no devolvió el inventario completo.');

        const detallesPorReceta = new Map();
        await Promise.all((datosRecetas.recetas || []).map(async receta => {
            const response = await fetch(`${URL_CAJA}/recetas/${receta.ID}`);
            if (!response.ok) throw new Error(`No se pudo leer la receta ${receta.NOMBRE || receta.ID}.`);
            const detalle = await response.json();
            if (!detalle.success) throw new Error(detalle.message || 'No se pudo leer una receta.');
            detallesPorReceta.set(Number(receta.ID), detalle.detalles || []);
        }));

        inventarioCaja = {
            estado: 'listo',
            insumos: datosInsumos.insumos || [],
            recetasPorProducto: new Map((datosRecetas.recetas || []).map(receta => [Number(receta.PRODUCTO_ID), receta])),
            detallesPorReceta
        };
    } catch (error) {
        console.error('No se pudo calcular la disponibilidad del menú:', error);
        inventarioCaja = { estado: 'error', insumos: [], recetasPorProducto: new Map(), detallesPorReceta: new Map() };
    }
    actualizarEstadoVisualStock();
}


// NÚMERO VISIBLE DEL PRÓXIMO PEDIDO

// Consulta y presenta el último número de factura disponible en caja.
async function cargarNumeroFactura() {
    try {
        const res = await fetch(`${URL_CAJA}/ultima-factura`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const datos = await res.json();

        if (datos.success && datos.ultimo_id !== undefined) {
            numeroFactura = datos.ultimo_id + 1;
        } else {
            numeroFactura = 1;
        }
    } catch (err) {
        console.error('Error obteniendo número de factura:', err);
        numeroFactura = 1;
    }

    const el = document.getElementById('PedidoActual');
    if (el) el.textContent = `#${String(numeroFactura).padStart(4, '0')}`;
}


// Agrupa los productos por categoría y dibuja el menú completo.
function renderizarMenuCompleto() {
    const contenedor = document.getElementById('ContenedorMenu');
    if (!contenedor) return;

    if (productos.length === 0) {
        contenedor.innerHTML = `<p style="color:#888;text-align:center;padding:20px;">${errorCargaProductos || 'No hay productos en el menú'}</p>`;
        return;
    }

    let tabsContainer = document.getElementById('MenuCategoriasTabs');
    if (!tabsContainer) {
        tabsContainer = document.createElement('div');
        tabsContainer.id = 'MenuCategoriasTabs';
        tabsContainer.className = 'tabs cajero-tabs';
        tabsContainer.style.marginBottom = '20px';
        contenedor.parentNode.insertBefore(tabsContainer, contenedor);
    }

    const categorias = [...new Set(productos.map(p => p.CATEGORIA).filter(c => c))].sort();

    let tabsHtml = `<button class="tab active" data-cat="todos" onclick="filtrarCategoria('todos')">Todos</button>`;
    categorias.forEach(cat => {
        tabsHtml += `<button class="tab" data-cat="${cat}" onclick="filtrarCategoria('${cat}')">${cat}</button>`;
    });
    tabsContainer.innerHTML = tabsHtml;

    filtrarCategoria('todos');
}

// Aplica el filtro de categoría seleccionado.
function filtrarCategoria(categoria) {
    const contenedor = document.getElementById('ContenedorMenu');
    if (!contenedor) return;

    document.querySelectorAll('#MenuCategoriasTabs .tab').forEach(t => {
        t.classList.toggle('active', t.dataset.cat === categoria);
    });

    const filtrados = categoria === 'todos'
        ? productos
        : productos.filter(p => p.CATEGORIA === categoria);

    if (filtrados.length === 0) {
        contenedor.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">Sin productos en esta categoría</p>';
        return;
    }

    renderizarCards(contenedor, filtrados);
}


// Renderiza las tarjetas de una lista de productos en el contenedor recibido.
function renderizarCards(contenedor, listaProductos) {
    contenedor.innerHTML = '';
    listaProductos.forEach(producto => {
        const card = crearCardElement(producto);
        contenedor.appendChild(card);
    });
    actualizarEstadoVisualStock();
}

// Crea la tarjeta visual de un producto y conecta su acción para agregarlo.
function crearCardElement(producto) {
    const template = document.getElementById('TemplateProducto');
    if (!template) {
        const div = document.createElement('div');
        div.textContent = 'Error: template no encontrado';
        return div;
    }

    const clone = template.content.cloneNode(true);
    const article = clone.querySelector('article');
    if (article) article.dataset.productId = String(producto.ID);

    const img = article.querySelector('.ImagenProducto');
    if (img) {
        img.src = producto.FOTO || 'Medios/logo.png';
        img.alt = producto.NOMBRE || 'Producto';
    }

    const nombreEl = article.querySelector('.NombreProducto');
    if (nombreEl) nombreEl.textContent = producto.NOMBRE;

    const descEl = article.querySelector('.DescripcionProducto');
    if (descEl) descEl.textContent = producto.DESCRIPCION || '';

    const precioEl = article.querySelector('.PrecioProducto');
    if (precioEl) precioEl.textContent = `$${formatearPrecio(producto.PRECIO)}`;

    const btnAgregar = article.querySelector('.AgregarProducto');
    if (btnAgregar) {
        btnAgregar.dataset.id = producto.ID;
        btnAgregar.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btnAgregar.dataset.id);
            if (!isNaN(id)) void agregarAlCarrito(id);
        });
    }

    return article;
}


// CARRITO: AGREGAR PRODUCTOS Y CALCULAR TOTALES

// Agrega una unidad solo cuando quedan insumos suficientes para prepararla.
async function agregarAlCarrito(idProducto) {
    const producto = productos.find(p => p.ID === idProducto);
    if (!producto) return;

    if (inventarioCaja.estado === 'cargando' || inventarioCaja.estado === 'error') {
        mostrarAvisoStock(inventarioCaja.estado === 'cargando'
            ? 'Estoy verificando los insumos. Intenta agregar el producto en un momento.'
            : 'No pude verificar el inventario. Recarga el menú antes de agregar productos.');
        return;
    }

    const disponibilidad = calcularUnidadesAdicionales(idProducto);
    if (disponibilidad.maximo < 1) {
        informarLimiteProducto(producto, disponibilidad);
        return;
    }

    const existente = carrito.find(item => item.id === idProducto);
    if (existente) {
        existente.cantidad++;
    } else {
        carrito.push({
            id: producto.ID,
            nombre: producto.NOMBRE,
            precio: parseFloat(producto.PRECIO),
            cantidad: 1
        });
    }

    renderizarCarrito();
    actualizarTotales();
    actualizarEstadoVisualStock();
}

// Aumenta una unidad del carrito si el inventario compartido todavía alcanza.
async function aumentarCantidad(idProducto) {
    const item = carrito.find(item => item.id === idProducto);
    if (!item) return;
    const disponibilidad = calcularUnidadesAdicionales(idProducto);
    if (disponibilidad.maximo < 1) {
        informarLimiteProducto(productos.find(producto => producto.ID === idProducto) || item, disponibilidad);
        return;
    }
    item.cantidad++;
    renderizarCarrito();
    actualizarTotales();
    actualizarEstadoVisualStock();
}

// Reduce la cantidad del producto y lo elimina si llega a cero.
function disminuirCantidad(idProducto) {
    const index = carrito.findIndex(item => item.id === idProducto);
    if (index > -1) {
        carrito[index].cantidad--;
        if (carrito[index].cantidad <= 0) {
            carrito.splice(index, 1);
        }
        renderizarCarrito();
        actualizarTotales();
        actualizarEstadoVisualStock();
    }
}

// Dibuja las líneas del carrito con controles de cantidad y subtotales.
function renderizarCarrito() {
    const contenedor = document.getElementById('ListaPedido');
    if (!contenedor) return;

    contenedor.innerHTML = '';

    if (carrito.length === 0) {
        contenedor.innerHTML = '<div style="color:#666;text-align:center;padding:20px;">El carrito está vacío</div>';
        return;
    }

    carrito.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'PedidoItem cajero-pedido-item';
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);';

        const leftDiv = document.createElement('div');
        leftDiv.style.cssText = 'flex:1;';

        const nombreEl = document.createElement('h4');
        nombreEl.className = 'PedidoNombre';
        nombreEl.style.cssText = 'color:white;font-weight:500;margin:0;font-size:0.95rem;';
        nombreEl.textContent = `${index + 1}. ${item.nombre}`;

        const cantidadEl = document.createElement('small');
        cantidadEl.className = 'PedidoCantidad';
        cantidadEl.style.cssText = 'color:#888;font-size:0.8rem;';
        cantidadEl.textContent = `${item.cantidad} unidad${item.cantidad > 1 ? 'es' : ''}`;

        leftDiv.appendChild(nombreEl);
        leftDiv.appendChild(cantidadEl);

        const rightDiv = document.createElement('div');
        rightDiv.style.cssText = 'display:flex;align-items:center;gap:10px;';

        const precioEl = document.createElement('strong');
        precioEl.className = 'PedidoPrecio';
        precioEl.style.cssText = 'color:#e94560;font-weight:600;';
        precioEl.textContent = `$${formatearPrecio(item.precio * item.cantidad)}`;

        const btnMenos = document.createElement('button');
        btnMenos.textContent = '−';
        btnMenos.style.cssText = 'background:#e94560;color:white;border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;font-weight:bold;font-size:16px;display:flex;align-items:center;justify-content:center;';
        btnMenos.addEventListener('click', () => disminuirCantidad(item.id));

        const btnMas = document.createElement('button');
        btnMas.textContent = '+';
        btnMas.style.cssText = 'background:#2ed573;color:white;border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;font-weight:bold;font-size:16px;display:flex;align-items:center;justify-content:center;';
        btnMas.addEventListener('click', () => aumentarCantidad(item.id));

        rightDiv.appendChild(precioEl);
        rightDiv.appendChild(btnMenos);
        rightDiv.appendChild(btnMas);

        row.appendChild(leftDiv);
        row.appendChild(rightDiv);
        contenedor.appendChild(row);
    });
}

// Recalcula y muestra subtotal, impuestos y total de la compra.
function actualizarTotales() {
    const subtotal = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
    const iva = subtotal * 0.19;
    const total = subtotal + iva;

    const elSubtotal = document.getElementById('Subtotal');
    const elIVA      = document.getElementById('IVA');
    const elTotal    = document.getElementById('Total');

    if (elSubtotal) elSubtotal.textContent = `$${formatearPrecio(subtotal)}`;
    if (elIVA)      elIVA.textContent      = `$${formatearPrecio(iva)}`;
    if (elTotal)    elTotal.textContent    = `$${formatearPrecio(total)}`;
}

// Presenta un valor como moneda colombiana para el cajero.
function formatearPrecio(valor) {
    return valor.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Calcula los insumos que consume una unidad del producto seleccionado.
function obtenerRequerimientosProducto(idProducto) {
    if (FACTUS_PAY_TEST_IDS.has(Number(idProducto))) {
        return { controlado: false, requerimientos: [], sinInsumos: false };
    }

    const producto = productos.find(item => Number(item.ID) === Number(idProducto));
    if (!producto) return { controlado: true, requerimientos: [], sinInsumos: true };

    const receta = inventarioCaja.recetasPorProducto.get(Number(idProducto));
    if (receta) {
        const detalles = inventarioCaja.detallesPorReceta.get(Number(receta.ID)) || [];
        const requerimientos = detalles.map(detalle => ({
            id: Number(detalle.ID_INSUMO),
            cantidad: Number(detalle.CANTIDAD)
        }));
        return {
            controlado: true,
            requerimientos,
            sinInsumos: requerimientos.length === 0 || requerimientos.some(item => !item.id || !Number.isFinite(item.cantidad) || item.cantidad <= 0)
        };
    }

    const nombreProducto = String(producto.NOMBRE || '').trim().toLocaleLowerCase('es');
    const insumoDirecto = inventarioCaja.insumos.find(insumo =>
        String(insumo.NOMBRE || '').trim().toLocaleLowerCase('es') === nombreProducto
    );
    if (insumoDirecto) {
        return { controlado: true, requerimientos: [{ id: Number(insumoDirecto.ID), cantidad: 1 }], sinInsumos: false };
    }

    // Sin receta ni insumo relacionado, no hay forma segura de confirmar existencias.
    return { controlado: true, requerimientos: [], sinInsumos: true };
}

// Devuelve cuántas unidades adicionales caben con lo que queda para todo el carrito.
function calcularUnidadesAdicionales(idProducto) {
    const seleccion = obtenerRequerimientosProducto(idProducto);
    if (!seleccion.controlado) return { maximo: Infinity, sinInsumos: false };
    if (seleccion.sinInsumos) return { maximo: 0, sinInsumos: true };

    const consumidoPorInsumo = new Map();
    carrito.forEach(item => {
        const requerimientos = obtenerRequerimientosProducto(item.id);
        requerimientos.requerimientos.forEach(insumo => {
            consumidoPorInsumo.set(
                insumo.id,
                (consumidoPorInsumo.get(insumo.id) || 0) + insumo.cantidad * item.cantidad
            );
        });
    });

    let maximo = Infinity;
    for (const requerimiento of seleccion.requerimientos) {
        const insumo = inventarioCaja.insumos.find(item => Number(item.ID) === requerimiento.id);
        if (!insumo) return { maximo: 0, sinInsumos: true };
        const stockDisponible = Number(insumo.STOCK) - (consumidoPorInsumo.get(requerimiento.id) || 0);
        maximo = Math.min(maximo, Math.floor((stockDisponible + 1e-9) / requerimiento.cantidad));
    }
    return { maximo: Number.isFinite(maximo) ? Math.max(0, maximo) : 0, sinInsumos: false };
}

// Pinta en gris productos agotados o cuya receta no tiene insumos configurados.
function actualizarEstadoVisualStock() {
    document.querySelectorAll('.AgregarProducto').forEach(boton => {
        const idProducto = Number(boton.dataset.id);
        const tarjeta = boton.closest('article');
        const bloqueadoPorCarga = inventarioCaja.estado !== 'listo' && !FACTUS_PAY_TEST_IDS.has(idProducto);
        const disponibilidad = inventarioCaja.estado === 'listo'
            ? calcularUnidadesAdicionales(idProducto)
            : { maximo: FACTUS_PAY_TEST_IDS.has(idProducto) ? Infinity : 0, sinInsumos: false };
        const agotado = bloqueadoPorCarga || disponibilidad.maximo < 1;
        // Gris indica que no alcanza; se deja clicable para explicar cuántas unidades quedan.
        boton.disabled = bloqueadoPorCarga;
        boton.setAttribute('aria-disabled', String(agotado));
        boton.title = bloqueadoPorCarga
            ? 'No se pudo verificar el inventario.'
            : (disponibilidad.sinInsumos ? 'Este producto no tiene insumos configurados.' : (agotado ? 'No hay insumos suficientes.' : 'Agregar al pedido'));
        if (tarjeta) {
            tarjeta.style.filter = agotado ? 'grayscale(1)' : '';
            tarjeta.style.opacity = agotado ? '0.55' : '';
        }
    });
}

// Informa cuántas unidades más permite el inventario sin interrumpir la venta.
function informarLimiteProducto(producto, disponibilidad) {
    const enCarrito = carrito.find(item => Number(item.id) === Number(producto.ID));
    const cantidadActual = enCarrito?.cantidad || 0;
    const nombre = producto.NOMBRE || 'Este producto';
    const mensaje = disponibilidad.sinInsumos
        ? `${nombre} no se puede agregar: no tiene insumos disponibles o configurados.`
        : disponibilidad.maximo > 0
            ? `De ${nombre} puedes agregar ${disponibilidad.maximo} unidad${disponibilidad.maximo === 1 ? '' : 'es'} más. Ya tienes ${cantidadActual} en el carrito.`
            : `Con el inventario actual solo alcanzan ${cantidadActual} unidad${cantidadActual === 1 ? '' : 'es'} de ${nombre}. Ya tienes ${cantidadActual} en el carrito.`;
    mostrarAvisoStock(mensaje);
}

// Muestra avisos de inventario en una notificación propia, sin alertas bloqueantes.
function mostrarAvisoStock(mensaje) {
    let aviso = document.getElementById('AvisoStockCajero');
    if (!aviso) {
        aviso = document.createElement('div');
        aviso.id = 'AvisoStockCajero';
        aviso.setAttribute('role', 'status');
        aviso.setAttribute('aria-live', 'polite');
        aviso.style.cssText = 'position:fixed;z-index:9999;left:50%;bottom:24px;transform:translateX(-50%);max-width:min(520px,calc(100vw - 32px));padding:14px 18px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:#202633;color:#fff;box-shadow:0 10px 32px rgba(0,0,0,.4);font-size:14px;line-height:1.45;text-align:center;';
        document.body.appendChild(aviso);
    }
    aviso.textContent = mensaje;
    aviso.hidden = false;
    clearTimeout(avisoStockTimer);
    avisoStockTimer = window.setTimeout(() => { aviso.hidden = true; }, 4500);
}


// VALIDAR INVENTARIO ANTES DE COBRAR

// Verifica si los insumos de la receta alcanzan para la cantidad solicitada.
async function verificarStockReceta(idProducto, cantidad) {
    try {
        const res = await fetch(`${URL_CAJA}/recetas`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const datos = await res.json();
        
        if (!datos.success || !datos.recetas) {
            return { ok: true, faltantes: [] };
        }

        const receta = datos.recetas.find(r => r.PRODUCTO_ID === idProducto);
        if (!receta) {
            return { ok: true, faltantes: [] };
        }

        const resDetalle = await fetch(`${URL_CAJA}/recetas/${receta.ID}`);
        if (!resDetalle.ok) throw new Error('HTTP ' + resDetalle.status);
        const datosDetalle = await resDetalle.json();

        if (!datosDetalle.success || !datosDetalle.detalles) {
            return { ok: true, faltantes: [] };
        }

        const faltantes = [];
        
        for (const detalle of datosDetalle.detalles) {
            const cantidadNecesaria = parseFloat(detalle.CANTIDAD) * cantidad;
            
            const resInsumo = await fetch(`${URL_CAJA}/insumos`);
            if (!resInsumo.ok) continue;
            const datosInsumos = await resInsumo.json();
            
            if (!datosInsumos.success || !datosInsumos.insumos) continue;
            
            const insumo = datosInsumos.insumos.find(i => i.ID === detalle.ID_INSUMO);
            if (!insumo) {
                faltantes.push(`${detalle.INSUMO_NOMBRE} (no existe en inventario)`);
                continue;
            }
            
            const stockActual = parseFloat(insumo.STOCK);
            if (stockActual < cantidadNecesaria) {
                const faltante = cantidadNecesaria - stockActual;
                faltantes.push(
                    `${detalle.INSUMO_NOMBRE}: necesita ${cantidadNecesaria} ${insumo.UNIDAD}, ` +
                    `hay ${stockActual} ${insumo.UNIDAD} (faltan ${faltante.toFixed(2)})`
                );
            }
        }

        return { ok: faltantes.length === 0, faltantes };

    } catch (err) {
        console.error('Error verificando stock de receta:', err);
        return { ok: false, faltantes: ['Error al verificar stock de recetas'] };
    }
}

// Comprueba las recetas de todos los productos antes de aceptar la venta.
async function validarStockIndirectoCarrito(items = carrito) {
    const productosAgrupados = {};
    for (const item of items) {
        if (productosAgrupados[item.id]) {
            productosAgrupados[item.id].cantidad += item.cantidad;
        } else {
            productosAgrupados[item.id] = { ...item };
        }
    }

    const faltantesTotales = [];
    
    for (const idProducto in productosAgrupados) {
        const item = productosAgrupados[idProducto];
        
        // verifica si tiene receta (stock indirecto)
        const resultadoReceta = await verificarStockReceta(parseInt(idProducto), item.cantidad);
        if (!resultadoReceta.ok) {
            faltantesTotales.push(
                `• ${item.nombre} (receta):\n  ${resultadoReceta.faltantes.join('\n  ')}`
            );
            continue;
        }
        
        // Si no tiene receta, verifica si es producto directo (stock en insumos)
        // Busca el insumo con el mismo nombre que el producto
        const resInsumos = await fetch(`${URL_CAJA}/insumos`);
        if (resInsumos.ok) {
            const datosInsumos = await resInsumos.json();
            if (datosInsumos.success && datosInsumos.insumos) {
                const insumoDirecto = datosInsumos.insumos.find(i => i.NOMBRE === item.nombre);
                if (insumoDirecto) {
                    const stockActual = parseFloat(insumoDirecto.STOCK);
                    if (stockActual < item.cantidad) {
                        faltantesTotales.push(
                            `• ${item.nombre} (producto directo): stock insuficiente. ` +
                            `Hay ${stockActual}, necesita ${item.cantidad}`
                        );
                    }
                }
            }
        }
    }

    if (faltantesTotales.length > 0) {
        return {
            ok: false,
            mensaje: 'No hay suficientes insumos para preparar los siguientes productos:\n\n' +
                     faltantesTotales.join('\n\n')
        };
    }

    return { ok: true, mensaje: '' };
}


// CLIENTE: DOCUMENTO Y DATOS FISCALES

// Conecta los botones de venta con los campos del cliente y el pago.
function inicializarEventos() {
    const btnConfirmar = document.getElementById('ConfirmarPago');
    if (btnConfirmar) btnConfirmar.addEventListener('click', confirmarPago);

    const tipoDocumento = document.getElementById('TipoDocumentoCliente');
    if (tipoDocumento) tipoDocumento.addEventListener('change', actualizarCamposIdentificacionCliente);

    const tipoCliente = document.getElementById('TipoClienteFactura');
    if (tipoCliente) tipoCliente.addEventListener('change', actualizarCamposIdentificacionCliente);

    const formaPago = document.getElementById('FormaPago');
    if (formaPago) formaPago.addEventListener('change', actualizarCamposFormaPago);

    actualizarCamposIdentificacionCliente();
    actualizarCamposFormaPago();
}

// Muestra u oculta campos fiscales según el tipo de documento del cliente.
function actualizarCamposIdentificacionCliente() {
    const esJuridica = document.getElementById('TipoClienteFactura').value === '1';
    const tipoDocumento = document.getElementById('TipoDocumentoCliente');
    if (esJuridica) tipoDocumento.value = '31';
    const esNit = document.getElementById('TipoDocumentoCliente').value === '31';
    document.getElementById('GrupoRazonSocial').hidden = !esJuridica;
    document.getElementById('RazonSocialCliente').required = esJuridica;
    document.getElementById('GrupoDVCliente').hidden = !esNit;
    document.getElementById('EtiquetaCliente').textContent = esJuridica ? 'Nombre del contacto (opcional)' : 'Nombre del cliente';
}

// Ajusta los campos del formulario según el medio de pago seleccionado.
function actualizarCamposFormaPago() {
    const esCredito = document.getElementById('FormaPago').value === '2';
    document.getElementById('GrupoVencimiento').hidden = !esCredito;
    document.getElementById('FechaVencimientoPago').required = esCredito;
}


// REVISAR CLIENTE, CARRITO Y CONFIRMAR EL PEDIDO

// Revisa los datos del cliente, el inventario y el medio de pago elegido.
async function confirmarPago() {
    // Lee los datos del cliente y de la forma de pago seleccionada.
    const cliente = document.getElementById('Cliente').value.trim();
    const cedula  = document.getElementById('Cedula').value.trim();
    const tipoDocumento = document.getElementById('TipoDocumentoCliente').value;
    const tipoCliente = document.getElementById('TipoClienteFactura').value;
    const razonSocial = document.getElementById('RazonSocialCliente').value.trim();
    const dvCliente = document.getElementById('DVCliente').value.trim();
    const correoCliente = document.getElementById('CorreoCliente').value.trim();
    const municipioCliente = document.getElementById('MunicipioCliente').value.trim();
    const formaPago = document.getElementById('FormaPago').value;
    const metodoPago = document.getElementById('MetodoPago').value;
    const fechaVencimiento = document.getElementById('FechaVencimientoPago').value;
    const referenciaPago = document.getElementById('ReferenciaPago').value.trim();
    const usaProductoPrueba = carrito.some((item) => FACTUS_PAY_TEST_IDS.has(item.id));

    // No inicia el cobro si falta el carrito o algún dato fiscal obligatorio.
    if (carrito.length === 0) {
        alert('El carrito está vacío. Agrega productos antes de confirmar el pago.');
        return;
    }

    if (usaProductoPrueba && metodoPago !== 'FACTUS_PAY') {
        alert('Las copias temporales solo se pueden usar con el método Factus Pay · QR.');
        return;
    }

    if (!cliente && tipoCliente !== '1') {
        alert('Por favor ingresa el nombre del cliente.');
        document.getElementById('Cliente').focus();
        return;
    }

    if (!cedula) {
        alert('Por favor ingresa el número de identificación del cliente.');
        document.getElementById('Cedula').focus();
        return;
    }

    if (!/^\d{5}$/.test(municipioCliente)) {
        alert('Ingresa el código oficial de 5 dígitos del municipio del cliente para emitir la factura.');
        document.getElementById('MunicipioCliente').focus();
        return;
    }

    if (tipoCliente === '1' && !razonSocial) {
        alert('Para una persona jurídica, ingresa la razón social registrada en el RUT.');
        document.getElementById('RazonSocialCliente').focus();
        return;
    }

    if (tipoDocumento === '31' && dvCliente && !/^\d$/.test(dvCliente)) {
        alert('El dígito de verificación debe ser un solo número.');
        document.getElementById('DVCliente').focus();
        return;
    }

    if (formaPago === '2' && !fechaVencimiento) {
        alert('Para el pago a crédito, indica la fecha de vencimiento.');
        document.getElementById('FechaVencimientoPago').focus();
        return;
    }

    // Revisa que las recetas y los productos directos alcancen antes de cobrar.
    const productosReales = carrito.filter((item) => !FACTUS_PAY_TEST_IDS.has(item.id));
    const validacionStock = await validarStockIndirectoCarrito(productosReales);
    if (!validacionStock.ok) {
        alert(validacionStock.mensaje);
        return;
    }

    const subtotal = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
    const iva = subtotal * 0.19;
    const total = subtotal + iva;
    // Prepara los datos fiscales que Caja enviará a Factus al emitir la factura.
    const customer = {
        identification_document_code: tipoDocumento,
        identification: cedula,
        legal_organization_code: tipoCliente,
        municipality_code: municipioCliente,
        country_code: 'CO'
    };
    if (tipoDocumento === '31' && dvCliente) customer.dv = dvCliente;
    if (correoCliente) customer.email = correoCliente;
    if (tipoCliente === '1') customer.company = razonSocial;
    else customer.names = cliente;

    const paymentDetail = {
        payment_form: formaPago,
        payment_method_code: metodoPago,
        amount: total.toFixed(2)
    };
    if (referenciaPago) paymentDetail.reference_code = referenciaPago;
    if (formaPago === '2') paymentDetail.due_date = fechaVencimiento;

    const payload = {
        id_empresa: Number(localStorage.getItem('id_empresa')) || 1,
        id_empleado: Number(localStorage.getItem('id_empleado')) || null,
        cliente_nombre: tipoCliente === '1' ? (razonSocial || cliente) : cliente,
        cliente_cedula: cedula,
        cliente_correo: correoCliente || null,
        productos: carrito,
        subtotal: subtotal,
        iva: iva,
        total: total,
        estado: 'pendiente',
        factus: {
            customer,
            payment_details: [paymentDetail]
        }
    };

    // Con los datos revisados, crea el QR o registra el pedido con el otro medio de pago.
    const confirmButton = document.getElementById('ConfirmarPago');
    confirmButton.disabled = true;
    try {
        if (metodoPago === 'FACTUS_PAY') {
            mostrarCargaFactusPay();
            factusPayInvoicePayload = {
                customer: { ...customer },
                productos: carrito.map(item => ({ id: item.id, cantidad: item.cantidad }))
            };
            const response = await fetch(`${URL_CAJA}/factus-pay/recaudos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const payment = await response.json();
            if (!response.ok || !payment.success) throw new Error(payment.message || 'No se pudo crear el recaudo Factus Pay.');
            mostrarModalFactusPay(payment);
            if (payment.status === 'paid') {
                await finalizarPagoFactusPay(payment);
            } else {
                factusPayPollTimer = setInterval(() => consultarEstadoFactusPay(payment.reference_code), 3000);
                if (payment.status === 'started' && !payment.qr) {
                    await consultarEstadoFactusPay(payment.reference_code);
                }
            }
            return;
        }

        const res = await fetch(`${URL_CAJA}/pedidos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error('HTTP ' + res.status + ': ' + errorText);
        }

        const datos = await res.json();

        if (datos.success) {
            // Descontar stock de productos directos (insumos)
            try {
                await descontarStockProductosDirectos(carrito);
            } catch (errStock) {
                console.error('Error descontando stock directo:', errStock);
            }

            // Descontar stock de recetas (productos normales)
            try {
                await procesarDescuentoStockIndirecto(carrito);
            } catch (errStock) {
                console.error('Error descontando stock de recetas:', errStock);
            }

            await cargarInventarioParaCatalogo();

            alert(`✅ Pedido #${String(numeroFactura).padStart(4, '0')} confirmado.\nCliente: ${cliente}\nTotal: $${formatearPrecio(total)}\nEstado: Pendiente`);
            limpiarTodo();
        } else {
            alert('Error al guardar el pedido: ' + (datos.message || 'Error desconocido'));
            confirmButton.disabled = false;
        }
    } catch (err) {
        console.error('Error en confirmarPago:', err);
        limpiarModalFactusPay();
        alert('❌ Error: ' + err.message + '\nVerifica que el servidor esté corriendo en http://localhost:3000');
        confirmButton.disabled = false;
    }
}


// FACTUS PAY: MOSTRAR Y CONSULTAR EL QR

// Abre el modal e informa que Factus Pay está generando el recaudo.
function mostrarCargaFactusPay() {
    factusPayFinalized = false;
    clearInterval(factusPayPollTimer);
    factusPayPollTimer = null;
    const modal = document.getElementById('FactusPayModal');
    const qr = document.getElementById('FactusPayQR');
    document.getElementById('FactusPayReferencia').textContent = 'Preparando…';
    document.getElementById('FactusPayMensaje').textContent = 'Creando el recaudo y preparando tu código QR…';
    document.getElementById('FactusPayCerrar').disabled = true;
    document.getElementById('FactusPayContenidoQR').hidden = false;
    document.getElementById('FactusFacturaResultado').hidden = true;
    qr.hidden = true;
    qr.removeAttribute('src');
    modal.hidden = false;
}

// Muestra el QR, la referencia y los datos del recaudo pendiente.
function mostrarModalFactusPay(payment) {
    factusPayFinalized = false;
    const modal = document.getElementById('FactusPayModal');
    const qr = document.getElementById('FactusPayQR');
    const close = document.getElementById('FactusPayCerrar');
    document.getElementById('FactusPayReferencia').textContent = payment.reference_code;
    document.getElementById('FactusPayMensaje').textContent = 'Escanea el QR desde la app de tu banco. Estamos verificando el pago.';
    close.disabled = true;
    qr.hidden = true;
    qr.removeAttribute('src');
    if (typeof payment.qr === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(payment.qr)) {
        qr.src = payment.qr;
        qr.hidden = false;
    }
    modal.hidden = false;
}

// Consulta al backend el estado actual del recaudo por su referencia.
async function consultarEstadoFactusPay(referenceCode) {
    if (factusPayFinalized) return;
    try {
        const response = await fetch(`${URL_CAJA}/factus-pay/recaudos/${encodeURIComponent(referenceCode)}`);
        const payment = await response.json();
        if (!response.ok || !payment.success) throw new Error(payment.message || 'No se pudo consultar el pago.');
        const messages = {
            started: 'Recaudo iniciado. Cargando el QR…',
            ready: 'Escanea el QR desde la app de tu banco. Estamos verificando el pago.',
            paid: 'Pago recibido. Confirmando el pedido…',
            failed: 'Factus Pay reportó que el pago falló.',
            rejected: 'Factus Pay rechazó el pago.',
            expired: payment.message || 'El QR venció después de diez minutos y el pedido se canceló.'
        };
        document.getElementById('FactusPayMensaje').textContent = messages[payment.status] || `Estado del pago: ${payment.status}`;
        const qr = document.getElementById('FactusPayQR');
        if (payment.status === 'expired' || payment.status === 'failed' || payment.status === 'rejected') {
            qr.hidden = true;
            qr.removeAttribute('src');
        } else if (typeof payment.qr === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(payment.qr)) {
            qr.src = payment.qr;
            qr.hidden = false;
        }
        if (payment.status === 'paid') {
            await finalizarPagoFactusPay(payment);
        } else if (payment.status === 'failed' || payment.status === 'rejected' || payment.status === 'expired') {
            clearInterval(factusPayPollTimer);
            factusPayPollTimer = null;
            document.getElementById('FactusPayCerrar').disabled = false;
        }
    } catch (error) {
        console.error('Error consultando Factus Pay:', error);
        document.getElementById('FactusPayMensaje').textContent = 'No pudimos consultar el estado en este momento. Seguiremos intentando.';
    }
}

// Finaliza la compra cuando Factus Pay confirma el pago y abre el resultado.
async function finalizarPagoFactusPay(payment) {
    if (factusPayFinalized) return;
    factusPayFinalized = true;
    clearInterval(factusPayPollTimer);
    factusPayPollTimer = null;
    document.getElementById('FactusPayTitulo').textContent = 'Pago recibido';
    document.getElementById('FactusPayMensaje').textContent = 'Pago confirmado. Generando la factura electrónica…';
    document.getElementById('FactusPayQR').hidden = true;
    document.getElementById('FactusPayQR').removeAttribute('src');
    document.getElementById('FactusPayReferencia').textContent = payment.reference_code || '';
    document.getElementById('FactusPayCerrar').disabled = true;
    factusPayInvoiceReference = payment.reference_code;
    guardarFacturaPendiente(payment);
    mostrarResultadoFactura({
        payment,
        invoice: null,
        status: 'Generando factura en Factus…',
        error: ''
    });

    const productosReales = carrito.filter((item) => !FACTUS_PAY_TEST_IDS.has(item.id));
    const inventarioPromise = (async () => {
        await descontarStockProductosDirectos(productosReales);
        await procesarDescuentoStockIndirecto(productosReales);
    })().then(
        () => null,
        error => error
    );

    const invoiceResult = await emitirFacturaFactus(payment);
    const inventoryError = await inventarioPromise;
    if (inventoryError) console.error('El pago se confirmó, pero hubo un error al actualizar inventario:', inventoryError);
    await cargarInventarioParaCatalogo();
    limpiarTodo({ preservarModalFactusPay: true });
    mostrarResultadoFactura({
        payment,
        invoice: invoiceResult.invoice,
        status: invoiceResult.success ? 'Factura emitida correctamente' : 'Pago confirmado; factura pendiente',
        error: [invoiceResult.error, inventoryError ? 'El inventario no se pudo actualizar completamente.' : ''].filter(Boolean).join(' ')
    });
    document.getElementById('FactusPayCerrar').disabled = false;
}


// FACTURA: SOLICITAR EMISIÓN Y MOSTRAR RESPUESTA

// Pide la factura después de recibir la confirmación de pago de Factus Pay.
async function emitirFacturaFactus(payment) {
    // Manejo de errores de facturas: el servidor limpia y reintenta los conflictos con Factus.
    const estadoFactura = document.getElementById('FactusFacturaEstado');
    const mensajeFactura = document.getElementById('FactusFacturaError');
    const botonCerrar = document.getElementById('FactusFacturaCerrar');
    if (estadoFactura) estadoFactura.textContent = 'Factus está revisando la factura pendiente…';
    if (mensajeFactura) mensajeFactura.textContent = 'El pago ya está confirmado; la recuperación se hace en segundo plano.';
    if (botonCerrar) botonCerrar.disabled = false;

    try {
        const response = await fetch(`${URL_CAJA}/factus-pay/recaudos/${encodeURIComponent(payment.reference_code)}/factura`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(factusPayInvoicePayload || {})
        });
        const responseText = await response.text();
        let result;
        try {
            result = responseText ? JSON.parse(responseText) : {};
        } catch {
            const detalle = responseText.includes('<!DOCTYPE') || responseText.includes('<html')
                ? 'El servidor respondió una página HTML. Reinicia el servidor Node.js para cargar la ruta de facturación.'
                : 'El servidor devolvió una respuesta que no es JSON.';
            throw new Error(`${detalle} (HTTP ${response.status})`);
        }
        if (!response.ok || !result.success) {
            throw new Error(result.message || 'Factus no pudo emitir la factura.');
        }

        borrarFacturaPendiente();
        return { success: true, invoice: result.invoice, error: '' };
    } catch (error) {
        console.error('Error emitiendo factura Factus:', error);
        return { success: false, invoice: null, error: error.message || 'Factus no pudo emitir la factura.' };
    }
}

// Presenta el estado del pago y factura, y prepara las acciones del modal.
function mostrarResultadoFactura({ payment, invoice, status, error }) {
    const pendingContent = document.getElementById('FactusPayContenidoQR');
    const resultContent = document.getElementById('FactusFacturaResultado');
    inicializarCamposCorreccionClienteFactura();
    pendingContent.hidden = true;
    resultContent.hidden = false;
    document.getElementById('FactusPayTitulo').textContent = 'Pago y factura';
    document.getElementById('FactusPayMensaje').textContent = '✅ Pago Factus Pay confirmado.';
    document.getElementById('FactusFacturaPedido').textContent = `#${payment.id_pedido}`;
    document.getElementById('FactusFacturaTotal').textContent = `$${formatearPrecio(Number(payment.amount))}`;
    document.getElementById('FactusFacturaTotal').dataset.amount = String(Number(payment.amount));
    document.getElementById('FactusFacturaEstado').textContent = status;
    document.getElementById('FactusFacturaError').textContent = error || '';
    const municipalityGroup = document.getElementById('FactusFacturaMunicipioGrupo');
    const municipalityIsRequired = !invoice && /customer\.municipality_code|municipio/i.test(error || '');
    municipalityGroup.hidden = !municipalityIsRequired;
    const customerCorrectionGroup = document.getElementById('FactusFacturaClienteGrupo');
    customerCorrectionGroup.hidden = Boolean(invoice) || status.includes('Generando');
    customerCorrectionGroup.style.display = customerCorrectionGroup.hidden ? 'none' : 'grid';
    if (!customerCorrectionGroup.hidden) {
        cargarDatosCorreccionClienteFactura(factusPayInvoicePayload?.customer || {});
    }
    setMunicipioPorCodigo(
        'FactusFacturaMunicipioNombre',
        'FactusFacturaMunicipio',
        factusPayInvoicePayload?.customer?.municipality_code || '11001'
    );
    document.getElementById('FactusFacturaReintentar').hidden = Boolean(invoice) || status.includes('Generando');

    const numero = invoice?.numero || 'Pendiente de respuesta';
    const cufe = invoice?.cufe || 'No disponible';
    factusInvoiceNumber = invoice?.numero ? String(invoice.numero) : '';
    document.getElementById('FactusNumeroFactura').textContent = String(numero);
    document.getElementById('FactusCufe').textContent = String(cufe);
    document.getElementById('FactusFacturaMensaje').textContent = invoice?.mensaje || (invoice ? '' : 'La compra quedó pagada. Puedes reintentar la emisión de la factura.');
    configurarVistaPdfFactura(invoice?.pdfBase64, invoice?.pdf);
    document.getElementById('FactusFacturaVer').disabled = !invoice || (!factusInvoicePdfObjectUrl && !factusInvoicePdfPublicUrl);

    const emailPanel = document.getElementById('FactusCorreoPanel');
    const emailToggle = document.getElementById('FactusEnviarCorreo');
    const emailInput = document.getElementById('FactusCorreoDestino');
    const emailGroup = document.getElementById('FactusCorreoGrupo');
    const emailStatus = document.getElementById('FactusCorreoEstado');
    emailPanel.hidden = !invoice;
    emailToggle.checked = false;
    emailToggle.disabled = false;
    emailInput.disabled = false;
    emailInput.value = factusPayInvoicePayload?.customer?.email || '';
    emailGroup.hidden = true;
    emailStatus.textContent = '';
    emailStatus.classList.remove('factus-email-status-error', 'factus-email-status-success');
    factusEmailSending = false;
    factusEmailSent = false;

    document.getElementById('FactusFacturaCerrar').disabled = status.includes('Generando');
}

// Prepara el PDF recibido o una URL pública segura para abrir la factura.
function configurarVistaPdfFactura(base64, publicUrl) {
    if (factusInvoicePdfObjectUrl) URL.revokeObjectURL(factusInvoicePdfObjectUrl);
    factusInvoicePdfObjectUrl = null;
    factusInvoicePdfPublicUrl = '';
    if (typeof publicUrl === 'string' && publicUrl) {
        try {
            const parsed = new URL(publicUrl, window.location.href);
            if (parsed.protocol === 'https:') factusInvoicePdfPublicUrl = parsed.href;
        } catch {
            factusInvoicePdfPublicUrl = '';
        }
    }
    if (typeof base64 === 'string' && base64) {
        try {
            const cleanBase64 = base64.replace(/^data:application\/pdf;base64,/, '');
            const binary = atob(cleanBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            factusInvoicePdfObjectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        } catch (error) {
            console.error('No se pudo preparar el PDF de la factura:', error);
        }
    }
}

// Abre en otra pestaña el PDF de la factura emitida.
function abrirFacturaFactus() {
    const url = factusInvoicePdfObjectUrl || factusInvoicePdfPublicUrl;
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
}


// CORREO: ENVIAR LA FACTURA AL CLIENTE

// Muestra el campo de destino y envía la factura al activar la casilla.
function cambiarEnvioCorreoFactura() {
    const emailGroup = document.getElementById('FactusCorreoGrupo');
    const emailInput = document.getElementById('FactusCorreoDestino');
    const emailStatus = document.getElementById('FactusCorreoEstado');
    const checked = document.getElementById('FactusEnviarCorreo').checked;
    emailGroup.hidden = !checked;
    if (!checked) {
        emailStatus.textContent = '';
        emailStatus.classList.remove('factus-email-status-error', 'factus-email-status-success');
        return;
    }
    if (!emailInput.value.trim()) {
        emailStatus.textContent = 'Escribe el correo donde quieres recibir la factura.';
        emailInput.focus();
        return;
    }
    enviarFacturaFactusCorreo();
}

// Pide al backend que envíe por Gmail la factura PDF al destinatario indicado.
async function enviarFacturaFactusCorreo() {
    const emailInput = document.getElementById('FactusCorreoDestino');
    const emailStatus = document.getElementById('FactusCorreoEstado');
    const toggle = document.getElementById('FactusEnviarCorreo');
    const email = emailInput.value.trim();
    if (!toggle.checked || factusEmailSent || factusEmailSending) return;
    if (!emailInput.checkValidity()) {
        emailStatus.textContent = 'Escribe una dirección de correo válida.';
        return;
    }
    if (!factusPayInvoiceReference || !factusInvoiceNumber) {
        emailStatus.textContent = 'No encontramos el número de la factura para enviarla.';
        return;
    }

    factusEmailSending = true;
    toggle.disabled = true;
    emailInput.disabled = true;
    emailStatus.classList.remove('factus-email-status-error', 'factus-email-status-success');
    emailStatus.textContent = 'Enviando factura…';
    try {
        const response = await fetch(`${URL_CAJA}/factus-pay/recaudos/${encodeURIComponent(factusPayInvoiceReference)}/factura/enviar-correo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: factusInvoiceNumber, email })
        });
        const responseText = await response.text();
        let result;
        try {
            result = responseText ? JSON.parse(responseText) : {};
        } catch {
            throw new Error(`El servidor devolvió una respuesta inválida (HTTP ${response.status}).`);
        }
        if (!response.ok || !result.success) throw new Error(result.message || 'El proveedor de correo no pudo enviar la factura.');
        factusEmailSent = true;
        emailStatus.textContent = result.message || `Factura enviada a ${email}.`;
        emailStatus.classList.add('factus-email-status-success');
    } catch (error) {
        emailStatus.textContent = String(error?.message || 'El proveedor de correo no pudo enviar la factura.');
        emailStatus.classList.add('factus-email-status-error');
        toggle.disabled = false;
        emailInput.disabled = false;
        factusEmailSending = false;
    } finally {
        if (factusEmailSent) factusEmailSending = false;
    }
}

// Reintenta la emisión de una factura pendiente con los datos corregidos.
async function reintentarFacturaFactus() {
    const retryButton = document.getElementById('FactusFacturaReintentar');
    if (!factusPayInvoiceReference || !factusPayInvoicePayload) return;
    if (!leerDatosCorreccionClienteFactura()) return;

    const municipality = document.getElementById('FactusFacturaMunicipio').value.trim();
    if (document.getElementById('FactusFacturaMunicipioGrupo').hidden === false) {
        if (!/^\d{5}$/.test(municipality)) {
            document.getElementById('FactusFacturaError').textContent = 'Ingresa un código de municipio válido de 5 dígitos.';
            document.getElementById('FactusFacturaMunicipioNombre').focus();
            return;
        }
        factusPayInvoicePayload.customer.municipality_code = municipality;
    }
    retryButton.disabled = true;
    document.getElementById('FactusFacturaEstado').textContent = 'Reintentando…';
    document.getElementById('FactusFacturaError').textContent = '';
    const payment = {
        id_pedido: Number(factusPayInvoiceReference.replace('FOGON-', '')),
        reference_code: factusPayInvoiceReference,
        amount: Number(document.getElementById('FactusFacturaTotal').dataset.amount)
    };
    guardarFacturaPendiente(payment);
    try {
        const result = await emitirFacturaFactus(payment);
        mostrarResultadoFactura({
            payment,
            invoice: result.invoice,
            status: result.success ? 'Factura validada por Factus y la DIAN' : 'Pago confirmado; factura pendiente',
            error: result.error
        });
    } finally {
        retryButton.disabled = false;
    }
}


// RECUPERAR UNA FACTURA PENDIENTE SIN VOLVER A COBRAR

// Guarda localmente la referencia y datos necesarios para recuperar la factura.
function guardarFacturaPendiente(payment) {
    if (!payment?.reference_code || !factusPayInvoicePayload) return;
    const pending = {
        payment: {
            id_pedido: payment.id_pedido || Number(payment.reference_code.replace('FOGON-', '')),
            reference_code: payment.reference_code,
            amount: Number(payment.amount)
        },
        payload: factusPayInvoicePayload
    };
    try {
        sessionStorage.setItem(FACTUS_PENDING_STORAGE_KEY, JSON.stringify(pending));
    } catch (error) {
        console.warn('No se pudo guardar la factura pendiente para recuperarla después:', error);
    }
}

// Elimina del almacenamiento local la factura pendiente que ya se resolvió.
function borrarFacturaPendiente() {
    try {
        sessionStorage.removeItem(FACTUS_PENDING_STORAGE_KEY);
    } catch (error) {
        console.warn('No se pudo limpiar la factura pendiente guardada:', error);
    }
}

// Restaura el modal de una factura pendiente al volver a abrir el cajero.
function restaurarFacturaPendiente() {
    let pending;
    try {
        pending = JSON.parse(sessionStorage.getItem(FACTUS_PENDING_STORAGE_KEY) || 'null');
    } catch {
        borrarFacturaPendiente();
        return;
    }
    if (!pending?.payment?.reference_code || !pending?.payload?.customer) return;
    factusPayInvoicePayload = pending.payload;
    factusPayInvoiceReference = pending.payment.reference_code;
    factusPayFinalized = true;
    setMunicipioPorCodigo(
        'MunicipioClienteNombre',
        'MunicipioCliente',
        pending.payload.customer.municipality_code || '11001'
    );
    mostrarResultadoFactura({
        payment: pending.payment,
        invoice: null,
        status: 'Pago confirmado; factura pendiente',
        error: 'La factura quedó pendiente. Puedes reintentar la emisión sin volver a cobrar.'
    });
    document.getElementById('FactusPayCerrar').disabled = false;
    document.getElementById('FactusPayModal').hidden = false;
}

// Recupera un pedido pagado y vuelve a consultar o emitir su factura.
async function recuperarFacturaPendiente() {
    const orderField = document.getElementById('FactusPedidoRecuperar');
    const municipalityField = document.getElementById('MunicipioRecuperar');
    const errorField = document.getElementById('FactusFacturaRecuperarError');
    const button = document.getElementById('FactusFacturaRecuperar');
    const orderId = orderField.value.trim();
    const municipality = municipalityField.value.trim();
    errorField.textContent = '';

    if (!/^\d+$/.test(orderId)) {
        errorField.textContent = 'Ingresa el número del pedido pagado.';
        orderField.focus();
        return;
    }
    if (!/^\d{5}$/.test(municipality)) {
        errorField.textContent = 'Ingresa el código oficial de 5 dígitos del municipio del cliente.';
        municipalityField.focus();
        return;
    }

    button.disabled = true;
    try {
        const referenceCode = `FOGON-${Number(orderId)}`;
        const response = await fetch(`${URL_CAJA}/factus-pay/recaudos/${encodeURIComponent(referenceCode)}/factura-info`);
        const info = await response.json();
        if (!response.ok || !info.success) throw new Error(info.message || 'No se pudo recuperar ese pedido.');

        const legalOrganizationCode = document.getElementById('FactusTipoClienteRecuperar').value;
        const customer = {
            identification_document_code: document.getElementById('FactusDocumentoRecuperar').value,
            identification: String(info.customer.identification || ''),
            legal_organization_code: legalOrganizationCode,
            municipality_code: municipality,
            country_code: 'CO'
        };
        if (info.customer.email) customer.email = info.customer.email;
        if (legalOrganizationCode === '1') customer.company = info.customer.names;
        else customer.names = info.customer.names;

        factusPayInvoiceReference = referenceCode;
        factusPayInvoicePayload = { customer };
        guardarFacturaPendiente(info.payment);
        mostrarResultadoFactura({
            payment: info.payment,
            invoice: null,
            status: 'Pago confirmado; factura pendiente',
            error: 'Revisa o corrige los datos del comprador antes de volver a emitirla.'
        });
        setMunicipioPorCodigo('FactusFacturaMunicipioNombre', 'FactusFacturaMunicipio', municipality);
        document.getElementById('FactusFacturaMunicipioGrupo').hidden = true;
        document.getElementById('FactusPayCerrar').disabled = false;
        document.getElementById('FactusPayModal').hidden = false;
    } catch (error) {
        errorField.textContent = error.message;
    } finally {
        button.disabled = false;
    }
}

// Cierra el modal de Factus Pay y detiene la consulta periódica del recaudo.
function cerrarModalFactusPay() {
    const invoiceIsVisible = !document.getElementById('FactusFacturaResultado').hidden;
    const closeButton = document.getElementById(invoiceIsVisible ? 'FactusFacturaCerrar' : 'FactusPayCerrar');
    if (closeButton.disabled) return;
    limpiarModalFactusPay();
    document.getElementById('ConfirmarPago').disabled = false;
}

// Restablece los campos visuales del modal al terminar o cancelar el flujo.
function limpiarModalFactusPay() {
    clearInterval(factusPayPollTimer);
    factusPayPollTimer = null;
    const modal = document.getElementById('FactusPayModal');
    if (!modal) return;
    modal.hidden = true;
    const qr = document.getElementById('FactusPayQR');
    qr.hidden = true;
    qr.removeAttribute('src');
    document.getElementById('FactusPayReferencia').textContent = '';
    document.getElementById('FactusPayMensaje').textContent = 'Generando el código QR…';
    document.getElementById('FactusPayTitulo').textContent = 'Pago con Factus Pay';
    document.getElementById('FactusPayContenidoQR').hidden = false;
    document.getElementById('FactusFacturaResultado').hidden = true;
    if (factusInvoicePdfObjectUrl) URL.revokeObjectURL(factusInvoicePdfObjectUrl);
    factusInvoicePdfObjectUrl = null;
    factusInvoicePdfPublicUrl = '';
    factusInvoiceNumber = '';
    document.getElementById('FactusFacturaVer').disabled = true;
    document.getElementById('FactusCorreoPanel').hidden = true;
    document.getElementById('FactusEnviarCorreo').checked = false;
    document.getElementById('FactusEnviarCorreo').disabled = false;
    document.getElementById('FactusCorreoDestino').disabled = false;
    document.getElementById('FactusCorreoGrupo').hidden = true;
    document.getElementById('FactusCorreoEstado').textContent = '';
    factusEmailSending = false;
    factusEmailSent = false;
    document.getElementById('FactusPayCerrar').disabled = true;
    document.getElementById('FactusFacturaCerrar').disabled = true;
}

// Vacía carrito y datos de checkout, con opción de conservar el modal de pago.
function limpiarTodo({ preservarModalFactusPay = false } = {}) {
    if (!preservarModalFactusPay) limpiarModalFactusPay();
    document.getElementById('ConfirmarPago').disabled = false;
    carrito = [];
    renderizarCarrito();
    actualizarTotales();
    document.getElementById('Cliente').value = '';
    document.getElementById('Cedula').value = '';
    document.getElementById('RazonSocialCliente').value = '';
    document.getElementById('DVCliente').value = '';
    document.getElementById('CorreoCliente').value = '';
    setMunicipioPorCodigo('MunicipioClienteNombre', 'MunicipioCliente', '11001');
    document.getElementById('ReferenciaPago').value = '';
    document.getElementById('FormaPago').value = '1';
    document.getElementById('FechaVencimientoPago').value = '';
    actualizarCamposFormaPago();
    cargarNumeroFactura();
}


// DESCONTAR INSUMOS CUANDO EL PEDIDO YA SE PAGÓ

// Busca la receta de un producto con sus insumos y cantidades requeridas.
async function obtenerRecetaProducto(idProducto) {
    const resRecetas = await fetch(`${URL_CAJA}/recetas`);
    if (!resRecetas.ok) throw new Error('HTTP ' + resRecetas.status);
    const datosRecetas = await resRecetas.json();
    if (!datosRecetas.success) throw new Error(datosRecetas.message);

    const receta = datosRecetas.recetas.find(r => r.PRODUCTO_ID === idProducto);
    if (!receta) return null;

    const resDetalle = await fetch(`${URL_CAJA}/recetas/${receta.ID}`);
    if (!resDetalle.ok) throw new Error('HTTP ' + resDetalle.status);
    const datosDetalle = await resDetalle.json();
    if (!datosDetalle.success) throw new Error(datosDetalle.message);

    return {
        id_receta: receta.ID,
        insumos: datosDetalle.detalles || []
    };
}

// Resta del inventario la cantidad de un insumo consumido por la venta.
async function descontarStockInsumo(idInsumo, cantidadADescontar) {
    const resGet = await fetch(`${URL_CAJA}/insumos/${idInsumo}`);
    if (!resGet.ok) throw new Error('HTTP ' + resGet.status);
    const datosGet = await resGet.json();
    if (!datosGet.success) throw new Error(datosGet.message);

    const stockActual = parseFloat(datosGet.insumo.STOCK);
    if (stockActual < cantidadADescontar) {
        throw new Error(`Stock insuficiente para el insumo ID ${idInsumo}. Hay ${stockActual}, necesita ${cantidadADescontar}`);
    }

    const nuevoStock = stockActual - cantidadADescontar;

    const resPut = await fetch(`${URL_CAJA}/insumos/${idInsumo}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock: nuevoStock })
    });
    if (!resPut.ok) throw new Error('HTTP ' + resPut.status);
    const datosPut = await resPut.json();
    if (!datosPut.success) throw new Error(datosPut.message);
}

// Descuenta insumos según las recetas de los productos vendidos.
async function procesarDescuentoStockIndirecto(itemsCarrito) {
    for (const item of itemsCarrito) {
        const receta = await obtenerRecetaProducto(item.id);
        if (!receta) continue;

        for (const insumo of receta.insumos) {
            const cantidadTotal = parseFloat(insumo.CANTIDAD) * item.cantidad;
            await descontarStockInsumo(insumo.ID_INSUMO, cantidadTotal);
        }
    }

    return { success: true, message: 'Stock indirecto descontado correctamente' };
}


// Descuenta productos vendidos directamente desde el inventario de insumos.
async function descontarStockProductosDirectos(itemsCarrito) {
    for (const item of itemsCarrito) {
        // Busca si es producto directo (insumo con mismo nombre)
        const resInsumos = await fetch(`${URL_CAJA}/insumos`);
        if (!resInsumos.ok) continue;
        const datosInsumos = await resInsumos.json();
        if (!datosInsumos.success || !datosInsumos.insumos) continue;

        const insumoDirecto = datosInsumos.insumos.find(i => i.NOMBRE === item.nombre);
        if (!insumoDirecto) continue; // El producto no tiene un insumo directo que descontar.

        // Verifica si tiene receta (si tiene receta, ya se descontó en otro lado)
        const resRecetas = await fetch(`${URL_CAJA}/recetas`);
        if (resRecetas.ok) {
            const datosRecetas = await resRecetas.json();
            if (datosRecetas.success && datosRecetas.recetas) {
                const tieneReceta = datosRecetas.recetas.some(r => r.PRODUCTO_ID === item.id);
                if (tieneReceta) continue; // Ya se descontó por receta
            }
        }

        // Descontar stock del insumo directo
        const nuevoStock = parseFloat(insumoDirecto.STOCK) - item.cantidad;
        const resPut = await fetch(`${URL_CAJA}/insumos/${insumoDirecto.ID}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: nuevoStock })
        });
        if (!resPut.ok) throw new Error('HTTP ' + resPut.status);
        const datosPut = await resPut.json();
        if (!datosPut.success) throw new Error(datosPut.message);
    }
}



// REPORTAR 

// Envía el formulario de reporte del cajero al backend.
async function guardarReporte(e) {
    e.preventDefault();

    const descripcion = document.getElementById('rep-descripcion').value.trim();

    if (!descripcion) {
        alert('Por favor describe el reporte.');
        return;
    }

    // TODO: Conectar con backend cuando exista la tabla de reportes
    console.log('Reporte enviado:', descripcion);
    alert('✅ Reporte enviado correctamente');

    document.getElementById('form-reportar').reset();
}


// EXPONER FUNCIONES GLOBALES

window.mostrarSeccion = mostrarSeccion;
window.filtrarCategoria = filtrarCategoria;
window.agregarAlCarrito = agregarAlCarrito;
window.aumentarCantidad = aumentarCantidad;
window.disminuirCantidad = disminuirCantidad;
window.guardarReporte = guardarReporte;
window.verificarStockReceta = verificarStockReceta;
window.validarStockIndirectoCarrito = validarStockIndirectoCarrito;
