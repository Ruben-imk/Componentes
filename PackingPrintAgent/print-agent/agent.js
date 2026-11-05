require("dotenv").config();
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const http = require("http");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const BASE_URL = String(process.env.PACKING_SERVER_URL || "").replace(/\/+$/, "");
const TOKEN = String(process.env.PRINT_AGENT_TOKEN || "");
const AGENT_ID = String(process.env.PRINT_AGENT_ID || "").trim();
const SUMATRA_PATH = process.env.SUMATRA_PATH || "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe";
const PRINTER_NAME = String(process.env.PRINTER_NAME || "").trim();
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.POLL_INTERVAL_MS || 3000));
// Endpoint local para que Packing obtenga el ID sin pedirle nada al usuario.
const LOCAL_IDENTITY_PORT = 17891;
let detenido = false;
let identityServer;

function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function api(ruta, opciones = {}) {

    const separador = ruta.includes("?") ? "&" : "?";

    const rutaFinal = ruta.includes("/agente/pendiente")
        ? `${ruta}${separador}_=${Date.now()}`
        : ruta;

    const respuesta = await fetch(`${BASE_URL}${rutaFinal}`, {
        ...opciones,
        cache: "no-store",
        headers: {
            ...(opciones.headers || {}),
            "x-print-agent-token": TOKEN,
            "x-print-agent-id": AGENT_ID,
            "Cache-Control": "no-cache, no-store",
            "Pragma": "no-cache"
        },
        signal: AbortSignal.timeout(60000)
    });

    const datos = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok || datos.success === false) {
        throw new Error(datos.message || `Error HTTP ${respuesta.status}`);
    }

    return datos;
}

async function imprimir(trabajo) {
    console.log(
    `[IMPRESION] ${new Date().toISOString()} | PID=${process.pid} | Trabajo=${trabajo.idImpresion}`
);
    const nombreArchivo = `packing-${trabajo.idImpresion}-${Date.now()}.pdf`;
    const rutaPdf = path.join(os.tmpdir(), nombreArchivo);
    try {
        const bytes = Buffer.from(trabajo.archivoPdfBase64, "base64");

        await fs.writeFile(rutaPdf, bytes);
        const args = PRINTER_NAME
            ? ["-print-to", PRINTER_NAME, "-silent", "-exit-when-done", rutaPdf]
            : ["-print-to-default", "-silent", "-exit-when-done", rutaPdf];
        await execFileAsync(SUMATRA_PATH, args, { windowsHide: true, timeout: 120000 });
        await api(`/api/impresion/agente/${encodeURIComponent(trabajo.idImpresion)}/completar`, { method: "POST" });
        console.log(`[OK] Trabajo ${trabajo.idImpresion} enviado a la impresora predeterminada. Equipo=${AGENT_ID}; Planeación=${trabajo.planeacion}; SKU=${trabajo.sku}; PO=${trabajo.numeroPedido || "(sin PO)"}`);
    } catch (error) {
        console.error(`[ERROR] Trabajo ${trabajo.idImpresion}:`, error.message);
        try {
            await api(`/api/impresion/agente/${encodeURIComponent(trabajo.idImpresion)}/error`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: String(error.message || "Error de impresión").slice(0, 900) })
            });
        } catch (errorApi) {
            console.error("No se pudo actualizar el estado del trabajo:", errorApi.message);
        }
    } finally {
        await fs.rm(rutaPdf, { force: true }).catch(() => {});
    }
}

function iniciarServidorIdentidadLocal() {
    const origenPermitido = new URL(BASE_URL).origin;
    identityServer = http.createServer((req, res) => {
        const origen = String(req.headers.origin || "");
        // Solo aceptar solicitudes del sitio APP PACKING configurado en este agente.
        if (origen && origen !== origenPermitido) {
            res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ success: false, message: "Origen no autorizado." }));
            return;
        }
        res.setHeader("Access-Control-Allow-Origin", origenPermitido);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        // Chromium puede requerir esta cabecera para solicitudes desde la intranet a loopback.
        res.setHeader("Access-Control-Allow-Private-Network", "true");
        res.setHeader("Cache-Control", "no-store");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method === "GET" && req.url === "/identity") {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ success: true, agentId: AGENT_ID }));
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, message: "Ruta no encontrada." }));
    });
    identityServer.on("error", error => {
        console.error(`No se pudo iniciar el endpoint local de identidad en el puerto ${LOCAL_IDENTITY_PORT}:`, error.message);
        process.exit(1);
    });
    identityServer.listen(LOCAL_IDENTITY_PORT, "127.0.0.1", () => {
        console.log(`Identidad local disponible en http://127.0.0.1:${LOCAL_IDENTITY_PORT}/identity`);
    });
}

async function iniciar() {
    if (!BASE_URL || !TOKEN || !/^https?:\/\//i.test(BASE_URL) || !/^[A-Za-z0-9_-]{2,100}$/.test(AGENT_ID)) {
        console.error("Configura PACKING_SERVER_URL, PRINT_AGENT_TOKEN y un PRINT_AGENT_ID único (2-100 caracteres) en el .env del agente.");
        process.exit(1);
    }
    iniciarServidorIdentidadLocal();
    console.log(`Agente de impresión iniciado. ID: ${AGENT_ID}; servidor: ${BASE_URL}; impresora: ${PRINTER_NAME || "predeterminada de Windows"}`);
    while (!detenido) {
        try {
            const respuesta = await api("/api/impresion/agente/pendiente");
            if (respuesta.data) await imprimir(respuesta.data);
            else await esperar(POLL_INTERVAL_MS);
        } catch (error) {
            console.error("No se pudo consultar la cola:", error.message);
            await esperar(Math.max(POLL_INTERVAL_MS, 5000));
        }
    }
}

process.on("SIGINT", () => { detenido = true; identityServer?.close(); console.log("Deteniendo agente..."); });
process.on("SIGTERM", () => { detenido = true; identityServer?.close(); });
iniciar();
