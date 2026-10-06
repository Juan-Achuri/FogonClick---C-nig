const express = require('express');
const router = express.Router();
const db = require('./database');
const nodemailer = require('nodemailer');
const fs = require('fs/promises');
const path = require('path');

// ============================================
// CONFIGURACIÓN DE FACTUS PAY Y FACTURACIÓN
// ============================================

const FACTUS_PAY_BASE_URL = (
    process.env.FACTUS_PAY_BASE_URL ||
    'https://pay-api-sandbox.factus.com.co'
).replace(/\/$/, '');

const TEST_PRODUCTS = new Map([
    [990001, { nombre: 'GASEOSA · COPIA DE PRUEBA', precio: 2000 }],
    [990002, { nombre: 'PERRO CALIENTE · COPIA DE PRUEBA', precio: 10000 }]
]);

const TEST_MODE = FACTUS_PAY_BASE_URL.includes(
    'pay-api-sandbox.factus.com.co'
);
const ORDER_STATUSES = new Set(['pendiente', 'preparacion', 'completado', 'cancelado']);
// El pedido queda pendiente de pago como máximo diez minutos después de crear el QR.
const FACTUS_PAY_QR_TTL_MS = 10 * 60 * 1000;
const FACTUS_PAY_EXPIRATION_CHECK_MS = 60 * 1000;

let factusPayToken;
let factusPayAuthPromise = null;

const FACTUS_BILLING_BASE_URL = (
    process.env.FACTUS_BASE_URL || 'https://api-sandbox.factus.com.co'
).replace(/\/$/, '');
let factusBillingAccessToken;
let factusBillingRefreshToken;
let factusBillingTokenExpiresAt = 0;
let factusBillingAuthPromise = null;

