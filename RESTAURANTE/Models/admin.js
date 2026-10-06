const express = require('express');
const router = express.Router();
const db = require('./database');
const ID_EMPRESA_ADMIN = 7;

// Este archivo contiene operaciones exclusivas del panel de administración.
router.use((req, res, next) => {
    if (req.employee?.rol?.rol === 'admin') return next();

    return res.status(403).json({
        success: false,
        message: 'Solo administración puede usar estas operaciones.'
    });
});

// Arma el error que verá el navegador y conserva el código que responde Supabase.
function fail(res, error, message) {
    return res.status(error.status || 500).json({
        success: false,
        message: message || error.message,
        error: error.message
    });
}

// Busca una fila en la tabla indicada usando su clave (por ejemplo, id_empleado).
async function one(table, key, value, select = '*') {
    const rows = await db.select(table, {
        select,
        filters: { [key]: value },
        limit: 1
    });

    return rows[0] || null;
}

// Consulta las filas de la tabla indicada y las ordena cuando la pantalla lo necesita.
async function list(table, select = '*', order) {
    return db.select(table, {
        select,
        ...(order ? { order } : {})
    });
}

// Busca el ID de la categoría por nombre y la crea si todavía no existe.
async function categoryId(nombre) {
    if (!nombre) return null;

    let row = await one('categoria', 'nombre', nombre, 'id_categoria');

    if (!row) {
        [row] = await db.insert('categoria', { nombre });
    }

    return row.id_categoria;
}

// Busca la unidad por nombre o abreviatura y la crea si no existe.
async function unitId(nombre) {
    if (!nombre) return null;

    let row = await one('unidad_medida', 'nombre', nombre, 'id_unidad');

    if (!row) {
        row = (await db.select('unidad_medida', {
            select: 'id_unidad,nombre,abreviatura',
            filters: { abreviatura: nombre },
            limit: 1
        }))[0];
    }

    if (!row) {
        [row] = await db.insert('unidad_medida', {
            nombre,
            abreviatura: nombre.slice(0, 10)
        });
    }

    return row.id_unidad;
}

// Usa solamente los roles permitidos para empleados: cocina es ID 2 y caja es ID 3.
async function employeeRoleId(value) {
    const input = String(value ?? '').trim().toLowerCase();
    const roleById = { '2': 'cocina', '3': 'caja' };
    const idByRole = { cocina: 2, caja: 3 };
    const id = roleById[input] ? Number(input) : idByRole[input];

    if (!id) {
        const error = new Error('El rol del empleado debe ser Caja o Cocina.');
        error.status = 400;
        throw error;
    }

    const row = await one('rol', 'id_rol', id, 'id_rol,rol');
    if (!row || String(row.rol).toLowerCase() !== roleById[String(id)]) {
        const error = new Error(`El rol con ID ${id} no está configurado correctamente en la tabla rol.`);
        error.status = 400;
        throw error;
    }

    return id;
}

// Prepara el ID, la cédula, el correo, la contraseña, el rol y el teléfono para la tabla de empleados.
function employeeView(row) {
    return {
        ID: row.id_empleado,
        NOMBRE: row.nombre,
        CEDULA: row.cedula,
        CORREO: row.correo,
        CONTRASENA: row.password,
        TELEFONO: row.telefono,
        ID_ROL: row.id_rol,
        ROL: row.rol?.rol || ''
    };
}

// Prepara el ID, el nombre, el correo y el teléfono para la tabla de proveedores.
function supplierView(row) {
    return {
        ID: row.id_proveedor,
        NOMBRE: row.nombre,
        CORREO: row.correo,
        TELEFONO: row.telefono
    };
}

// Prepara el nombre, el precio, la categoría y la descripción para el menú y el panel de productos.
function productView(row) {
    return {
        ID: row.id_producto,
        NOMBRE: row.nombre,
        PRECIO: row.precio,
        CATEGORIA: row.categoria?.nombre || '',
        ID_CATEGORIA: row.id_categoria,
        DESCRIPCION: row.descripcion,
        FOTO: row.url_foto,
        URL_FOTO: row.url_foto
    };
}

