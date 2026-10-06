const express = require('express');
const router = express.Router();
const db = require('./database');

const ESTADOS_PEDIDO = new Set(['pendiente', 'preparacion', 'completado', 'cancelado']);

// Busca el ID del estado de pago pagado para no mostrar pedidos QR sin confirmar.
async function estadoPagoConfirmadoId() {
    const rows = await db.select('Estado_Pago', {
        select: 'id_EstPag',
        filters: { Estado: { operator: 'ilike', value: 'pagado' } },
        limit: 1
    });
    if (!rows[0]) throw new Error('No está registrado el estado de pago "pagado".');
    return Number(rows[0].id_EstPag);
}

// Lista pedidos con uno de los cuatro estados oficiales y excluye pagos QR sin confirmar.
router.get('/pedidos', async (_req, res) => {
    try {
        const rows = await db.select('pedido', {
            select: 'id_pedido,cli_nombre,cli_cedula,fec_creacion,id_estado,estado(nombre),empleado(nombre),detalle_pedido(id_producto,cantidad,producto(nombre))',
            order: 'fec_creacion.desc'
        });
        const orderIds = rows.map(row => row.id_pedido);
        const [payments, paidStatusId] = orderIds.length
            ? await Promise.all([
                db.select('pago', {
                    select: 'id_pedido,id_estado,metodo_pago',
                    filters: { id_pedido: orderIds }
                }),
                estadoPagoConfirmadoId()
            ])
            : [[], null];
        const paymentByOrder = new Map();
        for (const payment of payments) {
            if (!paymentByOrder.has(Number(payment.id_pedido))) paymentByOrder.set(Number(payment.id_pedido), []);
            paymentByOrder.get(Number(payment.id_pedido)).push(payment);
        }

        const pedidos = rows
            .filter(row => ESTADOS_PEDIDO.has(row.estado?.nombre))
            .filter(row => {
                const orderPayments = paymentByOrder.get(Number(row.id_pedido)) || [];
                const qrPayment = orderPayments.find(payment => payment.metodo_pago === 'factus_pay_qr');
                return !qrPayment || Number(qrPayment.id_estado) === paidStatusId;
            })
            .map(row => ({
                id: row.id_pedido,
                cliente_nombre: row.cli_nombre,
                cliente_cedula: row.cli_cedula,
                estado: row.estado?.nombre,
                fecha_creacion: row.fec_creacion,
                productos: (row.detalle_pedido || []).map(detail => ({
                    id: detail.id_producto,
                    nombre: detail.producto?.nombre,
                    cantidad: detail.cantidad
                }))
            }));

        res.json(pedidos);
    } catch (error) {
        console.error('Error al consultar pedidos de cocina:', error.message);
        res.status(error.status || 500).json({ error: 'Error al consultar pedidos de cocina.' });
    }
});

// Cambia el pedido solo por los estados permitidos.
router.put('/pedidos/:id/estado', async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body || {};
    if (!ESTADOS_PEDIDO.has(estado)) {
        return res.status(400).json({ error: 'El estado debe ser pendiente, preparacion, completado o cancelado.' });
    }

    try {
        const currentRows = await db.select('pedido', {
            select: 'id_pedido,id_estado,estado(nombre)',
            filters: { id_pedido: id },
            limit: 1
        });
        const current = currentRows[0];
        if (!current) return res.status(404).json({ error: 'Pedido no encontrado.' });

        const transiciones = {
            pendiente: ['preparacion', 'cancelado'],
            preparacion: ['completado', 'cancelado']
        };
        if (!transiciones[current.estado?.nombre]?.includes(estado)) {
            return res.status(409).json({ error: `No se puede pasar un pedido de ${current.estado?.nombre || 'estado desconocido'} a ${estado}.` });
        }

        const statusRows = await db.select('estado', {
            select: 'id_estado',
            filters: { nombre: estado },
            limit: 1
        });
        if (!statusRows[0]) {
            return res.status(500).json({ error: `Falta registrar el estado ${estado} en la tabla estado.` });
        }

        await db.update('pedido', { id_estado: statusRows[0].id_estado }, { id_pedido: id });
        res.json({ mensaje: 'Estado actualizado.', id, estado });
    } catch (error) {
        console.error('Error al actualizar estado del pedido:', error.message);
        res.status(error.status || 500).json({ error: 'Error al actualizar estado del pedido.' });
    }
});

module.exports = router;