// Obtiene y conserva el token de Factus Pay, renovándolo cuando se fuerza el refresco.
async function getFactusPayToken({ forceRefresh = false } = {}) {
    // Factus Pay indica que sus tokens no vencen por tiempo. Se reutiliza
    // el token y solo se rota cuando la API responde 401.
    if (!forceRefresh && factusPayToken) return factusPayToken;

    if (factusPayAuthPromise) return factusPayAuthPromise;

    const { FACTUS_PAY_EMAIL, FACTUS_PAY_PASSWORD } = process.env;

    if (!FACTUS_PAY_EMAIL || !FACTUS_PAY_PASSWORD) {
        throw new Error(
            'Configura FACTUS_PAY_EMAIL y FACTUS_PAY_PASSWORD en .env'
        );
    }

    factusPayAuthPromise = (async () => {
        const response = await fetch(`${FACTUS_PAY_BASE_URL}/auth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({
                email: FACTUS_PAY_EMAIL,
                password: FACTUS_PAY_PASSWORD
            })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.token) {
            const error = new Error(
                response.status === 401 || response.status === 403
                    ? 'Factus Pay rechazó el email o la contraseña configurados en .env.'
                    : (result.message || `Factus Pay rechazó la autenticación (HTTP ${response.status})`)
            );
            error.status = response.status;
            throw error;
        }

        factusPayToken = result.token;
        return factusPayToken;
    })();

    try {
        return await factusPayAuthPromise;
    } finally {
        factusPayAuthPromise = null;
    }
}

// Ejecuta una solicitud a Factus Pay y reintenta una vez si el token expiró.
async function factusPayRequest(path, options = {}, retriedAfterRefresh = false) {
    const token = await getFactusPayToken();

    const response = await fetch(`${FACTUS_PAY_BASE_URL}${path}`, {
        ...options,
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
            ...options.headers
        }
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 401 && !retriedAfterRefresh) {
        factusPayToken = null;
        await getFactusPayToken({ forceRefresh: true });
        return factusPayRequest(path, options, true);
    }

    if (!response.ok) {
        const error = new Error(
            result.message ||
            `Factus Pay respondió HTTP ${response.status}`
        );

        error.status = response.status;
        throw error;
    }

    return result;
}

// ───────── Desde aquí: integración de Factus Facturación ─────────
// Reúne y valida las credenciales OAuth de Factus Facturación.
function billingCredentials() {
    const { FACTUS_CLIENT_ID, FACTUS_CLIENT_SECRET, FACTUS_USERNAME, FACTUS_PASSWORD } = process.env;
    if (!FACTUS_CLIENT_ID || !FACTUS_CLIENT_SECRET || !FACTUS_USERNAME || !FACTUS_PASSWORD) {
        throw new Error('Faltan FACTUS_CLIENT_ID, FACTUS_CLIENT_SECRET, FACTUS_USERNAME o FACTUS_PASSWORD en .env.');
    }
    return { FACTUS_CLIENT_ID, FACTUS_CLIENT_SECRET, FACTUS_USERNAME, FACTUS_PASSWORD };
}

// Solicita a Factus el token OAuth inicial o lo renueva usando el refresh token.
async function requestFactusBillingToken(grantType = 'password') {
    const credentials = billingCredentials();
    const form = new URLSearchParams({
        grant_type: grantType,
        client_id: credentials.FACTUS_CLIENT_ID,
        client_secret: credentials.FACTUS_CLIENT_SECRET
    });
    if (grantType === 'password') {
        form.set('username', credentials.FACTUS_USERNAME);
        form.set('password', credentials.FACTUS_PASSWORD);
    } else {
        form.set('refresh_token', factusBillingRefreshToken);
    }

    const response = await fetch(`${FACTUS_BILLING_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
        const detail = result.message || result.error_description || result.error;
        const error = new Error(detail || `Factus Facturación respondió HTTP ${response.status} al autenticar.`);
        error.status = response.status;
        throw error;
    }

    factusBillingAccessToken = result.access_token;
    factusBillingRefreshToken = result.refresh_token || factusBillingRefreshToken;
    factusBillingTokenExpiresAt = Date.now() + (Number(result.expires_in) || 3600) * 1000;
    return factusBillingAccessToken;
}

// Reutiliza el access token mientras sirve, lo renueva al vencer y vuelve a autenticar si el refresh token ya no sirve.
async function getFactusBillingToken(forceRefresh = false) {
    if (!forceRefresh && factusBillingAccessToken && Date.now() < factusBillingTokenExpiresAt - 60000) {
        return factusBillingAccessToken;
    }
    if (factusBillingAuthPromise) return factusBillingAuthPromise;

    factusBillingAuthPromise = (async () => {
        if (factusBillingRefreshToken) {
            try {
                return await requestFactusBillingToken('refresh_token');
            } catch (error) {
                if (![400, 401, 403].includes(error.status)) throw error;
                factusBillingRefreshToken = null;
            }
        }
        return requestFactusBillingToken('password');
    })();

    try {
        return await factusBillingAuthPromise;
    } finally {
        factusBillingAuthPromise = null;
    }
}

// Envía operaciones POST de facturación electrónica y renueva el token ante 401.
async function factusBillingRequest(path, body, retry = true) {
    const token = await getFactusBillingToken();
    const response = await fetch(`${FACTUS_BILLING_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 && retry) {
        factusBillingAccessToken = null;
        factusBillingTokenExpiresAt = 0;
        await getFactusBillingToken(true);
        return factusBillingRequest(path, body, false);
    }
    if (!response.ok) {
        const errors = formatFactusValidationErrors(
            result.errors || result.data?.errors || result.validation_errors || result.data?.validation_errors
        );
        const providerMessage = result.message || result.data?.message || result.error_description || result.error;
        const message = [providerMessage, errors && !String(providerMessage || '').includes(errors) ? errors : '']
            .filter(Boolean)
            .join(': ');
        const error = new Error(message || `Factus Facturación respondió HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
    }
    return result;
}

// Elimina únicamente la factura no validada que Factus dejó pendiente para una referencia.
async function deleteUnvalidatedFactusBill(referenceCode, retry = true) {
    const token = await getFactusBillingToken();
    const path = `/v2/bills/destroy/reference/${encodeURIComponent(referenceCode)}`;
    const response = await fetch(`${FACTUS_BILLING_BASE_URL}${path}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
        }
    });
    const responseText = await response.text();
    let result = {};
    try {
        result = responseText ? JSON.parse(responseText) : {};
    } catch {
        result = { message: responseText };
    }

    if (response.status === 401 && retry) {
        factusBillingAccessToken = null;
        factusBillingTokenExpiresAt = 0;
        await getFactusBillingToken(true);
        return deleteUnvalidatedFactusBill(referenceCode, false);
    }
    if (!response.ok) {
        const error = new Error(
            result.message || result.error ||
            `Factus no pudo eliminar la factura pendiente (HTTP ${response.status}).`
        );
        error.status = response.status;
        throw error;
    }

    const deletionStatus = String(result.status || '').toLowerCase();
    if (deletionStatus && !['ok', 'success', '200'].includes(deletionStatus)) {
        const error = new Error(result.message || result.error || 'Factus no confirmó la eliminación de la factura pendiente.');
        error.status = 502;
        throw error;
    }
    console.info(`Factus confirmó la eliminación del borrador ${referenceCode}.`);
    return result;
}

// Reconoce el 409 de Factus que se resuelve borrando el documento no validado.
function isPendingFactusBillConflict(error) {
    return error?.status === 409 &&
        /factura\s+pendiente\s+por\s+enviar\s+a\s+la\s+DIAN/i.test(error.message || '');
}

// Convierte los errores anidados de validación Factus en texto legible.
function formatFactusValidationErrors(value, prefix = '') {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') {
        return `${prefix ? `${prefix}: ` : ''}${String(value)}`;
    }
    if (Array.isArray(value)) {
        return value.map(item => formatFactusValidationErrors(item, prefix)).filter(Boolean).join('; ');
    }
    if (typeof value === 'object') {
        return Object.entries(value).map(([key, detail]) => {
            const label = prefix ? `${prefix}.${key}` : key;
            return formatFactusValidationErrors(detail, label);
        }).filter(Boolean).join('; ');
    }
    return '';
}

// Consulta endpoints Factus de facturación y renueva el token ante 401.
async function factusBillingGet(path, retry = true) {
    const token = await getFactusBillingToken();
    const response = await fetch(`${FACTUS_BILLING_BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 && retry) {
        factusBillingAccessToken = null;
        factusBillingTokenExpiresAt = 0;
        await getFactusBillingToken(true);
        return factusBillingGet(path, false);
    }
    if (!response.ok) {
        const error = new Error(result.message || result.error || `Factus respondió HTTP ${response.status} al descargar la factura.`);
        error.status = response.status;
        throw error;
    }
    return result;
}

// Guarda el PDF en el servidor y reemplaza el blob temporal en la tabla factura.
async function saveInvoicePdf(orderId, pdfBase64) {
    const cleanBase64 = String(pdfBase64 || '')
        .replace(/^data:application\/pdf;base64,/i, '')
        .replace(/\s/g, '');
    const pdfBuffer = Buffer.from(cleanBase64, 'base64');
    if (pdfBuffer.length < 4 || pdfBuffer.subarray(0, 4).toString('ascii') !== '%PDF') {
        throw new Error('Factus no devolvió un PDF válido para guardar.');
    }

    const directory = path.join(__dirname, '..', 'Public', 'facturas');
    const filename = `FOGON-${Number(orderId)}.pdf`;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, filename), pdfBuffer);
    const url = `/facturas/${filename}`;
    await db.update('factura', { url_factura: url }, { id_pedido: Number(orderId) });
    return { url, pdfBuffer };
}

// Normaliza la respuesta de Factus al formato de factura de la aplicación.
function buildFactusInvoiceResult(response) {
    const data = response?.data || response;
    const bill = data?.bill || data?.invoice || data?.factura || data;
    return {
        numero: bill?.number || bill?.bill_number || bill?.consecutive || bill?.numbering?.number || bill?.numbering || data?.bill_number || null,
        cufe: bill?.cufe || bill?.CUFE || bill?.cufe_dian || data?.cufe || null,
        estado: bill?.status || bill?.is_validated || response?.message || 'Factura validada',
        validada: bill?.is_validated ?? data?.is_validated,
        errores: bill?.errors || data?.errors || null,
        pdf: bill?.public_url || bill?.pdf_url || bill?.url || null,
        xml: bill?.xml_url || bill?.download_url || null,
        mensaje: response?.message || 'Factura creada y validada correctamente.'
    };
}

// ============================================
// VERIFICAR LOS DATOS ANTES DE EMITIR FACTURA
// ============================================

// Comprueba cliente, pago, productos y total antes de pedir la factura a Factus.
async function buildFactusInvoice(orderId, customer, paymentReference, requestedProducts) {
    // Primero revisa la identificación fiscal y el código de municipio.
    if (!customer || typeof customer !== 'object' || !customer.identification || !customer.identification_document_code || !customer.legal_organization_code) {
        const error = new Error('Completa el tipo y número de documento del cliente para emitir la factura.');
        error.status = 400;
        throw error;
    }
    if (!['1', '2'].includes(String(customer.legal_organization_code))) {
        const error = new Error('Selecciona si la factura es para una persona natural o jurídica.');
        error.status = 400;
        throw error;
    }
    if (!/^\d{5}$/.test(String(customer.municipality_code || ''))) {
        const error = new Error('Ingresa el código oficial de 5 dígitos del municipio del cliente para emitir la factura.');
        error.status = 400;
        throw error;
    }

    // Factus recibe el NIT sin puntos, guion ni dígito de verificación.
    let identification = String(customer.identification).trim();
    let dv = String(customer.dv || '').trim();
    if (!identification) {
        const error = new Error('Escribe el número de documento del comprador.');
        error.status = 400;
        throw error;
    }
    if (String(customer.identification_document_code) === '31') {
        const nitConDv = /^([\d.\s]+)\s*-\s*(\d)$/.exec(identification);
        if (nitConDv) {
            identification = nitConDv[1].replace(/\D/g, '');
            if (!dv) dv = nitConDv[2];
        } else {
            identification = identification.replace(/\D/g, '');
        }
        if (!/^\d+$/.test(identification) || (dv && !/^\d$/.test(dv))) {
            const error = new Error('Para un NIT, ingresa solo los números del NIT y el dígito de verificación en su campo.');
            error.status = 400;
            throw error;
        }
    }

    const legalOrganizationCode = String(customer.legal_organization_code);
    if (legalOrganizationCode === '1' && String(customer.identification_document_code) !== '31') {
        const error = new Error('Para una persona jurídica, selecciona NIT como tipo de documento.');
        error.status = 400;
        throw error;
    }
    const customerName = String(customer.names || '').trim();
    const companyName = String(customer.company || '').trim();
    if (legalOrganizationCode === '1' && !companyName) {
        const error = new Error('Escribe la razón social exactamente como aparece en el RUT del cliente.');
        error.status = 400;
        throw error;
    }
    if (legalOrganizationCode === '2' && !customerName) {
        const error = new Error('Escribe el nombre completo del cliente tal como aparece en su documento.');
        error.status = 400;
        throw error;
    }

    // Confirma que el pedido y el pago existen y vuelve a leer los productos guardados.
    const [orderRows, paymentRows, detailRows] = await Promise.all([
        db.select('pedido', { select: 'id_pedido,id_empleado,cli_nombre,cli_cedula,cli_correo', filters: { id_pedido: orderId }, limit: 1 }),
        db.select('pago', { select: 'id_pedido,monto,id_estado,metodo_pago', filters: { id_pedido: orderId, metodo_pago: 'factus_pay_qr' }, limit: 1 }),
        db.select('detalle_pedido', { select: 'id_producto,cantidad', filters: { id_pedido: orderId } })
    ]);
    const order = orderRows[0];
    const payment = paymentRows[0];
    if (!order || !payment) {
        const error = new Error('No se encontró el pedido o el pago relacionado.');
        error.status = 404;
        throw error;
    }
    if (!(await isPaidPayment(payment))) {
        const error = new Error('Factus solo emitirá la factura cuando el pago esté confirmado.');
        error.status = 409;
        throw error;
    }
    // Compara lo que solicita la pantalla con las cantidades que realmente se cobraron.
    const productsToInvoice = Array.isArray(requestedProducts) && requestedProducts.length
        ? requestedProducts
        : detailRows.map(row => ({ id: Number(row.id_producto), cantidad: Number(row.cantidad) }));
    if (!productsToInvoice.length) throw new Error('El pedido no tiene productos para facturar.');
    const savedQuantities = new Map(detailRows.map(row => [Number(row.id_producto), Number(row.cantidad)]));
    const productIds = productsToInvoice.map(item => Number(item.id));
    if (new Set(productIds).size !== productIds.length) throw new Error('El pedido contiene productos repetidos de forma inválida.');
    for (const item of productsToInvoice) {
        const id = Number(item.id);
        const quantity = Number(item.cantidad);
        if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1) throw new Error('Los productos o cantidades de la factura no son válidos.');
        if (TEST_PRODUCTS.has(id)) {
            if (!TEST_MODE || Number(await companyForOrder(orderId)) !== 1) throw new Error('Los productos de prueba solo pueden facturarse en sandbox.');
        } else if (savedQuantities.get(id) !== quantity) {
            throw new Error('Los productos de la factura no coinciden con el pedido guardado.');
        }
    }
    if (detailRows.some(row => !productIds.includes(Number(row.id_producto)))) throw new Error('Faltan productos del pedido en la factura.');

    const databaseIds = productIds.filter(id => !TEST_PRODUCTS.has(id));
    const rows = databaseIds.length ? await db.select('producto', {
        select: 'id_producto,nombre,precio', filters: { id_producto: databaseIds }
    }) : [];
    if (rows.length !== databaseIds.length) throw new Error('No fue posible leer todos los productos del pedido para la factura.');
    const byId = new Map(rows.map(row => [Number(row.id_producto), row]));

    // Las copias de prueba solo se usan en sandbox; los productos reales salen de la base de datos.
    const products = productsToInvoice.map(item => {
        const id = Number(item.id);
        const product = byId.get(id) || TEST_PRODUCTS.get(id);
        return { id, name: product.nombre, price: Number(product.precio), quantity: Number(item.cantidad) };
    });
    const subtotal = Math.round(products.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
    const tax = Math.round(subtotal * 0.19 * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    if (Math.abs(total - Number(payment.monto)) > 0.01) {
        const error = new Error('El total del pedido ya no coincide con el monto pagado; no se emitió la factura.');
        error.status = 409;
        throw error;
    }

    const normalizedCustomer = {
        identification_document_code: String(customer.identification_document_code),
        identification,
        legal_organization_code: legalOrganizationCode,
        tribute_code: String(customer.tribute_code || 'ZZ'),
        responsibilities: Array.isArray(customer.responsibilities) ? customer.responsibilities : ['R-99-PN'],
        country_code: 'CO'
    };
    for (const key of ['dv', 'names', 'company', 'email', 'address', 'phone', 'municipality_code']) {
        if (customer[key]) normalizedCustomer[key] = String(customer[key]);
    }
    if (dv) normalizedCustomer.dv = dv;
    if (normalizedCustomer.names) normalizedCustomer.names = normalizedCustomer.names.trim();
    if (normalizedCustomer.company) normalizedCustomer.company = normalizedCustomer.company.trim();

    const invoice = {
        reference_code: `FOGON-${orderId}`,
        document: '01',
        operation_type: '10',
        send_email: false,
        payment_details: [{
            payment_form: '1',
            payment_method_code: '47',
            reference_code: String(paymentReference || `FOGON-${orderId}`),
            amount: total.toFixed(2)
        }],
        customer: normalizedCustomer,
        items: products.map(item => ({
            code_reference: String(item.id),
            name: String(item.name).slice(0, 255),
            quantity: item.quantity.toFixed(2),
            price: item.price.toFixed(2),
            unit_measure_code: '94',
            standard_code: '999',
            taxes: [{ code: '01', rate: '19.00' }]
        }))
    };
    if (process.env.FACTUS_NUMBERING_RANGE_ID) {
        const numberingRangeId = Number(process.env.FACTUS_NUMBERING_RANGE_ID);
        if (!Number.isInteger(numberingRangeId) || numberingRangeId < 1) {
            throw new Error('FACTUS_NUMBERING_RANGE_ID debe ser un entero positivo.');
        }
        invoice.numbering_range_id = numberingRangeId;
    }

    let result;
    const pausasRecuperacion = [1200, 3000];
    let ultimoConflicto;
    for (let intento = 0; intento <= pausasRecuperacion.length; intento++) {
        try {
            result = await factusBillingRequest('/v2/bills/validate', invoice);
            break;
        } catch (error) {
            if (error.status === 422) {
                // Borra el borrador rechazado para permitir reemitir la misma referencia con los datos corregidos.
                try {
                    await deleteUnvalidatedFactusBill(invoice.reference_code);
                } catch (deleteError) {
                    if (deleteError.status !== 404) {
                        error.message += ` No se pudo limpiar el borrador pendiente en Factus: ${deleteError.message}`;
                    }
                }
                throw error;
            }
            if (!isPendingFactusBillConflict(error)) throw error;
            ultimoConflicto = error;
            if (intento === pausasRecuperacion.length) break;

            // Limpia el borrador pendiente y deja que Factus actualice su estado antes de volver a emitir.
            try {
                await deleteUnvalidatedFactusBill(invoice.reference_code);
            } catch (deleteError) {
                if (deleteError.status !== 404) {
                    const recoveryError = new Error(
                        `Factus encontró una factura pendiente, pero no confirmó que pudiera eliminarla: ${deleteError.message}`
                    );
                    recoveryError.status = deleteError.status || 502;
                    throw recoveryError;
                }
                console.info(`Factus ya no tenía el borrador ${invoice.reference_code}; se validará de nuevo.`);
            }
            await new Promise(resolve => setTimeout(resolve, pausasRecuperacion[intento]));
        }
    }
    if (!result) {
        const error = new Error(
            `Factus mantuvo la factura ${invoice.reference_code} pendiente después de dos limpiezas automáticas. Puedes reintentar más tarde. ${ultimoConflicto?.message || ''}`.trim()
        );
        error.status = 409;
        throw error;
    }
    const invoiceResult = buildFactusInvoiceResult(result);
    if (invoiceResult.validada !== true && invoiceResult.validada !== 'true') {
        const validationErrors = formatFactusValidationErrors(invoiceResult.errores);
        const factusRejected = /rechazo|rechazad/i.test(`${invoiceResult.estado || ''} ${validationErrors}`);
        if ((invoiceResult.validada === false || invoiceResult.validada === 'false') && factusRejected) {
            try {
                await deleteUnvalidatedFactusBill(invoice.reference_code);
            } catch (deleteError) {
                if (deleteError.status !== 404) {
                    console.warn(`Factus no pudo limpiar la factura no validada ${invoice.reference_code}:`, deleteError.message);
                }
            }
        }
        const error = new Error(
            validationErrors
                ? `Factus recibió la factura, pero DIAN no la validó: ${validationErrors}`
                : 'Factus recibió la factura, pero todavía no confirma su validación ante la DIAN.'
        );
        error.status = factusRejected ? 422 : 409;
        throw error;
    }

    // Al corregir datos fiscales para una factura pagada, deja el pedido alineado con el comprador facturado.
    try {
        const correctedOrder = {
            cli_nombre: normalizedCustomer.legal_organization_code === '1'
                ? normalizedCustomer.company
                : normalizedCustomer.names,
            cli_cedula: normalizedCustomer.identification
        };
        if (normalizedCustomer.email) correctedOrder.cli_correo = normalizedCustomer.email;
        await db.update('pedido', correctedOrder, { id_pedido: Number(orderId) });
    } catch (error) {
        console.warn('La factura quedó validada, pero no se pudieron guardar los datos fiscales corregidos del pedido:', error.message);
    }

    if (invoiceResult.numero) {
        try {
            const pdfResult = await factusBillingGet(`/v2/bills/${encodeURIComponent(invoiceResult.numero)}/download-pdf`);
            const pdf = pdfResult?.data || pdfResult;
            invoiceResult.pdfBase64 = pdf?.pdf_base_64_encoded || pdf?.pdf_base64 || null;
            invoiceResult.pdfName = pdf?.file_name || `${invoiceResult.numero}.pdf`;
            if (invoiceResult.pdfBase64) {
                const savedPdf = await saveInvoicePdf(orderId, invoiceResult.pdfBase64);
                invoiceResult.pdfUrl = savedPdf.url;
            }
        } catch (error) {
            console.warn('La factura se emitió, pero no se pudo cargar su PDF:', error.message);
        }
    }
    return invoiceResult;
}

// ============================================
// CARRITO: VALIDAR PRODUCTOS, STOCK Y VALORES
// ============================================

// Valida los productos del carrito y calcula subtotal, IVA y total.
async function totalProducts(products, companyId) {
    if (
        !Array.isArray(products) ||
        !products.length ||
        products.some(product =>
            !product.id ||
            !Number.isInteger(Number(product.cantidad)) ||
            Number(product.cantidad) < 1
        )
    ) {
        throw new Error(
            'El pedido debe incluir productos y cantidades válidas.'
        );
    }

    const ids = [...new Set(products.map(product => Number(product.id)))];
    const testIds = ids.filter(id => TEST_PRODUCTS.has(id));

    if (
        testIds.length &&
        (!TEST_MODE || Number(companyId) !== 1)
    ) {
        throw new Error(
            'Los productos de prueba solo funcionan en Factus Pay sandbox para la empresa de prueba.'
        );
    }

    const databaseIds = ids.filter(id => !TEST_PRODUCTS.has(id));

    const rows = databaseIds.length
        ? await db.select('producto', {
            select: 'id_producto,precio',
            filters: { id_producto: databaseIds }
        })
        : [];

    if (rows.length !== databaseIds.length) {
        throw new Error(
            'Uno o más productos ya no están disponibles.'
        );
    }

    const prices = new Map(
        rows.map(row => [
            Number(row.id_producto),
            Number(row.precio)
        ])
    );

    for (const id of testIds) {
        prices.set(id, TEST_PRODUCTS.get(id).precio);
    }

    const subtotal = Math.round(
        products.reduce(
            (sum, product) =>
                sum +
                prices.get(Number(product.id)) *
                Number(product.cantidad),
            0
        ) * 100
    ) / 100;

    const iva = Math.round(subtotal * 0.19 * 100) / 100;

    return {
        subtotal,
        iva,
        total: Math.round((subtotal + iva) * 100) / 100
    };
}

// ============================================
// CLIENTE Y EMPLEADO: DATOS ASOCIADOS AL PEDIDO
// ============================================

// Busca el empleado de la sesión y la empresa a la que pertenece.
async function resolveOrderActor(payload) {
    let employee = payload.id_empleado
        ? (
            await db.select('empleado', {
                filters: {
                    id_empleado: payload.id_empleado
                },
                limit: 1
            })
        )[0]
        : null;

    if (!employee) {
        employee = (
            await db.select('empleado', {
                order: 'id_empleado.asc',
                limit: 1
            })
        )[0];
    }

    if (!employee) {
        throw new Error(
            'Crea un empleado para poder asociar los pedidos.'
        );
    }

    const company = employee.id_empresa
        ? { id_empresa: employee.id_empresa }
        : (
            await db.select('empresa', {
                order: 'id_empresa.asc',
                limit: 1
            })
        )[0];

    if (!company) {
        throw new Error(
            'Registra una empresa antes de crear pedidos.'
        );
    }

    return {
        employeeId: employee.id_empleado,
        companyId: company.id_empresa
    };
}

// ============================================
// GUARDAR EL PEDIDO Y REGISTRAR EL PAGO
// ============================================

// Busca el ID del estado de pago que usa la base de datos.
async function paymentStateId(stateName) {
    const rows = await db.select('Estado_Pago', {
        select: 'id_EstPag,Estado',
        filters: { Estado: { operator: 'ilike', value: stateName } },
        limit: 1
    });
    if (!rows[0]) throw new Error(`No está registrado el estado de pago "${stateName}".`);
    return Number(rows[0].id_EstPag);
}

// Revisa si el pago quedó con el estado de pagado.
async function isPaidPayment(payment) {
    return Number(payment?.id_estado) === await paymentStateId('pagado');
}

// Guarda un pedido, sus productos y, si aplica, la factura o el pago asociado.
async function createOrder(payload, invoice, { payment = null } = {}) {
    const [actor, statuses] = await Promise.all([
        resolveOrderActor(payload),
        db.select('estado', {
            select: 'id_estado',
            filters: { nombre: 'pendiente' },
            limit: 1
        })
    ]);
    const { employeeId, companyId } = actor;

    let orderId;

    try {
        const orderStatus = statuses[0];
        if (!orderStatus) throw new Error('No está registrado el estado "pendiente" en la tabla estado.');

        const [order] = await db.insert('pedido', {
            cli_nombre: payload.cliente_nombre || 'Cliente',
            cli_cedula: payload.cliente_cedula || null,
            cli_correo: payload.cliente_correo?.trim() || null,
            id_empleado: employeeId,
            id_estado: orderStatus.id_estado
        });
        orderId = Number(order.id_pedido);

        const details = (payload.productos || [])
            .filter(product => !TEST_PRODUCTS.has(Number(product.id)))
            .map(product => ({
                id_pedido: orderId,
                id_producto: Number(product.id),
                cantidad: Number(product.cantidad)
            }));

        const writes = [];
        if (details.length) {
            writes.push({
                table: 'detalle_pedido',
                promise: db.insert('detalle_pedido', details)
            });
        }

        if (invoice) {
            writes.push({
                table: 'factura',
                promise: db.insert('factura', {
                    total: Number(payload.total) || 0,
                    id_pedido: orderId,
                    id_empresa: companyId
                })
            });
        }

        if (payment) {
            const idEstadoPago = await paymentStateId(payment.estado);
            writes.push({
                table: 'pago',
                promise: db.insert('pago', {
                    id_pedido: orderId,
                    monto: Number(payment.monto),
                    metodo_pago: payment.metodo_pago || 'por_definir',
                    id_estado: idEstadoPago
                })
            });
        }

        const results = await Promise.allSettled(
            writes.map(write => write.promise)
        );
        const failedWrite = results.find(result => result.status === 'rejected');
        if (failedWrite) throw failedWrite.reason;
    } catch (error) {
        if (orderId) {
            const childTables = [];
            if (invoice) childTables.push('factura');
            if (payment) childTables.push('pago');
            if ((payload.productos || []).some(product => !TEST_PRODUCTS.has(Number(product.id)))) {
                childTables.push('detalle_pedido');
            }

            for (const table of childTables) {
                try {
                    await db.delete(table, { id_pedido: orderId });
                } catch (rollbackError) {
                    console.error(
                        `No se pudo revertir ${table} del pedido ${orderId}:`,
                        rollbackError.message
                    );
                }
            }

            try {
                await db.delete('pedido', { id_pedido: orderId });
            } catch (rollbackError) {
                console.error(
                    `No se pudo revertir el pedido ${orderId}:`,
                    rollbackError.message
                );
            }
        }
        throw error;
    }

    return {
        id: orderId,
        companyId
    };
}

// Busca uno de los cuatro estados permitidos y lo asigna al pedido.
async function setOrderStatus(orderId, statusName) {
    if (!ORDER_STATUSES.has(statusName)) {
        throw new Error(`El estado "${statusName}" no está permitido para un pedido.`);
    }

    const status = (
        await db.select('estado', {
            select: 'id_estado',
            filters: { nombre: statusName },
            limit: 1
        })
    )[0];

    if (!status) throw new Error(`No está registrado el estado "${statusName}" en la tabla estado.`);

    await db.update(
        'pedido',
        { id_estado: status.id_estado },
        { id_pedido: orderId }
    );
}

// Obtiene la empresa asociada al empleado que registró el pedido.
async function companyForOrder(orderId) {
    const order = (
        await db.select('pedido', {
            select: 'id_empleado',
            filters: { id_pedido: orderId },
            limit: 1
        })
    )[0];

    if (!order) throw new Error('No se encontró el pedido del pago.');

    const employee = (
        await db.select('empleado', {
            select: 'id_empresa',
            filters: { id_empleado: order.id_empleado },
            limit: 1
        })
    )[0];

    if (employee?.id_empresa) return employee.id_empresa;

    const company = (
        await db.select('empresa', {
            select: 'id_empresa',
            order: 'id_empresa.asc',
            limit: 1
        })
    )[0];

    if (!company) throw new Error('No se encontró la empresa del pedido.');
    return company.id_empresa;
}

// Concilia la respuesta de Factus Pay con el pago, el pedido y la factura local.
async function closePayment(orderId, providerStatus, confirmedAmount) {
    const key = Number(orderId);
    const currentClose = paymentClosuresInProgress.get(key);
    if (currentClose) return currentClose;

    const closePromise = savePaymentClosure(key, providerStatus, confirmedAmount);
    paymentClosuresInProgress.set(key, closePromise);
    try {
        return await closePromise;
    } finally {
        if (paymentClosuresInProgress.get(key) === closePromise) {
            paymentClosuresInProgress.delete(key);
        }
    }
}

const paymentClosuresInProgress = new Map();
async function savePaymentClosure(orderId, providerStatus, confirmedAmount) {
    const payment = (
        await db.select('pago', {
            filters: {
                id_pedido: orderId,
                metodo_pago: 'factus_pay_qr'
            },
            limit: 1
        })
    )[0];

    if (!payment) throw new Error('No se encontró el pago asociado al pedido.');

    if (providerStatus === 'paid') {
        if (Number(confirmedAmount) !== Number(payment.monto)) {
            const error = new Error(
                'El valor confirmado por Factus Pay no coincide con el pedido.'
            );
            error.status = 409;
            throw error;
        }

        await db.update(
            'pago',
            { id_estado: await paymentStateId('pagado') },
            { id_pago: payment.id_pago }
        );
        await setOrderStatus(orderId, 'pendiente');

        const invoice = (
            await db.select('factura', {
                select: 'id_factura',
                filters: { id_pedido: orderId },
                limit: 1
            })
        )[0];

        if (!invoice) {
            await db.insert('factura', {
                total: Number(payment.monto),
                id_pedido: orderId,
                id_empresa: await companyForOrder(orderId)
            });
        }
    } else if (['failed', 'rejected', 'expired'].includes(providerStatus)) {
        await db.update(
            'pago',
            { id_estado: await paymentStateId('fallido') },
            { id_pago: payment.id_pago }
        );
        await setOrderStatus(orderId, 'cancelado');
    }
}

// Compara la hora de creación del recaudo con el límite de diez minutos.
function factusQrYaVencio(payment, now = Date.now()) {
    const createdAt = Date.parse(payment?.fecha_creacion || '');
    return Number.isFinite(createdAt) && now - createdAt >= FACTUS_PAY_QR_TTL_MS;
}

// Cancela en segundo plano los QR sin pago, incluso si el cajero cerró la página.
let factusPayExpirationSweepRunning = false;
async function cancelarQrVencidos() {
    if (factusPayExpirationSweepRunning) return;
    factusPayExpirationSweepRunning = true;

    try {
        const pendingStateId = await paymentStateId('pendiente');
        const pendingPayments = await db.select('pago', {
            select: 'id_pedido,monto,fecha_creacion',
            filters: {
                metodo_pago: 'factus_pay_qr',
                id_estado: pendingStateId
            },
            order: 'fecha_creacion.asc',
            limit: 100
        });

        for (const payment of pendingPayments) {
            if (!factusQrYaVencio(payment)) continue;

            const referenceCode = `FOGON-${Number(payment.id_pedido)}`;
            try {
                const response = await factusPayRequest(
                    `/v1/collections/${encodeURIComponent(referenceCode)}`
                );
                const collection = response.data || {};

                // Si alcanzó a pagarse, respetamos la confirmación de Factus.
                if (collection.status === 'paid') {
                    if (Number(collection.amount) === Number(payment.monto)) {
                        await closePayment(payment.id_pedido, 'paid', Number(collection.amount));
                    } else {
                        console.error(`El monto de Factus no coincide para ${referenceCode}; se deja pendiente de revisión.`);
                    }
                    continue;
                }

                const finalStatus = ['failed', 'rejected', 'expired'].includes(collection.status)
                    ? collection.status
                    : 'expired';
                await closePayment(payment.id_pedido, finalStatus);
            } catch (error) {
                // Si Factus ya no encuentra el QR, el pedido tampoco debe quedar pendiente.
                if (error.status === 404) {
                    await closePayment(payment.id_pedido, 'expired');
                    continue;
                }
                // Si Factus no responde, el siguiente ciclo vuelve a revisar ese recaudo.
                console.error(`No se pudo vencer el QR ${referenceCode}:`, error.message);
            }
        }
    } catch (error) {
        console.error('No se pudieron revisar los QR vencidos:', error.message);
    } finally {
        factusPayExpirationSweepRunning = false;
    }
}

// ============================================
// RUTAS DE CATÁLOGO E INVENTARIO PARA CAJA
// ============================================

// Devuelve las recetas y sus detalles que caja necesita para revisar y descontar insumos.
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
        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudieron consultar las recetas para caja.',
            error: error.message
        });
    }
});