// Prepara el nombre, la unidad, el stock, el vencimiento y el proveedor para la tabla de inventario.
function ingredientView(row) {
    return {
        ID: row.id_insumo,
        NOMBRE: row.nombre,
        UNIDAD: row.unidad_medida?.abreviatura || row.unidad_medida?.nombre || '',
        STOCK: row.stock,
        FECHA_VENCIMIENTO: row.fec_vencimiento,
        ID_PROVEEDOR: row.id_proveedor,
        PROVEEDOR: row.proveedor?.nombre || '',
        COSTO_COMPRA: row.costo,
        COSTO: row.costo,
        ID_UNIDAD: row.id_unidad
    };
}

// Prepara el número, el pedido, el total y la fecha de emisión para la tabla de facturas.
function invoiceView(row) {
    return {
        ID_FACTURA: row.id_factura,
        ID_PEDIDO: row.id_pedido,
        TOTAL: row.total,
        // La tabla del panel todavía espera este nombre para el subtotal.
        SUBTOTAL: row.total,
        FECHA_EMISION: row.fec_creacion
    };
}

// Consulta pedidos, pagos, insumos y detalles para calcular los indicadores del panel.
async function dashboardData() {
    const [pedidos, pagos, insumos, detalles, productos] = await Promise.all([
        db.select('pedido', {
            select: 'id_pedido,fec_creacion,id_estado'
        }),
        db.select('pago', {
            select: 'monto,fecha_creacion,id_estado',
            filters: { id_estado: 1 }
        }),
        db.select('insumo', {
            select: 'stock,costo'
        }),
        db.select('detalle_pedido', {
            select: 'id_producto,cantidad'
        }),
        db.select('producto', {
            select: 'id_producto,nombre'
        })
    ]);

    return { pedidos, pagos, insumos, detalles, productos };
}

// Convierte una fecha a AAAA-MM-DD según el horario de Bogotá.
function fechaEnBogota(fecha) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(fecha));
}

// Devuelve la fecha actual del restaurante en horario de Bogotá.
function fechaHoyBogota() {
    return fechaEnBogota(new Date());
}


// ESTADÍSTICAS

// Cuenta los pedidos completados hoy según id_estado = 3 ().
router.get('/estadisticas/pedidos-hoy', async (_req, res) => {
    try {
        const { pedidos } = await dashboardData();
        const hoy = fechaHoyBogota();

        const total = pedidos.filter(p =>
            Number(p.id_estado) === 3 &&
            p.fec_creacion && fechaEnBogota(p.fec_creacion) === hoy
        ).length;

        res.json({ success: true, total });
    } catch (error) {
        fail(res, error, 'Error al consultar pedidos');
    }
});

// Suma los pagos de hoy cuyo estado es 1 (pagado).
router.get('/estadisticas/ventas-hoy', async (_req, res) => {
    try {
        const { pagos } = await dashboardData();
        const hoy = fechaHoyBogota();

        const total = pagos
            .filter(p => p.fecha_creacion && fechaEnBogota(p.fecha_creacion) === hoy)
            .reduce((sum, p) => sum + Number(p.monto), 0);

        res.json({ success: true, total });
    } catch (error) {
        fail(res, error, 'Error al consultar ventas');
    }
});

// Suma las cantidades de detalle_pedido y devuelve el producto más vendido.
router.get('/estadisticas/mas-vendido', async (_req, res) => {
    try {
        const { detalles, productos } = await dashboardData();
        const ventas = new Map();

        for (const detalle of detalles) {
            ventas.set(
                detalle.id_producto,
                (ventas.get(detalle.id_producto) || 0) + Number(detalle.cantidad)
            );
        }

        productos.sort(
            (a, b) =>
                (ventas.get(b.id_producto) || 0) -
                (ventas.get(a.id_producto) || 0)
        );

        const primero = productos[0];

        res.json({
            success: true,
            nombre: primero && ventas.has(primero.id_producto)
                ? primero.nombre
                : '-'
        });
    } catch (error) {
        fail(res, error, 'Error al consultar más vendido');
    }
});

// Suma el valor del inventario: stock de cada insumo por su costo unitario.
router.get('/estadisticas/gastos', async (_req, res) => {
    try {
        const { insumos } = await dashboardData();
        const total = insumos.reduce(
            (sum, i) => sum + Number(i.stock) * Number(i.costo),
            0
        );

        res.json({ success: true, total });
    } catch (error) {
        fail(res, error, 'Error al consultar gastos');
    }
});

// Suma todos los pagos confirmados con id_estado = 1.
router.get('/estadisticas/ingresos', async (_req, res) => {
    try {
        const { pagos } = await dashboardData();
        const total = pagos.reduce((sum, p) => sum + Number(p.monto), 0);

        res.json({ success: true, total });
    } catch (error) {
        fail(res, error, 'Error al consultar ingresos');
    }
});

// Calcula la ganancia restando los costos del inventario a los pagos confirmados.
router.get('/estadisticas/ganancias', async (_req, res) => {
    try {
        const { pagos, insumos } = await dashboardData();

        const ingresos = pagos.reduce(
            (sum, p) => sum + Number(p.monto),
            0
        );

        const gastos = insumos.reduce(
            (sum, i) => sum + Number(i.stock) * Number(i.costo),
            0
        );

        res.json({ success: true, total: ingresos - gastos });
    } catch (error) {
        fail(res, error, 'Error al consultar ganancias');
    }
});


// EMPLEADOS

// Crear: registra la cuenta de acceso y guarda cédula, contraseña y datos del empleado.
router.post('/empleados', async (req, res) => {
    const { nombre, cedula, correo, telefono, password, rol = 'caja' } = req.body || {};

    if (!nombre?.trim() || !cedula?.trim() || !correo?.trim() || !telefono?.trim() || !password || !rol) {
        return res.status(400).json({
            success: false,
            message: 'Nombre, rol, cédula, teléfono, correo y contraseña son obligatorios.'
        });
    }

    let authUser;

    try {
        const empresa = await one('empresa', 'id_empresa', ID_EMPRESA_ADMIN, 'id_empresa');
        if (!empresa) {
            return res.status(400).json({
                success: false,
                message: `No existe la empresa con ID ${ID_EMPRESA_ADMIN}.`
            });
        }

        // Crea primero la cuenta de acceso para que el empleado pueda iniciar sesión.
        authUser = await db.auth.createUser(correo, password, { nombre });

        // Guarda los datos personales y la contraseña que muestra el panel en empleado.
        const [empleado] = await db.insert('empleado', {
            id_auth: authUser.id,
            id_empresa: ID_EMPRESA_ADMIN,
            cedula: String(cedula).trim(),
            password,
            activo: true,
            nombre,
            correo,
            telefono: telefono || null,
            id_rol: await employeeRoleId(rol)
        });

        res.status(201).json({
            success: true,
            message: 'Empleado creado correctamente',
            id: empleado.id_empleado
        });

    } catch (error) {
        
        // Si falla el perfil, borra la cuenta Auth que acabamos de crear.
        if (authUser?.id) {
            await db.auth.deleteUser(authUser.id).catch(() => {});
        }

        fail(res, error, `Error al guardar empleado: ${error.message}`);
    }
});

// Consultar por ID: carga los datos y la contraseña del empleado seleccionado.
router.get('/empleados/:id', async (req, res) => {
    try {
        const row = await one(
            'empleado',
            'id_empleado',
            req.params.id,
            '*,rol(rol)'
        );

        if (!row || Number(row.id_empresa) !== ID_EMPRESA_ADMIN || !row.activo) {
            return res.status(404).json({
                success: false,
                message: 'Empleado no encontrado'
            });
        }

        res.json({
            success: true,
            empleado: employeeView(row)
        });
    } catch (error) {
        fail(res, error, 'Error al buscar empleado');
    }
});