// Devuelve los insumos y cantidades de una receta para validar existencias y descontarlas.
router.get('/recetas/:id', async (req, res) => {
    try {
        const recetas = await db.select('receta', {
            select: 'id_receta,nombre,descripcion,id_producto,producto(nombre)',
            filters: { id_receta: req.params.id },
            limit: 1
        });
        const receta = recetas[0];
        if (!receta) return res.status(404).json({ success: false, message: 'Receta no encontrada.' });

        const detalles = await db.select('detalle_receta', {
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
            detalles: detalles.map(row => ({
                ID_INSUMO: row.id_insumo,
                CANTIDAD: row.cantidad,
                INSUMO_NOMBRE: row.insumo?.nombre,
                INSUMO_UNIDAD: row.insumo?.unidad_medida?.abreviatura || row.insumo?.unidad_medida?.nombre || ''
            }))
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudo consultar el detalle de la receta.',
            error: error.message
        });
    }
});

// Devuelve el inventario que caja consulta para validar y descontar existencias.
router.get('/insumos', async (_req, res) => {
    try {
        const rows = await db.select('insumo', {
            select: '*,proveedor(nombre),unidad_medida(nombre,abreviatura)',
            order: 'id_insumo.asc'
        });
        res.json({
            success: true,
            insumos: rows.map(row => ({
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
            }))
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudo consultar el inventario para caja.',
            error: error.message
        });
    }
});