// Editar: actualiza los datos personales y sincroniza correo o contraseña con Supabase Auth.
router.put('/empleados/:id', async (req, res) => {
    try {
        const current = await one(
            'empleado',
            'id_empleado',
            req.params.id
        );

        if (!current || Number(current.id_empresa) !== ID_EMPRESA_ADMIN || !current.activo) {
            return res.status(404).json({
                success: false,
                message: 'Empleado no encontrado'
            });
        }

        const changes = {};

        if (req.body.cedula !== undefined) {
            changes.cedula = String(req.body.cedula).trim();
        }

        if (req.body.nombre !== undefined) {
            changes.nombre = req.body.nombre;
        }

        if (req.body.correo !== undefined) {
            changes.correo = req.body.correo || null;
        }

        if (req.body.telefono !== undefined) {
            changes.telefono = req.body.telefono || null;
        }

        if (req.body.password) {
            changes.password = req.body.password;
        }

        if (req.body.rol) {
            changes.id_rol = await employeeRoleId(req.body.rol);
        }

        // Solo cambia los datos de acceso si el correo o la contraseña sí cambiaron.
        const correoNuevo = req.body.correo?.trim();
        const cambioCorreo = Boolean(
            correoNuevo && correoNuevo.toLowerCase() !== String(current.correo || '').toLowerCase()
        );
        const cambioPassword = Boolean(req.body.password);

        if (cambioCorreo || cambioPassword) {
            let idAuth = current.id_auth;

            // Algunos empleados antiguos no guardaron id_auth; busca su cuenta por el correo actual.
            if (!idAuth && current.correo) {
                const cuenta = await db.auth.findUserByEmail(current.correo);
                idAuth = cuenta?.id || null;
            }

            const correoAcceso = correoNuevo || current.correo;
            const passwordAcceso = req.body.password || current.password;

            if (!idAuth && correoAcceso && passwordAcceso) {
                const cuenta = await db.auth.createUser(
                    correoAcceso,
                    passwordAcceso,
                    { nombre: req.body.nombre || current.nombre }
                );
                idAuth = cuenta.id;
            } else if (idAuth) {
                const authChanges = {};
                if (cambioCorreo) authChanges.email = correoNuevo;
                if (cambioPassword) authChanges.password = req.body.password;
                if (Object.keys(authChanges).length) {
                    await db.auth.updateUser(idAuth, authChanges);
                }
            } else {
                return res.status(409).json({
                    success: false,
                    message: 'No se pudo vincular la cuenta: revisa el correo y la contraseña guardados del empleado.'
                });
            }

            if (!current.id_auth && idAuth) changes.id_auth = idAuth;
        }

        if (Object.keys(changes).length) {
            const rows = await db.update(
                'empleado',
                changes,
                { id_empleado: req.params.id }
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: 'Empleado no encontrado'
                });
            }
        }

        if (!Object.keys(changes).length && !req.body.password) {
            return res.status(400).json({
                success: false,
                message: 'No hay campos para actualizar'
            });
        }

        res.json({
            success: true,
            message: 'Empleado actualizado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al actualizar empleado: ${error.message}`);
    }
});

// Eliminar: borra al empleado de esta empresa y su cuenta si no tiene pedidos asociados.
router.delete('/empleados/:id', async (req, res) => {
    try {
        const row = await one(
            'empleado',
            'id_empleado',
            req.params.id,
            '*,rol(rol)'
        );

        if (!row || Number(row.id_empresa) !== ID_EMPRESA_ADMIN || !row.activo) {
            return res.status(404).json({
                success: false,
                message: 'Empleado no encontrado'
            });
        }

        const rolEmpleado = String(row.rol?.rol || '').trim().toLowerCase();
        if (
            ['admin', 'administrador'].includes(rolEmpleado) ||
            Number(row.id_empleado) === Number(req.employee?.id_empleado) ||
            row.id_auth === req.authUser?.id
        ) {
            return res.status(403).json({
                success: false,
                message: 'No se puede eliminar un administrador'
            });
        }

        // Si el empleado tiene pedidos, la base de datos no permite borrarlo.
        const pedidos = await db.select('pedido', {
            select: 'id_pedido',
            filters: { id_empleado: req.params.id },
            limit: 1
        });

        if (pedidos.length) {
            return res.status(409).json({
                success: false,
                message: 'No se puede eliminar: el empleado tiene pedidos asociados.'
            });
        }

        let authUserId = row.id_auth;
        if (!authUserId && row.correo) {
            const cuenta = await db.auth.findUserByEmail(row.correo);
            authUserId = cuenta?.id || null;
        }

        const deleted = await db.delete('empleado', {
            id_empleado: req.params.id
        });

        if (!deleted.length) {
            return res.status(404).json({
                success: false,
                message: 'Empleado no encontrado'
            });
        }

        if (authUserId) {
            await db.auth.deleteUser(authUserId);
        }

        res.json({
            success: true,
            message: 'Empleado eliminado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al eliminar empleado: ${error.message}`);
    }
});

// Consultar: lista ID, nombre, cédula, correo, contraseña, rol y teléfono de cada empleado activo.
router.get('/empleados', async (_req, res) => {
    try {
        const rows = await db.select('empleado', {
            select: '*,rol(rol)',
            filters: { id_empresa: ID_EMPRESA_ADMIN, activo: true },
            order: 'id_empleado.asc'
        });

        res.json({
            success: true,
            empleados: rows.map(employeeView)
        });
    } catch (error) {
        fail(res, error, 'Error al consultar empleados');
    }
});


// PROVEEDORES

// Crear: guarda nombre, correo y teléfono del proveedor.
router.post('/proveedores', async (req, res) => {
    try {
        if (!req.body.nombre?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'El nombre del proveedor es obligatorio.'
            });
        }

        const [row] = await db.insert('proveedor', {
            nombre: req.body.nombre.trim(),
            correo: req.body.correo || null,
            telefono: req.body.telefono || null
        });

        res.status(201).json({
            success: true,
            message: 'Proveedor creado correctamente',
            id: row.id_proveedor
        });
    } catch (error) {
        fail(res, error, `Error al guardar proveedor: ${error.message}`);
    }
});