// Consulta el stock actual del insumo que caja va a descontar.
router.get('/insumos/:id', async (req, res) => {
    try {
        const rows = await db.select('insumo', {
            select: '*,proveedor(nombre),unidad_medida(nombre,abreviatura)',
            filters: { id_insumo: req.params.id },
            limit: 1
        });
        const row = rows[0];
        if (!row) return res.status(404).json({ success: false, message: 'Insumo no encontrado.' });
        res.json({
            success: true,
            insumo: {
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
            }
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudo consultar el insumo.',
            error: error.message
        });
    }
});

// Caja solo puede actualizar el stock del insumo, no sus datos administrativos.
router.put('/insumos/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const stock = Number(body.stock);
        if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'stock') || !Number.isFinite(stock) || stock < 0) {
            return res.status(400).json({ success: false, message: 'Envía únicamente un stock válido mayor o igual a cero.' });
        }
        const rows = await db.update('insumo', { stock }, { id_insumo: req.params.id });
        if (!rows.length) return res.status(404).json({ success: false, message: 'Insumo no encontrado.' });
        res.json({ success: true, message: 'Stock actualizado correctamente.' });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudo actualizar el stock del insumo.',
            error: error.message
        });
    }
});

// Devuelve los productos registrados, con los campos que espera el cajero.
router.get('/productos', async (_req, res) => {
    try {
        const rows = await db.select('producto', {
            select: `
                id_producto,
                nombre,
                precio,
                descripcion,
                url_foto,
                id_categoria,
                categoria(nombre)
            `,
            order: 'id_producto.asc'
        });

        const productos = rows.map(product => ({
            ID: product.id_producto,
            NOMBRE: product.nombre,
            PRECIO: product.precio,
            DESCRIPCION: product.descripcion,
            CATEGORIA: product.categoria?.nombre || '',
            FOTO: product.url_foto,
            URL_FOTO: product.url_foto,
            ID_CATEGORIA: product.id_categoria
        }));

        res.json({
            success: true,
            productos
        });
    } catch (error) {
        console.error('Error al consultar productos de Supabase:', error.message);

        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudieron consultar los productos.',
            error: error.message
        });
    }
});

// Devuelve el resumen de productos más vendidos para recomendaciones.
router.get('/mas-vendidos', async (_req, res) => {
    try {
        const [products, details] = await Promise.all([
            db.select('producto', {
                select: '*,categoria(nombre)'
            }),
            db.select('detalle_pedido', {
                select: 'id_producto,cantidad'
            })
        ]);

        const count = new Map();

        for (const detail of details) {
            count.set(
                detail.id_producto,
                (count.get(detail.id_producto) || 0) +
                    Number(detail.cantidad)
            );
        }

        products.sort(
            (a, b) =>
                (count.get(b.id_producto) || 0) -
                (count.get(a.id_producto) || 0)
        );

        res.json({
            success: true,
            productos: products.slice(0, 4).map(product => ({
                ID: product.id_producto,
                NOMBRE: product.nombre,
                PRECIO: product.precio,
                CATEGORIA: product.categoria?.nombre || '',
                DESCRIPCION: product.descripcion,
                FOTO: product.url_foto,
                veces_vendido: count.get(product.id_producto) || 0
            }))
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'Error al consultar más vendidos',
            error: error.message
        });
    }
});

// Consulta el último número de factura local disponible para mostrar en caja.
router.get('/ultima-factura', async (_req, res) => {
    try {
        const rows = await db.select('factura', {
            select: 'id_pedido',
            order: 'id_factura.desc',
            limit: 1
        });

        res.json({
            success: true,
            ultimo_id: rows[0]?.id_pedido || 0
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'Error al consultar factura',
            error: error.message
        });
    }
});