// Consultar por ID: carga los datos del proveedor para el formulario de edición.
router.get('/proveedores/:id', async (req, res) => {
    try {
        const row = await one('proveedor', 'id_proveedor', req.params.id);

        if (!row) {
            return res.status(404).json({
                success: false,
                message: 'Proveedor no encontrado'
            });
        }

        res.json({ success: true, proveedor: supplierView(row) });
    } catch (error) {
        fail(res, error, 'Error al buscar proveedor');
    }
});

// Editar: actualiza los datos de contacto del proveedor seleccionado.
router.put('/proveedores/:id', async (req, res) => {
    try {
        const changes = {};

        for (const field of ['nombre', 'correo', 'telefono']) {
            if (req.body[field] !== undefined) {
                changes[field] = req.body[field] || null;
            }
        }

        if (!Object.keys(changes).length) {
            return res.status(400).json({
                success: false,
                message: 'No hay campos para actualizar.'
            });
        }

        const rows = await db.update(
            'proveedor',
            changes,
            { id_proveedor: req.params.id }
        );

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Proveedor no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Proveedor actualizado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al actualizar proveedor: ${error.message}`);
    }
});

// Eliminar: borra el proveedor seleccionado si la base de datos no tiene insumos asociados.
router.delete('/proveedores/:id', async (req, res) => {
    try {
        const rows = await db.delete('proveedor', {
            id_proveedor: req.params.id
        });

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Proveedor no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Proveedor eliminado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al eliminar proveedor: ${error.message}`);
    }
});

// Consultar: lista el ID, nombre, correo y teléfono de cada proveedor.
router.get('/proveedores', async (_req, res) => {
    try {
        const rows = await list('proveedor', '*', 'id_proveedor.asc');

        res.json({
            success: true,
            proveedores: rows.map(supplierView)
        });
    } catch (error) {
        fail(res, error, 'Error al consultar proveedores');
    }
});


// INSUMOS

// Crear: guarda el insumo con unidad, stock, vencimiento, costo y proveedor.
router.post('/insumos', async (req, res) => {
    const body = req.body || {};

    try {
        if (!body.nombre?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'El nombre del insumo es obligatorio.'
            });
        }

        // Si faltan estos IDs, los buscamos o creamos más abajo.
        const idProveedor = body.id_proveedor
            ? Number(body.id_proveedor)
            : null;

        if (idProveedor) {
            const supplier = await one(
                'proveedor',
                'id_proveedor',
                idProveedor
            );

            if (!supplier) {
                return res.status(400).json({
                    success: false,
                    message: 'El proveedor seleccionado no existe.'
                });
            }
        }

        const idUnidad = body.unidad
            ? await unitId(body.unidad.trim())
            : (body.id_unidad ? Number(body.id_unidad) : null);

        const [row] = await db.insert('insumo', {
            nombre: body.nombre.trim(),
            stock: Number(body.stock) || 0,
            fec_vencimiento: body.fecha_vencimiento || null,
            costo: Number(body.costo_compra ?? body.costo) || 0,
            id_proveedor: idProveedor,
            id_unidad: idUnidad
        });

        // El mismo insumo también se puede vender como producto.
        if (body.es_producto_directo) {
            const idCategoria = await categoryId(body.categoria || 'General');

            await db.insert('producto', {
                nombre: body.nombre.trim(),
                precio: Number(body.precio) || 0,
                descripcion: body.descripcion || null,
                url_foto: body.foto || null,
                id_categoria: idCategoria
            });
        }

        res.status(201).json({
            success: true,
            message: body.es_producto_directo
                ? 'Insumo y producto directo creados'
                : 'Insumo creado correctamente',
            id: row.id_insumo
        });
    } catch (error) {
        fail(res, error, `Error al guardar insumo: ${error.message}`);
    }
});