// ============================================
// RUTAS PARA CREAR PEDIDOS Y COBRAR CON FACTUS PAY
// ============================================

// Registra un pedido pagado por un medio distinto al QR de Factus Pay.
router.post('/pedidos', async (req, res) => {
    try {
        const payload = req.body || {};

        Object.assign(
            payload,
            await totalProducts(
                payload.productos,
                payload.id_empresa || 1
            )
        );

        const created = await createOrder(
            payload,
            true,
            {
                payment: {
                    estado: 'pagado',
                    monto: payload.total,
                    metodo_pago: payload.factus?.payment_details?.[0]?.payment_method_code || 'por_definir'
                }
            }
        );

        res.status(201).json({
            success: true,
            message: 'Pedido y factura creados correctamente',
            id_pedido: created.id
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: `Error al crear pedido: ${error.message}`
        });
    }
});

// Crea el pedido y solicita a Factus Pay un recaudo QR para su cobro.
router.post('/factus-pay/recaudos', async (req, res) => {
    const payload = req.body || {};
    let orderId;
    let paymentSaved = false;

    try {
        Object.assign(
            payload,
            await totalProducts(
                payload.productos,
                payload.id_empresa || 1
            )
        );

        if (payload.total < 10000 || payload.total > 12000000) {
            return res.status(400).json({
                success: false,
                message:
                    'Factus Pay admite recaudos entre $10.000 y $12.000.000 COP.'
            });
        }

        // La autenticación y el guardado del pedido no dependen entre sí.
        // Se ejecutan en paralelo para que el primer pago no espere a que
        // termine toda la escritura en Supabase antes de pedir el token.
        const tokenPromise = getFactusPayToken().then(
            () => ({ success: true }),
            error => ({ success: false, error })
        );

        const createdOrder = await createOrder(
            payload,
            false,
            {
                payment: {
                    estado: 'pendiente',
                    monto: payload.total,
                    metodo_pago: 'factus_pay_qr'
                }
            }
        );

        orderId = createdOrder.id;
        paymentSaved = true;

        const referenceCode = `FOGON-${orderId}`;

        const tokenResult = await tokenPromise;
        if (!tokenResult.success) throw tokenResult.error;

        const created = await factusPayRequest(
            '/v1/collections',
            {
                method: 'POST',
                body: JSON.stringify({
                    reference_code: referenceCode,
                    amount: payload.total
                })
            }
        );

        let collection = created.data || {};

        if (!collection.qr) {
            try {
                const details = await factusPayRequest(
                    `/v1/collections/${encodeURIComponent(referenceCode)}`
                );

                collection = details.data || collection;
            } catch (error) {
                console.warn(
                    'No se pudo consultar el QR todavía:',
                    error.message
                );
            }
        }

        const status = collection.status || 'started';

        if (status === 'paid') {
            await closePayment(
                orderId,
                'paid',
                Number(collection.amount ?? payload.total)
            );
        } else if (['failed', 'rejected'].includes(status)) {
            await closePayment(orderId, status);
        }

        res.status(201).json({
            success: true,
            id_pedido: orderId,
            reference_code: referenceCode,
            amount: collection.amount ?? payload.total,
            status,
            qr: collection.qr || null,
            message: created.message || 'Recaudo creado correctamente'
        });
    } catch (error) {
        if (orderId && paymentSaved && error.status && error.status < 500) {
            await closePayment(orderId, 'failed').catch(() => {});
        } else if (orderId && !paymentSaved) {
            await db.delete('detalle_pedido', { id_pedido: orderId }).catch(() => {});
            await db.delete('pedido', { id_pedido: orderId }).catch(() => {});
        }

        res.status(error.status || 500).json({
            success: false,
            message:
                error.message ||
                'No se pudo crear el recaudo Factus Pay.'
        });
    }
});