// Consultar por ID: carga los datos del insumo para el formulario de edición.
router.get('/insumos/:id', async (req, res) => {
    try {
        const row = await one(
            'insumo',
            'id_insumo',
            req.params.id,
            '*,proveedor(nombre),unidad_medida(nombre,abreviatura)'
        );

        if (!row) {
            return res.status(404).json({
                success: false,
                message: 'Insumo no encontrado'
            });
        }

        res.json({ success: true, insumo: ingredientView(row) });
    } catch (error) {
        fail(res, error, 'Error al buscar insumo');
    }
});

// Editar: actualiza los datos del insumo y su producto directo cuando aplica.
router.put('/insumos/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const changes = {};

        if (body.nombre !== undefined) changes.nombre = body.nombre;
        if (body.stock !== undefined) changes.stock = Number(body.stock);

        if (body.fecha_vencimiento !== undefined) {
            changes.fec_vencimiento = body.fecha_vencimiento || null;
        }

        if (body.costo_compra !== undefined || body.costo !== undefined) {
            changes.costo = Number(body.costo_compra ?? body.costo);
        }

        if (body.id_proveedor !== undefined) {
            changes.id_proveedor = body.id_proveedor
                ? Number(body.id_proveedor)
                : null;
        }

        if (body.unidad !== undefined) {
            changes.id_unidad = body.unidad
                ? await unitId(body.unidad.trim())
                : null;
        } else if (body.id_unidad !== undefined) {
            changes.id_unidad = body.id_unidad
                ? Number(body.id_unidad)
                : null;
        }

        if (!Object.keys(changes).length) {
            return res.status(400).json({
                success: false,
                message: 'No hay campos para actualizar.'
            });
        }

        const rows = await db.update(
            'insumo',
            changes,
            { id_insumo: req.params.id }
        );

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Insumo no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Insumo actualizado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al actualizar insumo: ${error.message}`);
    }
});

// Eliminar: borra el insumo seleccionado si ninguna receta lo está usando.
router.delete('/insumos/:id', async (req, res) => {
    try {
        const rows = await db.delete('insumo', {
            id_insumo: req.params.id
        });

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Insumo no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Insumo eliminado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al eliminar insumo: ${error.message}`);
    }
});

// Consultar: lista ID, nombre, unidad, stock, fecha de vencimiento y proveedor de cada insumo.
router.get('/insumos', async (_req, res) => {
    try {
        const rows = await list(
            'insumo',
            '*,proveedor(nombre),unidad_medida(nombre,abreviatura)',
            'id_insumo.asc'
        );

        res.json({
            success: true,
            insumos: rows.map(ingredientView)
        });
    } catch (error) {
        fail(res, error, 'Error al consultar insumos');
    }
});


// PRODUCTOS

// Crear: guarda nombre, precio y descripción y busca o crea la categoría.
router.post('/productos', async (req, res) => {
    try {
        const body = req.body || {};

        if (!body.nombre?.trim() || !Number.isFinite(Number(body.precio))) {
            return res.status(400).json({
                success: false,
                message: 'Nombre y precio válido son obligatorios.'
            });
        }

        const idCategoria = await categoryId(body.categoria || 'General');

        const [row] = await db.insert('producto', {
            nombre: body.nombre.trim(),
            precio: Number(body.precio),
            descripcion: body.descripcion || null,
            url_foto: body.foto || body.url_foto || null,
            id_categoria: idCategoria
        });

        res.status(201).json({
            success: true,
            message: 'Producto creado correctamente',
            id: row.id_producto
        });
    } catch (error) {
        fail(res, error, `Error al guardar producto: ${error.message}`);
    }
});