// Consulta el recaudo, actualiza su estado y devuelve el QR mientras está pendiente.
router.get('/factus-pay/recaudos/:referenceCode', async (req, res) => {
    try {
        const referenceCode = req.params.referenceCode;
        const referenceMatch = /^FOGON-(\d+)$/.exec(referenceCode);

        if (!referenceMatch) {
            return res.status(400).json({
                success: false,
                message: 'La referencia del recaudo no es válida.'
            });
        }

        const orderId = Number(referenceMatch[1]);
        const rows = await db.select('pago', {
            select: 'id_pedido,monto,id_estado,metodo_pago,fecha_creacion',
            filters: {
                id_pedido: orderId,
                metodo_pago: 'factus_pay_qr'
            },
            limit: 1
        });

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'No se encontró el recaudo.'
            });
        }

        const payment = rows[0];

        const response = await factusPayRequest(
            `/v1/collections/${encodeURIComponent(referenceCode)}`
        );

        const collection = response.data || {};
        const allowedStatuses = [
            'started',
            'ready',
            'paid',
            'failed',
            'rejected',
            'expired'
        ];

        const [estadoPagado, estadoPendiente, estadoFallido] = await Promise.all([
            paymentStateId('pagado'),
            paymentStateId('pendiente'),
            paymentStateId('fallido')
        ]);
        let status = allowedStatuses.includes(collection.status)
            ? collection.status
            : (Number(payment.id_estado) === estadoPagado
                ? 'paid'
                : Number(payment.id_estado) === estadoFallido
                    ? 'failed'
                    : 'started');

        // El estado local terminal prevalece si Factus devuelve una respuesta atrasada.
        if (Number(payment.id_estado) === estadoPagado) status = 'paid';
        else if (Number(payment.id_estado) === estadoFallido) status = 'failed';
        else if (
            Number(payment.id_estado) === estadoPendiente &&
            factusQrYaVencio(payment) &&
            ['started', 'ready'].includes(status)
        ) {
            status = 'expired';
        }

        if (
            status === 'paid' &&
            Number(collection.amount) !== Number(payment.monto)
        ) {
            return res.status(409).json({
                success: false,
                message:
                    'El valor confirmado por Factus Pay no coincide con el pedido.'
            });
        }

        if (status === 'paid') {
            await closePayment(
                orderId,
                'paid',
                Number(collection.amount)
            );
        } else if (['failed', 'rejected', 'expired'].includes(status)) {
            await closePayment(orderId, status);
        }

        res.json({
            success: true,
            id_pedido: orderId,
            reference_code: referenceCode,
            amount: collection.amount ?? Number(payment.monto),
            status,
            qr: status === 'expired' ? null : (collection.qr || null),
            message: status === 'expired'
                ? 'El QR venció después de diez minutos y el pedido se canceló.'
                : undefined
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message:
                error.message ||
                'No se pudo consultar el recaudo.'
        });
    }
});

// ============================================
// RUTAS PARA REVISAR, EMITIR Y RECUPERAR FACTURAS
// ============================================