// Consultar por ID: carga los datos del producto para el formulario de edición.
router.get('/productos/:id', async (req, res) => {
    try {
        const row = await one(
            'producto',
            'id_producto',
            req.params.id,
            '*,categoria(nombre)'
        );

        if (!row) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        res.json({ success: true, producto: productView(row) });
    } catch (error) {
        fail(res, error, 'Error al buscar producto');
    }
});

// Editar: actualiza nombre, precio, categoría, foto y descripción del producto.
router.put('/productos/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const changes = {};

        if (body.nombre !== undefined) changes.nombre = body.nombre;
        if (body.precio !== undefined) changes.precio = Number(body.precio);
        if (body.descripcion !== undefined) changes.descripcion = body.descripcion || null;

        if (body.foto !== undefined || body.url_foto !== undefined) {
            changes.url_foto = body.foto || body.url_foto || null;
        }

        if (body.categoria !== undefined) {
            changes.id_categoria = body.categoria
                ? await categoryId(body.categoria)
                : null;
        }

        if (!Object.keys(changes).length) {
            return res.status(400).json({
                success: false,
                message: 'No hay campos para actualizar.'
            });
        }

        const rows = await db.update(
            'producto',
            changes,
            { id_producto: req.params.id }
        );

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Producto actualizado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al actualizar producto: ${error.message}`);
    }
});

// Eliminar: borra el producto seleccionado si no aparece en pedidos ni recetas.
router.delete('/productos/:id', async (req, res) => {
    try {
        const rows = await db.delete('producto', {
            id_producto: req.params.id
        });

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Producto eliminado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al eliminar producto: ${error.message}`);
    }
});

// Consultar: lista ID, nombre, precio, categoría y descripción de los productos del menú.
router.get('/productos', async (_req, res) => {
    try {
        const rows = await list(
            'producto',
            '*,categoria(nombre)',
            'id_producto.asc'
        );

        res.json({
            success: true,
            productos: rows.map(productView)
        });
    } catch (error) {
        fail(res, error, 'Error al consultar productos');
    }
});


// RECETAS

// Crear: guarda el nombre, producto, descripción y los insumos usados por la receta.
router.post('/recetas', async (req, res) => {
    let receta;

    try {
        const body = req.body || {};

        if (!body.nombre || !body.id_producto) {
            return res.status(400).json({
                success: false,
                message: 'Nombre e ID de producto son obligatorios.'
            });
        }

        [receta] = await db.insert('receta', {
            nombre: body.nombre,
            descripcion: body.descripcion || null,
            id_producto: Number(body.id_producto)
        });

        if (Array.isArray(body.insumos) && body.insumos.length) {
            await db.insert(
                'detalle_receta',
                body.insumos.map(item => ({
                    id_receta: receta.id_receta,
                    id_insumo: Number(item.id_insumo),
                    cantidad: Number(item.cantidad)
                }))
            );
        }

        res.status(201).json({
            success: true,
            message: 'Receta creada correctamente',
            id: receta.id_receta
        });
    } catch (error) {
        if (receta?.id_receta) {
            await db.delete('receta', {
                id_receta: receta.id_receta
            }).catch(() => {});
        }

        fail(res, error, `Error al crear receta: ${error.message}`);
    }
});

// Consultar por ID: carga el producto y las cantidades de insumos de la receta.
router.get('/recetas/:id', async (req, res) => {
    try {
        const receta = await one(
            'receta',
            'id_receta',
            req.params.id,
            '*,producto(nombre)'
        );

        if (!receta) {
            return res.status(404).json({
                success: false,
                message: 'Receta no encontrada'
            });
        }

        const rows = await db.select('detalle_receta', {
            select: 'id_insumo,cantidad,insumo(nombre,unidad_medida(nombre,abreviatura))',
            filters: { id_receta: req.params.id }
        });

        res.json({
            success: true,
            receta: {
                ID: receta.id_receta,
                NOMBRE: receta.nombre,
                DESCRIPCION: receta.descripcion,
                ID_PRODUCTO: receta.id_producto,
                PRODUCTO_NOMBRE: receta.producto?.nombre
            },
            detalles: rows.map(row => ({
                ID_INSUMO: row.id_insumo,
                CANTIDAD: row.cantidad,
                INSUMO_NOMBRE: row.insumo?.nombre,
                INSUMO_UNIDAD:
                    row.insumo?.unidad_medida?.abreviatura ||
                    row.insumo?.unidad_medida?.nombre ||
                    ''
            }))
        });
    } catch (error) {
        fail(res, error, 'Error al buscar receta');
    }
});

// Editar: actualiza la receta y reemplaza la lista de insumos asociados.
router.put('/recetas/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const changes = {};

        for (const field of ['nombre', 'descripcion']) {
            if (body[field] !== undefined) {
                changes[field] = body[field] || null;
            }
        }

        if (body.id_producto !== undefined) {
            changes.id_producto = body.id_producto
                ? Number(body.id_producto)
                : null;
        }

        if (Object.keys(changes).length) {
            const rows = await db.update(
                'receta',
                changes,
                { id_receta: req.params.id }
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: 'Receta no encontrada'
                });
            }
        }

        if (Array.isArray(body.insumos)) {
            await db.delete('detalle_receta', {
                id_receta: req.params.id
            });

            if (body.insumos.length) {
                await db.insert(
                    'detalle_receta',
                    body.insumos.map(item => ({
                        id_receta: Number(req.params.id),
                        id_insumo: Number(item.id_insumo),
                        cantidad: Number(item.cantidad)
                    }))
                );
            }
        }

        if (!Object.keys(changes).length && !Array.isArray(body.insumos)) {
            return res.status(400).json({
                success: false,
                message: 'No hay campos para actualizar.'
            });
        }

        res.json({
            success: true,
            message: 'Receta actualizada correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al actualizar receta: ${error.message}`);
    }
});

// Eliminar: borra la receta y sus relaciones con insumos.
router.delete('/recetas/:id', async (req, res) => {
    try {
        const receta = await one(
            'receta',
            'id_receta',
            req.params.id,
            'id_receta'
        );

        if (!receta) {
            return res.status(404).json({
                success: false,
                message: 'Receta no encontrada'
            });
        }

        await db.delete('detalle_receta', {
            id_receta: req.params.id
        });

        await db.delete('receta', {
            id_receta: req.params.id
        });

        res.json({
            success: true,
            message: 'Receta eliminada correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al eliminar receta: ${error.message}`);
    }
});

// Consultar: lista ID, nombre, producto asociado y descripción de cada receta.
router.get('/recetas', async (_req, res) => {
    try {
        const rows = await db.select('receta', {
            select: '*,producto(id_producto,nombre,precio,url_foto,categoria(nombre))',
            order: 'id_receta.asc'
        });

        const recetas = rows.map(row => ({
            ID: row.id_receta,
            NOMBRE: row.nombre,
            DESCRIPCION: row.descripcion,
            PRODUCTO_ID: row.producto?.id_producto,
            PRODUCTO_NOMBRE: row.producto?.nombre,
            PRODUCTO_PRECIO: row.producto?.precio,
            PRODUCTO_CATEGORIA: row.producto?.categoria?.nombre || '',
            PRODUCTO_FOTO: row.producto?.url_foto
        }));

        res.json({ success: true, recetas });
    } catch (error) {
        fail(res, error, 'Error al consultar recetas');
    }
});


// FACTURAS

// Consultar: lista las facturas (id, total, feha y opcion de ver pdf) y permite limitar el resultado a una fecha.
router.get('/facturas', async (req, res) => {
    try {
        let rows = await db.select('factura', {
            select: '*',
            order: 'fec_creacion.desc'
        });

        if (req.query.fecha) {
            rows = rows.filter(row =>
                row.fec_creacion?.slice(0, 10) === req.query.fecha
            );
        }

        res.json({
            success: true,
            facturas: rows.map(invoiceView)
        });
    } catch (error) {
        fail(res, error, 'Error al consultar facturas');
    }
});


module.exports = router;