// Recupera los datos fiscales guardados para volver a emitir una factura pendiente.
router.get('/factus-pay/recaudos/:referenceCode/factura-info', async (req, res) => {
    try {
        const referenceCode = req.params.referenceCode;
        const referenceMatch = /^FOGON-(\d+)$/.exec(referenceCode);
        if (!referenceMatch) {
            return res.status(400).json({ success: false, message: 'La referencia del recaudo no es válida.' });
        }

        const orderId = Number(referenceMatch[1]);
        const [orders, payments] = await Promise.all([
            db.select('pedido', {
                select: 'id_pedido,cli_nombre,cli_cedula,cli_correo',
                filters: { id_pedido: orderId },
                limit: 1
            }),
            db.select('pago', {
                select: 'id_pedido,monto,id_estado,metodo_pago',
                filters: { id_pedido: orderId, metodo_pago: 'factus_pay_qr' },
                limit: 1
            })
        ]);
        const order = orders[0];
        const payment = payments[0];
        if (!order || !payment) {
            return res.status(404).json({ success: false, message: 'No se encontró el pedido o el recaudo.' });
        }
        if (!(await isPaidPayment(payment))) {
            return res.status(409).json({ success: false, message: 'Solo puedes recuperar la factura de un pago confirmado.' });
        }

        res.json({
            success: true,
            payment: {
                id_pedido: orderId,
                reference_code: referenceCode,
                amount: Number(payment.monto)
            },
            customer: {
                identification: order.cli_cedula || '',
                names: order.cli_nombre || '',
                email: order.cli_correo || ''
            }
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.message || 'No se pudo recuperar el pedido pagado.'
        });
    }
});

// Emite o reintenta la factura electrónica asociada al recaudo pagado.
router.post('/factus-pay/recaudos/:referenceCode/factura', async (req, res) => {
    try {
        const referenceCode = req.params.referenceCode;
        const referenceMatch = /^FOGON-(\d+)$/.exec(referenceCode);
        if (!referenceMatch) {
            return res.status(400).json({ success: false, message: 'La referencia del recaudo no es válida.' });
        }

        const invoice = await buildFactusInvoice(
            Number(referenceMatch[1]),
            req.body?.customer,
            referenceCode,
            req.body?.productos
        );
        res.json({ success: true, invoice });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.message || 'No se pudo crear la factura electrónica en Factus.'
        });
    }
});


// Envía por Gmail la factura PDF de un recaudo pagado y verificado.
router.post('/factus-pay/recaudos/:referenceCode/factura/enviar-correo', async (req, res) => {
    try {
        const referenceCode = req.params.referenceCode;
        const referenceMatch = /^FOGON-(\d+)$/.exec(referenceCode);
        if (!referenceMatch) {
            return res.status(400).json({ success: false, message: 'La referencia del recaudo no es válida.' });
        }

        const orderId = Number(referenceMatch[1]);
        const number = String(req.body?.number || '').trim();
        const email = String(req.body?.email || '').trim();
        if (!/^[A-Za-z0-9-]+$/.test(number)) {
            return res.status(400).json({ success: false, message: 'El número de la factura no es válido.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, message: 'Ingresa una dirección de correo válida.' });
        }
        const gmailEmail = process.env.GMAIL_EMAIL;
        const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
        if (!gmailEmail || !gmailAppPassword) {
            return res.status(503).json({
                success: false,
                message: 'El envío está pendiente de configuración: agrega GMAIL_EMAIL y GMAIL_APP_PASSWORD al archivo .env y reinicia el servidor.'
            });
        }
        if (gmailAppPassword.length !== 16) {
            return res.status(503).json({
                success: false,
                message: 'La contraseña de aplicación de Gmail debe tener 16 caracteres. Cópiala completa en GMAIL_APP_PASSWORD y reinicia el servidor.'
            });
        }

        const payments = await db.select('pago', {
            select: 'id_pedido,id_estado,metodo_pago',
            filters: { id_pedido: orderId, metodo_pago: 'factus_pay_qr' },
            limit: 1
        });
        if (!payments[0]) return res.status(404).json({ success: false, message: 'No se encontró el recaudo asociado.' });
        if (!(await isPaidPayment(payments[0]))) {
            return res.status(409).json({ success: false, message: 'Solo puedes enviar por correo una factura de un pago confirmado.' });
        }
        const orderRows = await db.select('pedido', {
            select: 'cli_nombre',
            filters: { id_pedido: orderId },
            limit: 1
        });
        const customerName = String(orderRows[0]?.cli_nombre || 'cliente').trim() || 'cliente';
        const safeCustomerName = customerName
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const response = await factusBillingGet(`/v2/bills/${encodeURIComponent(number)}`);
        const data = response?.data || response;
        const bill = data?.bill || data?.invoice || data;
        const billReference = bill?.reference_code || bill?.referenceCode || data?.reference_code || data?.referenceCode;
        if (String(billReference || '') !== referenceCode) {
            return res.status(409).json({ success: false, message: 'La factura no corresponde a este pedido.' });
        }

        const pdfResponse = await factusBillingGet(`/v2/bills/${encodeURIComponent(number)}/download-pdf`);
        const pdf = pdfResponse?.data || pdfResponse;
        const pdfBase64 = String(pdf?.pdf_base_64_encoded || pdf?.pdf_base64 || '')
            .replace(/^data:application\/pdf;base64,/i, '')
            .replace(/\s/g, '');
        if (!pdfBase64) {
            const error = new Error('Factus no devolvió el PDF de la factura para adjuntarlo al correo.');
            error.status = 502;
            throw error;
        }
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        if (pdfBuffer.length < 4 || pdfBuffer.subarray(0, 4).toString('ascii') !== '%PDF') {
            const error = new Error('Factus devolvió un PDF inválido; no se envió el correo.');
            error.status = 502;
            throw error;
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailEmail, pass: gmailAppPassword }
        });
        let sent;
        try {
            sent = await transporter.sendMail({
                from: { name: 'FogónClick', address: gmailEmail },
                to: email,
                subject: `Tu factura electrónica ${number} - FogónClick`,
                text: `Hola ${customerName},\n\nAdjuntamos tu factura electrónica ${number} de FogónClick.\n\nGracias por tu compra.`,
                html: `<div style="font-family:Arial,sans-serif;color:#242936;line-height:1.6"><h2 style="color:#e94560">Hola ${safeCustomerName}</h2><p>Adjuntamos tu factura electrónica <strong>${number}</strong> de FogónClick.</p><p>Gracias por tu compra.</p><p>Conserva este correo y el PDF adjunto para tus registros.</p></div>`,
                attachments: [{
                    filename: `Factura-${number}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }]
            });
        } finally {
            transporter.close();
        }

        res.json({
            success: true,
            message: `Factura enviada a ${email}.`,
            emailId: sent.messageId
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.code === 'EAUTH'
                ? 'Gmail rechazó la autenticación. Usa una contraseña de aplicación de Google y verifica el correo configurado.'
                : (error.message || 'No se pudo enviar la factura por correo.')
        });
    }
});

// Revisa periódicamente los recaudos que vencen aunque el cajero cierre la página.
const factusPayExpirationTimer = setInterval(
    cancelarQrVencidos,
    FACTUS_PAY_EXPIRATION_CHECK_MS
);
factusPayExpirationTimer.unref?.();

module.exports = router;
